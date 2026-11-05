import { parentPort } from 'node:worker_threads'
import { createFinderSyncIo, readVerifiedFinderFiles, revalidateFinderSyncHandles, validateFinderSyncSelection } from './finder-sync.mjs'

const io = createFinderSyncIo()

// A small Node Buffer shares an 8 KB pool. That pool cannot be transferred.
// Move only a dedicated ArrayBuffer so the main thread receives the verified
// bytes without copying them again.
function transferableFile(file, transfers) {
  const data = file.data
  const bytes = data?.byteLength ?? 0
  const backing = data?.buffer
  const described = {
    filename: file.filename,
    sourcePath: file.sourcePath,
    mtimeMs: file.mtimeMs,
    size: file.size,
  }
  if (backing instanceof ArrayBuffer && (data.byteOffset ?? 0) === 0 && backing.byteLength === bytes) {
    transfers.push(backing)
    return { ...described, data }
  }
  const copy = new ArrayBuffer(bytes)
  if (bytes) new Uint8Array(copy).set(data)
  transfers.push(copy)
  return { ...described, data: new Uint8Array(copy) }
}

parentPort.on('message', (message) => {
  const id = message?.id
  try {
    if (message?.op === 'validate') {
      const checked = validateFinderSyncSelection(message.paths, io)
      parentPort.postMessage({
        id,
        paths: checked.paths,
        rejected: checked.rejected,
        limitError: checked.limitError,
        handles: checked.handles,
      })
      return
    }
    if (message?.op === 'close') {
      for (const fd of message.fds ?? []) {
        try {
          io.closeSync(fd)
        } catch {
          // The descriptor is already closed.
        }
      }
      parentPort.postMessage({ id, ok: true })
      return
    }
    if (message?.op === 'read') {
      const again = revalidateFinderSyncHandles(message.handles, io)
      if (!again.ok) {
        parentPort.postMessage({ id, ok: false, reason: again.reason, files: [], skippedWeb: [] })
        return
      }
      const verified = readVerifiedFinderFiles(message.handles, io)
      if (!verified.ok) {
        parentPort.postMessage({ id, ok: false, reason: verified.reason, files: [], skippedWeb: verified.skippedWeb ?? [] })
        return
      }
      const transfers = []
      const files = verified.files.map((file) => transferableFile(file, transfers))
      parentPort.postMessage(
        { id, ok: true, files, skippedWeb: verified.skippedWeb ?? [] },
        transfers,
      )
      return
    }
    parentPort.postMessage({ id, error: 'Unknown Finder Sync scan.' })
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : 'Finder Sync scan failed.' })
  }
})

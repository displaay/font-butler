import fs from 'node:fs'
import path from 'node:path'
import { isFullyUnderAnyRoot } from './containment.ts'
import { resolveRetailPath } from './retail-sync.ts'
import { isSyncableDrift, type RetailDriftItem, type RetailLocalManifest } from '../shared/retail.ts'

/** Not a font extension, so the inbox watcher's `isFontFile` gate ignores half-written downloads. */
export const RETAIL_PART_SUFFIX = '.part'

export const RETAIL_DOWNLOAD_CONCURRENCY = 4

export type RetailDownload = (key: string, expectedSize: number) => Promise<Uint8Array>

export type ApplyRetailSyncOptions = {
  root: string
  drift: RetailDriftItem[]
  download: RetailDownload
  manifest: RetailLocalManifest
  /** Called after each batch so an interrupted sync does not re-download what already landed. */
  persist: (manifest: RetailLocalManifest) => void
  concurrency?: number
  now?: () => string
}

export type RetailSyncResult = {
  written: number
  skipped: number
  failed: number
  errors: string[]
  manifest: RetailLocalManifest
}

/** Leftovers from an interrupted run. Removed on entry so they cannot accumulate. */
export function sweepRetailPartials(root: string): number {
  let removed = 0
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
      } else if (entry.isFile() && entry.name.endsWith(RETAIL_PART_SUFFIX)) {
        try {
          fs.rmSync(full, { force: true })
          removed += 1
        } catch {
          // A locked leftover is harmless; the next write replaces it.
        }
      }
    }
  }
  if (fs.existsSync(root)) walk(root, 0)
  return removed
}

/**
 * Where a drift item may be written.
 *
 * `resolveRetailPath` is the lexical guard; `isFullyUnderAnyRoot` additionally resolves symlinks, so a
 * symlinked subfolder inside the retail root cannot redirect a write outside it. Same helper the rest
 * of the service uses before touching a path.
 */
function targetFor(root: string, relativePath: string): string | null {
  // `resolveRetailPath` already resolves symlinks via `isFullyUnderAnyRoot`, so the path is cleared
  // BEFORE any directory is created — creating them first would materialise dirs through a symlink
  // that we then reject.
  const target = resolveRetailPath(root, relativePath)
  if (!target) return null
  fs.mkdirSync(path.dirname(target), { recursive: true })
  // Re-check once the parent exists: realpath can only resolve a chain that is actually on disk.
  if (!isFullyUnderAnyRoot(target, [path.resolve(root)])) return null
  return target
}

/** Throws on any failure; `Promise.allSettled` in the caller turns that into a reported error. */
async function writeOne(options: ApplyRetailSyncOptions, item: RetailDriftItem): Promise<void> {
  const remote = item.remote
  if (!remote) {
    throw new Error('nothing to download.')
  }

  const target = targetFor(options.root, item.relativePath)
  if (!target) {
    throw new Error('refused an unsafe path.')
  }

  const bytes = await options.download(remote.key, remote.size)
  // The manifest size is the only integrity signal the worker gives us; a short read means a truncated
  // response, and writing it would leave a corrupt font that looks synced.
  if (bytes.byteLength !== remote.size) {
    throw new Error(`expected ${remote.size} bytes, got ${bytes.byteLength}.`)
  }

  // Same directory as the target: renameSync across volumes throws EXDEV.
  const partial = `${target}${RETAIL_PART_SUFFIX}`
  try {
    fs.writeFileSync(partial, bytes)
    fs.renameSync(partial, target)
  } catch (error) {
    try {
      fs.rmSync(partial, { force: true })
    } catch {
      // Best effort; the next run sweeps it.
    }
    throw error
  }
}

export async function applyRetailSync(options: ApplyRetailSyncOptions): Promise<RetailSyncResult> {
  const now = options.now ?? (() => new Date().toISOString())
  const concurrency = options.concurrency ?? RETAIL_DOWNLOAD_CONCURRENCY

  fs.mkdirSync(options.root, { recursive: true })
  sweepRetailPartials(options.root)

  const manifest: RetailLocalManifest = {
    version: 1,
    syncedAt: options.manifest.syncedAt,
    files: { ...options.manifest.files },
  }

  const todo = options.drift.filter(isSyncableDrift)
  const result: RetailSyncResult = {
    written: 0,
    // `removed` is reported, never deleted: the local file may already be installed and referenced by
    // the catalog, so pulling it out from under an install is not ours to decide.
    skipped: options.drift.length - todo.length,
    failed: 0,
    errors: [],
    manifest,
  }

  for (let index = 0; index < todo.length; index += concurrency) {
    const batch = todo.slice(index, index + concurrency)
    const settled = await Promise.allSettled(batch.map((item) => writeOne(options, item)))

    for (let offset = 0; offset < settled.length; offset += 1) {
      const outcome = settled[offset]
      const item = batch[offset]
      if (outcome.status === 'rejected') {
        result.failed += 1
        const reason = outcome.reason
        result.errors.push(
          `${item.relativePath}: ${reason instanceof Error ? reason.message : String(reason)}`,
        )
        continue
      }
      const remote = item.remote!
      manifest.files[item.relativePath] = {
        key: remote.key,
        relativePath: item.relativePath,
        size: remote.size,
        etag: remote.etag,
        glyphsFile: item.glyphsFile,
        // Keys are `<glyphsFile>/<revisionId>/<basename>`; counting from the end survives a glyphs
        // file name that itself contains a separator.
        revisionId: remote.key.split('/').at(-2) ?? '',
        syncedAt: now(),
      }
      result.written += 1
    }

    if (result.written > 0) {
      manifest.syncedAt = now()
      options.persist(manifest)
    }
  }

  if (todo.length === 0) {
    options.persist(manifest)
  }

  return result
}

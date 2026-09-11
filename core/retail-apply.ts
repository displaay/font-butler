import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { yieldEventLoop } from './event-loop.ts'
import { commitInstalledFile } from './install.ts'
import { getFontNative, type FontNative } from './native.ts'
import { resolveRetailInstallPath } from './retail-sync.ts'
import { isSyncableDrift, type RetailDriftItem, type RetailLocalManifest } from '../shared/retail.ts'

/** Not a font extension, so half-written downloads never appear as fonts in Fonts. */
export const RETAIL_PART_SUFFIX = '.part'

export const RETAIL_DOWNLOAD_CONCURRENCY = 4

export type RetailDownload = (key: string, expectedSize: number) => Promise<Uint8Array>

export type RetailInstallDest = {
  dest: string
  parked: boolean
}

export type ApplyRetailSyncOptions = {
  userFontsDir: string
  stagingDir: string
  rollbackDir: string
  drift: RetailDriftItem[]
  download: RetailDownload
  manifest: RetailLocalManifest
  /** Called after each batch so an interrupted sync does not re-download what already landed. */
  persist: (
    manifest: RetailLocalManifest,
    writtenDests?: Array<{ relativePath: string; dest: string; parked: boolean }>,
  ) => unknown | Promise<unknown>
  destFor?: (relativePath: string) => RetailInstallDest | null
  /** Serialize only the final destination resolution and commit, leaving downloads concurrent. */
  withLock?: <T>(task: () => T | Promise<T>) => Promise<T>
  native?: FontNative
  concurrency?: number
  now?: () => string
}

export type RetailSyncResult = {
  written: number
  skipped: number
  failed: number
  errors: string[]
  manifest: RetailLocalManifest
  writtenDests: Array<{ relativePath: string; dest: string; parked: boolean }>
}

/** Leftovers from an interrupted run. Removed on entry so they cannot accumulate. */
export function sweepRetailPartials(dir: string): number {
  let removed = 0
  if (!fs.existsSync(dir)) return 0
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(RETAIL_PART_SUFFIX)) continue
    try {
      fs.rmSync(path.join(dir, entry.name), { force: true })
      removed += 1
    } catch {
      // A locked leftover is harmless; the next write replaces it.
    }
  }
  return removed
}

function defaultDest(userFontsDir: string, relativePath: string): RetailInstallDest | null {
  const dest = resolveRetailInstallPath(userFontsDir, relativePath)
  if (!dest) return null
  return { dest, parked: false }
}

function writeParkedFile(dest: string, stagedPath: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const tempDest = `${dest}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.copyFileSync(stagedPath, tempDest)
    fs.renameSync(tempDest, dest)
  } finally {
    if (fs.existsSync(tempDest)) fs.rmSync(tempDest, { force: true })
  }
}

/** Throws on any failure; `Promise.allSettled` in the caller turns that into a reported error. */
async function writeOne(options: ApplyRetailSyncOptions, item: RetailDriftItem): Promise<RetailInstallDest> {
  const remote = item.remote
  if (!remote) {
    throw new Error('nothing to download.')
  }

  const initialTarget = options.destFor
    ? options.destFor(item.relativePath)
    : defaultDest(options.userFontsDir, item.relativePath)
  if (!initialTarget) {
    throw new Error('refused an unsafe path.')
  }

  const bytes = await options.download(remote.key, remote.size)
  // The manifest size is the only integrity signal the worker gives us; a short read means a truncated
  // response, and writing it would leave a corrupt font that looks synced.
  if (bytes.byteLength !== remote.size) {
    throw new Error(`expected ${remote.size} bytes, got ${bytes.byteLength}.`)
  }

  await fs.promises.mkdir(options.stagingDir, { recursive: true })
  const ext = path.extname(initialTarget.dest) || '.otf'
  const stagedPath = path.join(options.stagingDir, `${crypto.randomUUID()}${ext}`)
  const partial = `${stagedPath}${RETAIL_PART_SUFFIX}`
  try {
    await fs.promises.writeFile(partial, bytes)
    await fs.promises.rename(partial, stagedPath)
    const commit = async () => {
      const target = options.destFor
        ? options.destFor(item.relativePath)
        : initialTarget
      if (!target) throw new Error('refused an unsafe path.')
      if (target.parked) {
        writeParkedFile(target.dest, stagedPath)
      } else {
        await commitInstalledFile({
          dest: target.dest,
          stagedPath,
          rollbackDir: options.rollbackDir,
          native: options.native ?? getFontNative(),
        })
      }
      return target
    }
    const target = options.withLock ? await options.withLock(commit) : await commit()
    return target
  } catch (error) {
    try {
      fs.rmSync(partial, { force: true })
    } catch {
      // Best effort; the next run sweeps it.
    }
    throw error
  } finally {
    try {
      fs.rmSync(stagedPath, { force: true })
    } catch {
      // Staging is disposable.
    }
  }
}

export async function applyRetailSync(options: ApplyRetailSyncOptions): Promise<RetailSyncResult> {
  const now = options.now ?? (() => new Date().toISOString())
  const concurrency = options.concurrency ?? RETAIL_DOWNLOAD_CONCURRENCY

  fs.mkdirSync(options.userFontsDir, { recursive: true })
  fs.mkdirSync(options.stagingDir, { recursive: true })
  fs.mkdirSync(options.rollbackDir, { recursive: true })
  sweepRetailPartials(options.stagingDir)

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
    writtenDests: [],
  }

  for (let index = 0; index < todo.length; index += concurrency) {
    const batch = todo.slice(index, index + concurrency)
    const settled = await Promise.allSettled(batch.map((item) => writeOne(options, item)))
    const batchWritten: Array<{ relativePath: string; dest: string; parked: boolean }> = []

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
      const installed = outcome.value
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
        installedPath: installed.dest,
        parked: installed.parked,
      }
      const written = {
        relativePath: item.relativePath,
        dest: installed.dest,
        parked: installed.parked,
      }
      result.writtenDests.push(written)
      batchWritten.push(written)
      result.written += 1
    }

    if (result.written > 0) {
      manifest.syncedAt = now()
      await options.persist(manifest, batchWritten)
    }
    // Downloads are concurrent; cataloging and native installs are not. Yield so the API that
    // owns this loop can keep serving the running app between batches of an initial sync.
    await yieldEventLoop()
  }

  if (todo.length === 0) {
    options.persist(manifest)
  }

  return result
}

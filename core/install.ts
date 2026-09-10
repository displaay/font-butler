import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { sourceFileExists } from './catalog.ts'
import { normalizeFormat } from './formats.ts'
import { parseFontFile, readFileStat, type ParsedFont } from './parse.ts'
import type { CatalogEntry } from './types.ts'
import { ensureFontActivation, type FontNative } from './native.ts'

export type StagedFont = {
  stagedPath: string
  parsed: ParsedFont
  stat: { mtimeMs: number; size: number }
}

export function stageFontFile(sourcePath: string, stagingDir: string): StagedFont {
  if (!sourceFileExists(sourcePath)) {
    throw new Error('The source file is missing.')
  }
  const sourceStat = readFileStat(sourcePath)
  fs.mkdirSync(stagingDir, { recursive: true })
  const ext = path.extname(sourcePath) || '.ttf'
  const stagedPath = path.join(stagingDir, `${crypto.randomUUID()}${ext}`)
  try {
    fs.copyFileSync(sourcePath, stagedPath)
    const parsed = parseFontFile(stagedPath)
    if (parsed.faces.length === 0) {
      throw new Error('Could not read any faces in that font.')
    }
    return { stagedPath, parsed, stat: sourceStat }
  } catch (error) {
    if (fs.existsSync(stagedPath)) {
      fs.rmSync(stagedPath, { force: true })
    }
    throw error
  }
}

export function removeStagedFile(stagedPath: string | undefined): void {
  if (stagedPath && fs.existsSync(stagedPath)) {
    fs.rmSync(stagedPath, { force: true })
  }
}

export async function commitInstalledFile(options: {
  dest: string
  stagedPath: string
  rollbackDir: string
  native: FontNative
}): Promise<void> {
  const { dest, stagedPath, rollbackDir, native } = options
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.mkdirSync(rollbackDir, { recursive: true })
  let rollback: string | undefined
  if (fs.existsSync(dest)) {
    rollback = path.join(rollbackDir, `${crypto.randomUUID()}${path.extname(dest) || '.ttf'}`)
    fs.copyFileSync(dest, rollback)
  }
  try {
    fs.copyFileSync(stagedPath, dest)
    await ensureFontActivation(native, dest, true)
    if (rollback) {
      fs.rmSync(rollback, { force: true })
      rollback = undefined
    }
  } catch (error) {
    if (rollback && fs.existsSync(rollback)) {
      fs.copyFileSync(rollback, dest)
      try {
        await ensureFontActivation(native, dest, true).catch(() => {
          // Restoring the previous bytes is best-effort after a failed activation.
        })
      } catch {
        // Restoring the previous bytes is best-effort after a failed activation.
      }
    } else if (fs.existsSync(dest) && path.resolve(dest) !== path.resolve(stagedPath)) {
      try {
        await native.unregisterFont(dest)
      } catch {
        // The new copy should not stay behind after a failed first install.
      }
      fs.rmSync(dest, { force: true })
    }
    throw error
  } finally {
    if (rollback && fs.existsSync(rollback)) {
      fs.rmSync(rollback, { force: true })
    }
  }
}

export function applyInstalledMetadata(
  entry: CatalogEntry,
  dest: string,
  staged: StagedFont,
  options: { externalSource: boolean; sourcePath?: string; fingerprint?: string },
): void {
  const destStat = readFileStat(dest)
  entry.installedPath = dest
  entry.disabledPath = undefined
  entry.faces = staged.parsed.faces
  entry.format = staged.parsed.format
  if (staged.parsed.previewSample) entry.previewSample = staged.parsed.previewSample
  entry.installedSnapshotMtimeMs = staged.stat.mtimeMs
  entry.installedSnapshotSize = staged.stat.size
  if (options.sourcePath) {
    entry.sourcePath = options.sourcePath
  }
  if (options.externalSource) {
    entry.sourceMtimeMs = staged.stat.mtimeMs
    entry.sourceSize = staged.stat.size
    entry.sourcePresent = true
  } else {
    entry.sourceMtimeMs = destStat.mtimeMs
    entry.sourceSize = destStat.size
    entry.sourcePresent = false
  }
  entry.status = 'installed'
  if (options.fingerprint) {
    entry.installedFingerprint = options.fingerprint
    if (options.externalSource) {
      entry.sourceFingerprint = options.fingerprint
    }
  }
}

export function extensionForFormat(format: string, fallbackPath: string): string {
  const fromFormat = normalizeFormat(format)
  if (fromFormat) return `.${fromFormat}`
  return path.extname(fallbackPath) || '.ttf'
}

export function uniqueSiblingPath(filePath: string): string {
  const ext = path.extname(filePath) || '.ttf'
  const stem = path.basename(filePath, ext)
  const dir = path.dirname(filePath)
  const hash = crypto.randomBytes(4).toString('hex')
  return path.join(dir, `${stem}-${hash}${ext}`)
}

export function uniquePathFromOriginal(dir: string, originalPath: string): string {
  const ext = path.extname(originalPath) || '.ttf'
  const stem = path.basename(originalPath, ext)
  const digest = crypto.createHash('sha1').update(path.resolve(originalPath)).digest('hex').slice(0, 10)
  return path.join(dir, `${stem}-${digest}${ext}`)
}

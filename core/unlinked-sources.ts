import fs from 'node:fs'
import path from 'node:path'
import type { AppPaths } from './paths.ts'

type UnlinkedSourceFile = {
  version: 1
  paths: string[]
}

function listPath(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'unlinked-sources.json')
}

/**
 * Absolute path with symlinks resolved, so the same file matches however it was named.
 * macOS paths are compared case-insensitively and in composed form.
 */
function normalizeUnlinkedPath(filePath: string): string {
  const resolved = path.resolve(filePath)
  let absolute = resolved
  if (typeof fs.realpathSync.native === 'function') {
    try {
      absolute = fs.realpathSync.native(resolved)
    } catch {
      absolute = resolved
    }
  }
  const composed = absolute.normalize('NFC')
  return process.platform === 'darwin' ? composed.toLowerCase() : composed
}

/** A list that cannot be parsed is moved aside so the next write does not erase it. */
function backupCorruptUnlinkedList(target: string): void {
  if (!fs.existsSync(target)) return
  try {
    JSON.parse(fs.readFileSync(target, 'utf8'))
  } catch {
    fs.renameSync(target, `${target}.bak`)
  }
}

function loadUnlinkedPaths(paths: AppPaths): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(listPath(paths), 'utf8')) as {
      version?: number
      paths?: unknown
      entries?: Array<{ path?: string }>
    }
    if (parsed?.version !== 1) return []
    if (Array.isArray(parsed.paths)) {
      return parsed.paths.filter((item): item is string => typeof item === 'string' && item.length > 0)
    }
    // Earlier builds stored a fingerprint next to the path. The path alone is the key.
    if (Array.isArray(parsed.entries)) {
      return parsed.entries
        .map((entry) => entry?.path)
        .filter((item): item is string => typeof item === 'string' && item.length > 0)
    }
  } catch {
    // Missing or unreadable: nothing is ignored.
  }
  return []
}

function saveUnlinkedPaths(paths: AppPaths, sourcePaths: string[]): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  const data: UnlinkedSourceFile = { version: 1, paths: sourcePaths }
  const target = listPath(paths)
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data))
  backupCorruptUnlinkedList(target)
  fs.renameSync(temp, target)
}

/** Remember a source that was uninstalled and unlinked. Later bytes at this path stay ignored. */
export function rememberUnlinkedSource(paths: AppPaths, sourcePath: string): void {
  if (!sourcePath) return
  const resolved = normalizeUnlinkedPath(sourcePath)
  const stored = loadUnlinkedPaths(paths).map(normalizeUnlinkedPath)
  if (stored.includes(resolved)) return
  saveUnlinkedPaths(paths, [...stored, resolved])
}

/**
 * A manual re-add of this path (drag-in, Add, or Install from Finder) accepts the file again.
 * A watch-folder update does not call this.
 */
export function allowUnlinkedSource(paths: AppPaths, sourcePath: string): void {
  if (!sourcePath) return
  const resolved = normalizeUnlinkedPath(sourcePath)
  const stored = loadUnlinkedPaths(paths)
  const next = stored.filter((item) => normalizeUnlinkedPath(item) !== resolved)
  if (next.length === stored.length) return
  saveUnlinkedPaths(paths, next)
}

/** True when this path was unlinked, whatever the file's bytes are now. */
export function isUnlinkedSource(paths: AppPaths, sourcePath: string): boolean {
  if (!sourcePath) return false
  const resolved = normalizeUnlinkedPath(sourcePath)
  return loadUnlinkedPaths(paths).some((item) => normalizeUnlinkedPath(item) === resolved)
}

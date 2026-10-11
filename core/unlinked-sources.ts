import fs from 'node:fs'
import path from 'node:path'
import { logMain } from './main-log.ts'
import type { AppPaths } from './paths.ts'

type UnlinkedSourceFile = {
  version: 1
  paths: string[]
}

type CaseMode = 'sensitive' | 'insensitive' | 'unknown'

type LoadedList = {
  /** True when the file is bad and no valid .bak can stand in. Auto-import stays off. */
  unknown: boolean
  paths: string[]
}

function listPath(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'unlinked-sources.json')
}

function backupPath(target: string): string {
  return `${target}.bak`
}

let caseModeOverride: CaseMode | null = null
const caseModeByDev = new Map<number, CaseMode>()

/** Tests pick sensitive, insensitive, or unknown. Production leaves this unset. */
export function setUnlinkedCaseModeForTest(mode: CaseMode | null): void {
  caseModeOverride = mode
}

let renameUnlinkedBackup: (from: string, to: string) => void = (from, to) => {
  fs.renameSync(from, to)
}

/** Tests force the backup rename to fail. Production uses fs.renameSync. */
export function setUnlinkedBackupRenameForTest(
  rename: ((from: string, to: string) => void) | undefined,
): void {
  renameUnlinkedBackup = rename ?? ((from, to) => fs.renameSync(from, to))
}

function nativeRealpath(filePath: string): string | null {
  if (typeof fs.realpathSync.native !== 'function') return null
  try {
    return fs.realpathSync.native(filePath)
  } catch {
    return null
  }
}

/**
 * Resolve symlinks. A missing file uses the real parent directory plus its basename,
 * then path.resolve when the parent cannot be resolved either.
 */
function resolveUnlinkedPath(filePath: string): string {
  const resolved = path.resolve(filePath)
  const direct = nativeRealpath(resolved)
  if (direct) return direct
  const parent = nativeRealpath(path.dirname(resolved))
  if (parent) return path.join(parent, path.basename(resolved))
  return resolved
}

function normalizeUnlinkedPath(filePath: string): string {
  return resolveUnlinkedPath(filePath).normalize('NFC')
}

function flipCase(name: string): string | null {
  if (!/[A-Za-z]/.test(name)) return null
  const flipped = [...name]
    .map((char) => {
      const lower = char.toLowerCase()
      const upper = char.toUpperCase()
      if (lower === upper) return char
      return char === lower ? upper : lower
    })
    .join('')
  return flipped === name ? null : flipped
}

function probeCase(parent: string, name: string): CaseMode | null {
  const flipped = flipCase(name)
  if (!flipped) return null
  const original = path.join(parent, name)
  const alternate = path.join(parent, flipped)
  try {
    const left = fs.statSync(original)
    const right = fs.statSync(alternate)
    return left.dev === right.dev && left.ino === right.ino ? 'insensitive' : 'sensitive'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'sensitive'
    return null
  }
}

function detectCaseMode(existingDir: string): CaseMode {
  const own = probeCase(path.dirname(existingDir), path.basename(existingDir))
  if (own) return own
  let names: string[] = []
  try {
    names = fs.readdirSync(existingDir)
  } catch {
    return 'unknown'
  }
  for (const name of names) {
    const probed = probeCase(existingDir, name)
    if (probed) return probed
  }
  return 'unknown'
}

function existingAncestor(filePath: string): string | null {
  let cursor = path.resolve(filePath)
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) return null
    cursor = parent
  }
  return cursor
}

/** Case-insensitive volumes fold. Unknown volumes match either case. Sensitive volumes do not. */
function caseModeFor(filePath: string): CaseMode {
  if (caseModeOverride) return caseModeOverride
  const ancestor = existingAncestor(filePath)
  if (!ancestor) return 'unknown'
  try {
    const stat = fs.statSync(ancestor)
    const cached = caseModeByDev.get(stat.dev)
    if (cached) return cached
    const mode = detectCaseMode(ancestor)
    if (mode !== 'unknown') caseModeByDev.set(stat.dev, mode)
    return mode
  } catch {
    return 'unknown'
  }
}

function keysMatch(stored: string, candidate: string): boolean {
  if (stored === candidate) return true
  const mode = caseModeFor(candidate)
  if (mode === 'sensitive') return false
  return stored.toLowerCase() === candidate.toLowerCase()
}

function readListDocument(filePath: string): 'missing' | 'invalid' | { paths: string[] } {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    return 'invalid'
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'invalid'
  }
  if (!parsed || typeof parsed !== 'object') return 'invalid'
  const record = parsed as { version?: unknown; paths?: unknown; entries?: unknown }
  if (record.version !== 1) return 'invalid'
  if (Array.isArray(record.paths)) {
    return {
      paths: record.paths.filter((item): item is string => typeof item === 'string' && item.length > 0),
    }
  }
  // Earlier builds stored a fingerprint next to the path. The path alone is the key.
  if (Array.isArray(record.entries)) {
    return {
      paths: record.entries
        .map((entry) =>
          entry && typeof entry === 'object' ? (entry as { path?: unknown }).path : undefined,
        )
        .filter((item): item is string => typeof item === 'string' && item.length > 0),
    }
  }
  return 'invalid'
}

function loadUnlinkedList(target: string): LoadedList {
  const main = readListDocument(target)
  if (main !== 'missing' && main !== 'invalid') return { unknown: false, paths: main.paths }
  if (main === 'missing') return { unknown: false, paths: [] }
  const backup = readListDocument(backupPath(target))
  if (backup !== 'missing' && backup !== 'invalid') return { unknown: false, paths: backup.paths }
  return { unknown: true, paths: [] }
}

type ListCache = {
  target: string
  mainKey: string
  bakKey: string
  unknown: boolean
  keys: string[]
}

let listCache: ListCache | null = null

function statKey(filePath: string): string {
  try {
    const stat = fs.statSync(filePath)
    return `${stat.mtimeMs}:${stat.size}:${stat.ino}`
  } catch {
    return 'missing'
  }
}

/** One realpath pass for the stored list, reused until the file or its .bak changes. */
function cachedList(paths: AppPaths): ListCache {
  const target = listPath(paths)
  const mainKey = statKey(target)
  const bakKey = statKey(backupPath(target))
  if (
    listCache &&
    listCache.target === target &&
    listCache.mainKey === mainKey &&
    listCache.bakKey === bakKey
  ) {
    return listCache
  }
  const loaded = loadUnlinkedList(target)
  const keys = loaded.unknown ? [] : loaded.paths.map((item) => normalizeUnlinkedPath(item))
  listCache = { target, mainKey, bakKey, unknown: loaded.unknown, keys }
  return listCache
}

function nextBackupPath(target: string): string {
  const plain = backupPath(target)
  if (!fs.existsSync(plain)) return plain
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const stamped = `${target}.${stamp}.bak`
  if (!fs.existsSync(stamped)) return stamped
  return `${target}.${stamp}.${process.pid}.bak`
}

function saveUnlinkedPaths(paths: AppPaths, sourcePaths: string[]): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  const target = listPath(paths)
  const main = readListDocument(target)
  const data: UnlinkedSourceFile = { version: 1, paths: sourcePaths }
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data))
  if (main === 'invalid') {
    try {
      renameUnlinkedBackup(target, nextBackupPath(target))
    } catch (error) {
      // The forget already succeeded. Losing the rename must not undo that.
      logMain(
        'catalog',
        `could not back up unlinked-sources.json: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  fs.renameSync(temp, target)
  listCache = null
}

function uniquePaths(paths: string[]): string[] {
  const unique: string[] = []
  for (const item of paths) {
    if (unique.some((kept) => keysMatch(kept, item))) continue
    unique.push(item)
  }
  return unique
}

/** Remember a source that was uninstalled and unlinked. Later bytes at this path stay ignored. */
export function rememberUnlinkedSource(paths: AppPaths, sourcePath: string): void {
  if (!sourcePath) return
  const resolved = normalizeUnlinkedPath(sourcePath)
  const loaded = cachedList(paths)
  if (!loaded.unknown && loaded.keys.some((item) => keysMatch(item, resolved))) return
  saveUnlinkedPaths(paths, uniquePaths([...loaded.keys, resolved]))
}

/**
 * A manual re-add of this path (drag-in, Add, or Install from Finder) accepts the file again.
 * A watch-folder update does not call this. An unreadable list does not block the add.
 */
export function allowUnlinkedSource(paths: AppPaths, sourcePath: string): void {
  if (!sourcePath) return
  const loaded = cachedList(paths)
  if (loaded.unknown) return
  const resolved = normalizeUnlinkedPath(sourcePath)
  const next = loaded.keys.filter((item) => !keysMatch(item, resolved))
  if (next.length === loaded.keys.length) return
  saveUnlinkedPaths(paths, next)
}

/**
 * True when this path was unlinked, or the list is unreadable and no valid backup can stand in.
 * Watch and inbox treat that unknown list as "do not auto-import".
 */
export function isUnlinkedSource(paths: AppPaths, sourcePath: string): boolean {
  if (!sourcePath) return false
  const loaded = cachedList(paths)
  if (loaded.unknown) return true
  const resolved = normalizeUnlinkedPath(sourcePath)
  return loaded.keys.some((item) => keysMatch(item, resolved))
}

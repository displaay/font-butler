import fs from 'node:fs'
import path from 'node:path'
import { publishUnlinkedListReset } from './events.ts'
import { logMain } from './main-log.ts'
import type { AppPaths } from './paths.ts'

const UNLINKED_LIST_RESET_MESSAGE =
  "Font Buttler couldn't read its list of unlinked fonts and started a new one. Fonts you unlinked earlier may reappear from watch folders. You can unlink them again."

type UnlinkedSourceFile = {
  version: 1
  paths: string[]
}

type CaseMode = 'sensitive' | 'insensitive' | 'unknown'

type ListStatus = 'ready' | 'resettable' | 'read-error'

type LoadedList = {
  /**
   * ready: missing, valid, or recovered from a valid .bak.
   * resettable: the file read, but the JSON is bad or the shape is wrong, and no valid .bak can stand in.
   * read-error: the read failed for a reason other than a missing file. Leave the file untouched.
   */
  status: ListStatus
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

let readUnlinkedListFile: (filePath: string) => string = (filePath) => fs.readFileSync(filePath, 'utf8')

/** Tests simulate EACCES and other read failures. Production reads the file directly. */
export function setUnlinkedListReadForTest(read: ((filePath: string) => string) | undefined): void {
  readUnlinkedListFile = read ?? ((filePath) => fs.readFileSync(filePath, 'utf8'))
  listCache = null
}

let unlinkedListSaveFault: (() => void) | undefined

/** Tests make the reset write fail. Production does not set this. */
export function setUnlinkedListSaveFaultForTest(fault: (() => void) | undefined): void {
  unlinkedListSaveFault = fault
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
    caseModeByDev.set(stat.dev, mode)
    return mode
  } catch {
    return 'unknown'
  }
}

function keysMatch(stored: string, candidate: string, mode: CaseMode): boolean {
  if (stored === candidate) return true
  if (mode === 'sensitive') return false
  return stored.toLowerCase() === candidate.toLowerCase()
}

function readListDocument(filePath: string): 'missing' | 'unreadable' | 'invalid' | { paths: string[] } {
  let raw: string
  try {
    raw = readUnlinkedListFile(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    return 'unreadable'
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
  if (main === 'unreadable') return { status: 'read-error', paths: [] }
  if (main !== 'missing' && main !== 'invalid') return { status: 'ready', paths: main.paths }
  if (main === 'missing') return { status: 'ready', paths: [] }
  const backup = readListDocument(backupPath(target))
  if (backup !== 'missing' && backup !== 'invalid' && backup !== 'unreadable') {
    return { status: 'ready', paths: backup.paths }
  }
  return { status: 'resettable', paths: [] }
}

type ListCache = {
  target: string
  mainKey: string
  bakKey: string
  status: ListStatus
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
  const keys = loaded.status === 'ready' ? loaded.paths.map((item) => normalizeUnlinkedPath(item)) : []
  listCache = { target, mainKey, bakKey, status: loaded.status, keys }
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

/** Timestamped copies only. The plain `.bak` stays, because that is the recovery source. */
function pruneTimestampedBackups(target: string): void {
  const dir = path.dirname(target)
  const base = path.basename(target)
  const plain = `${base}.bak`
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  const ranked = names
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith('.bak') && name !== plain)
    .map((name) => {
      const full = path.join(dir, name)
      let mtime = 0
      try {
        mtime = fs.statSync(full).mtimeMs
      } catch {
        mtime = 0
      }
      return { full, name, mtime }
    })
    .sort((left, right) => right.mtime - left.mtime || right.name.localeCompare(left.name))
  for (const extra of ranked.slice(3)) {
    try {
      fs.rmSync(extra.full, { force: true })
    } catch {
      // A leftover backup must not fail the unlink that already succeeded.
    }
  }
}

function saveUnlinkedPaths(paths: AppPaths, sourcePaths: string[]): void {
  unlinkedListSaveFault?.()
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  const target = listPath(paths)
  const main = readListDocument(target)
  if (main === 'unreadable') {
    logMain('catalog', 'unlinked-sources.json could not be read, so it was left unchanged.')
    return
  }
  const data: UnlinkedSourceFile = { version: 1, paths: sourcePaths }
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data))
  let backupFailure: string | undefined
  if (main === 'invalid') {
    try {
      renameUnlinkedBackup(target, nextBackupPath(target))
      try {
        pruneTimestampedBackups(target)
      } catch {
        // The corrupt file is already aside. Pruning old copies must not fail the write.
      }
    } catch (error) {
      // The forget already succeeded. Losing the rename must not undo that.
      backupFailure = error instanceof Error ? error.message : String(error)
    }
  }
  fs.renameSync(temp, target)
  listCache = null
  if (backupFailure) {
    logMain(
      'catalog',
      `could not back up unlinked-sources.json: ${backupFailure}. The corrupt file was overwritten with a new list.`,
    )
  }
}

function uniquePaths(paths: string[], mode: CaseMode): string[] {
  const unique: string[] = []
  for (const item of paths) {
    if (unique.some((kept) => keysMatch(kept, item, mode))) continue
    unique.push(item)
  }
  return unique
}

function logUnlinkedResetFailure(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error)
  logMain(
    'catalog',
    `could not reset unlinked-sources.json: ${reason}. Watch and inbox will not auto-import until the list can be read.`,
  )
}

/**
 * A list that reads but does not parse, with no valid backup, blocks every auto-import.
 * Move it aside and write an empty list so watch and inbox can resume.
 * A read error is left untouched. Runs at startup and on a manual add.
 */
export function recoverUnlinkedSources(paths: AppPaths): boolean {
  const loaded = cachedList(paths)
  if (loaded.status !== 'resettable') return false
  saveUnlinkedPaths(paths, [])
  logMain(
    'catalog',
    'Reset unlinked-sources.json because it could not be read and had no valid backup.',
  )
  publishUnlinkedListReset({
    kind: 'warning',
    source: 'unlinked-list',
    message: UNLINKED_LIST_RESET_MESSAGE,
  })
  return true
}

/** Startup and manual add. A failed reset is logged and does not block the caller. */
export function recoverUnlinkedSourcesSafely(paths: AppPaths): void {
  try {
    recoverUnlinkedSources(paths)
  } catch (error) {
    logUnlinkedResetFailure(error)
  }
}

/** Remember a source that was uninstalled and unlinked. Later bytes at this path stay ignored. */
export function rememberUnlinkedSource(paths: AppPaths, sourcePath: string): void {
  if (!sourcePath) return
  const resolved = normalizeUnlinkedPath(sourcePath)
  const loaded = cachedList(paths)
  if (loaded.status === 'read-error') return
  const mode = caseModeFor(resolved)
  if (loaded.status === 'ready' && loaded.keys.some((item) => keysMatch(item, resolved, mode))) return
  saveUnlinkedPaths(paths, uniquePaths([...loaded.keys, resolved], mode))
}

/**
 * A manual re-add of this path (drag-in, Add, or Install from Finder) accepts the file again.
 * A watch-folder update does not call this. An unreadable list does not block the add.
 */
export function allowUnlinkedSource(paths: AppPaths, sourcePath: string): void {
  if (!sourcePath) return
  const loaded = cachedList(paths)
  if (loaded.status === 'read-error') return
  if (loaded.status === 'resettable') {
    recoverUnlinkedSourcesSafely(paths)
    return
  }
  const resolved = normalizeUnlinkedPath(sourcePath)
  const mode = caseModeFor(resolved)
  const next = loaded.keys.filter((item) => !keysMatch(item, resolved, mode))
  if (next.length === loaded.keys.length) return
  saveUnlinkedPaths(paths, next)
}

/**
 * True when this path was unlinked, or the list cannot be trusted yet.
 * Watch and inbox treat a resettable list and a read error as "do not auto-import".
 */
export function isUnlinkedSource(paths: AppPaths, sourcePath: string): boolean {
  if (!sourcePath) return false
  const loaded = cachedList(paths)
  if (loaded.status !== 'ready') return true
  const resolved = normalizeUnlinkedPath(sourcePath)
  const mode = caseModeFor(resolved)
  return loaded.keys.some((item) => keysMatch(item, resolved, mode))
}

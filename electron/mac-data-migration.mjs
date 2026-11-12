/**
 * Move macOS library folders onto the Cuttler names.
 *
 * 0.4.0 kept data in Application Support/Font Buttler (and fonts in
 * Library/Fonts/Font Buttler) on purpose. This release moves those folders,
 * and a leftover Font Butler (one t) folder, on first launch.
 *
 * A destination that already has real data is not replaced and the source
 * is not deleted. That case is stalled: the caller shows it. A silent
 * "leave it" with no flag is the library-vanished bug.
 */

import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const APP_FOLDER_NAME = 'Cuttler'
/** 0.4.0 on-disk name. Higher priority than the one-t folder. */
export const PREVIOUS_APP_FOLDER_NAME = 'Font Buttler'
/** Pre-0.4.0 name, one t. */
export const LEGACY_APP_FOLDER_NAME = 'Font Butler'
export const LEGACY_APP_FOLDER_NAMES = [PREVIOUS_APP_FOLDER_NAME, LEGACY_APP_FOLDER_NAME]
export const FOLDER_MIGRATION_FILE = 'folder-migration.json'
/** Sibling of the library folders. Survives a crash between rename and path rewrite. */
export const PENDING_MIGRATION_FILE = 'cuttler-folder-migration.json'
export const MIGRATION_STALL_ENV = 'FONT_BUTLER_MIGRATION_STALL'
export const MIGRATION_DATA_ROOT_ENV = 'FONT_BUTLER_MIGRATION_DATA_ROOT'
/** Set before main's migrate call, including when that call throws. */
export const MIGRATION_HANDLED_ENV = 'FONT_BUTLER_MIGRATION_HANDLED'

/** Directories that hold user files, not app state. A bad file here must not block launch. */
const USER_CONTENT_DIRS = new Set([
  'sources',
  'uploads',
  'revisions',
  'retail-cache',
  'journal',
  'Disabled',
  'Backups',
  'user-fonts',
  'computer-fonts',
  'system-fonts',
  'supplemental',
  'office-cache',
  'ats-cache',
  'adobe-fonts',
])

function rewritePathPrefix(value, from, to) {
  if (typeof value !== 'string' || !from || from === to) return value
  if (value === from) return to
  const prefix = from.endsWith(path.sep) ? from : from + path.sep
  if (value.startsWith(prefix)) return to + value.slice(from.length)
  return value
}

function lstatOrNull(dir) {
  try {
    return fs.lstatSync(dir)
  } catch {
    return null
  }
}

function realDirectory(dir) {
  const st = lstatOrNull(dir)
  return Boolean(st && st.isDirectory() && !st.isSymbolicLink())
}

/** Follow a symlink. A broken link is not a directory and is not "missing". */
function followedDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/** True when the folder is missing, or has neither catalog.json nor settings.json. */
export function isFreshDataRoot(dir) {
  if (!followedDirectory(dir)) {
    if (lstatOrNull(dir)?.isSymbolicLink()) return false
    return !lstatOrNull(dir)
  }
  return (
    !fs.existsSync(path.join(dir, 'catalog.json')) && !fs.existsSync(path.join(dir, 'settings.json'))
  )
}

/** True when the folder is missing or contains no entries. A broken symlink is not empty. */
export function isEmptyDir(dir) {
  if (!followedDirectory(dir)) {
    if (lstatOrNull(dir)?.isSymbolicLink()) return false
    return !lstatOrNull(dir)
  }
  try {
    return fs.readdirSync(dir).length === 0
  } catch {
    return false
  }
}

function hashFile(file) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex')
}

function describeTree(root) {
  const rows = []
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      const rel = path.relative(root, abs)
      if (entry.isSymbolicLink()) {
        rows.push(`link\0${rel}\0${fs.readlinkSync(abs)}`)
      } else if (entry.isDirectory()) {
        rows.push(`dir\0${rel}`)
        walk(abs)
      } else if (entry.isFile()) {
        const size = fs.statSync(abs).size
        rows.push(`file\0${rel}\0${size}\0${hashFile(abs)}`)
      } else {
        rows.push(`other\0${rel}`)
      }
    }
  }
  walk(root)
  return rows
}

function directoryTreesMatch(from, to) {
  const left = describeTree(from)
  const right = describeTree(to)
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

function copyTree(from, to, copyFileSync) {
  fs.mkdirSync(to, { recursive: true })
  const entries = fs.readdirSync(from, { withFileTypes: true })
  for (const entry of entries) {
    const src = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(src), dest)
    } else if (entry.isDirectory()) {
      copyTree(src, dest, copyFileSync)
    } else if (entry.isFile()) {
      copyFileSync(src, dest)
    } else {
      const error = new Error(`Cannot copy ${src}`)
      error.code = 'ECOPY'
      throw error
    }
  }
}

/**
 * Rename `from` onto `to`. A fresh destination is moved aside and removed
 * only after the new folder is in place. Cross-device renames copy to a
 * sibling temp, check the copy, then rename it into place and remove the source.
 * `hooks.renameSync` is only the from→to attempt, so tests can force EXDEV.
 */
export function moveDirectoryAtomic(from, to, hooks = {}) {
  const renameAcross = hooks.renameSync ?? fs.renameSync
  const copyFileSync = hooks.copyFileSync ?? fs.copyFileSync
  fs.mkdirSync(path.dirname(to), { recursive: true })
  let backup = null
  if (realDirectory(to) || lstatOrNull(to)) {
    backup = `${to}.fresh-${process.pid}-${process.hrtime.bigint()}`
    fs.renameSync(to, backup)
  }
  const restoreBackup = () => {
    if (backup && fs.existsSync(backup) && !lstatOrNull(to)) {
      fs.renameSync(backup, to)
    }
  }
  try {
    try {
      renameAcross(from, to)
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error
      const tmp = `${to}.partial-${process.pid}-${process.hrtime.bigint()}`
      try {
        copyTree(from, tmp, copyFileSync)
        if (!directoryTreesMatch(from, tmp)) {
          const mismatch = new Error('Copied folder did not match the source')
          mismatch.code = 'EVERIFY'
          throw mismatch
        }
        fs.renameSync(tmp, to)
        fs.rmSync(from, { recursive: true, force: true })
      } catch (copyError) {
        fs.rmSync(tmp, { recursive: true, force: true })
        throw copyError
      }
    }
  } catch (error) {
    restoreBackup()
    throw error
  }
  if (backup) fs.rmSync(backup, { recursive: true, force: true })
}

function applyReplacements(value, replacements) {
  let next = value
  for (const { from, to } of replacements) {
    next = rewritePathPrefix(next, from, to)
  }
  return next
}

function rewriteJsonValue(value, replacements) {
  if (typeof value === 'string') return applyReplacements(value, replacements)
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const rewritten = rewriteJsonValue(item, replacements)
      if (rewritten !== item) changed = true
      return rewritten
    })
    return changed ? next : value
  }
  if (value && typeof value === 'object') {
    let changed = false
    const next = {}
    for (const [key, item] of Object.entries(value)) {
      const rewritten = rewriteJsonValue(item, replacements)
      if (rewritten !== item) changed = true
      next[key] = rewritten
    }
    return changed ? next : value
  }
  return value
}

function commitJson(filePath, value) {
  const tmp = `${filePath}.${process.pid}.${process.hrtime.bigint()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
    fs.renameSync(tmp, filePath)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

/**
 * Rewrite every absolute path in a JSON file, then replace it with tmp-then-rename.
 * A read or write failure throws so the caller can leave a retry marker.
 */
export function rewriteJsonLegacyPaths(filePath, replacements) {
  if (!filePath || !replacements?.length || !fs.existsSync(filePath)) return
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read ${filePath} to rewrite library paths`, { cause: error })
  }
  const next = rewriteJsonValue(parsed, replacements)
  if (next === parsed) return
  commitJson(filePath, next)
}

function catalogBackupPath(catalogPath) {
  return path.join(path.dirname(catalogPath), 'catalog.json.bak')
}

/** Same shape loadCatalog accepts: version 1 and an entries array. */
function readUsableCatalog(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

function applyCatalogReplacements(parsed, replacements) {
  let changed = false
  const rewriteKey = (row, key) => {
    const current = row[key]
    if (typeof current !== 'string') return
    const next = applyReplacements(current, replacements)
    if (next !== current) {
      row[key] = next
      changed = true
    }
  }
  for (const entry of parsed.entries) {
    if (!entry || typeof entry !== 'object') continue
    for (const key of ['sourcePath', 'installedPath', 'disabledPath']) rewriteKey(entry, key)
    if (Array.isArray(entry.installations)) {
      for (const copy of entry.installations) {
        if (!copy || typeof copy !== 'object') continue
        for (const key of ['path', 'parkedPath']) rewriteKey(copy, key)
      }
    }
  }
  return changed
}

function rewrittenCatalog(parsed, replacements) {
  const copy = structuredClone(parsed)
  return { value: copy, changed: applyCatalogReplacements(copy, replacements) }
}

/**
 * Rewrite catalog paths. A truncated primary is recovered from catalog.json.bak,
 * the same backup loadCatalog uses. Both copies are rewritten so a later
 * backup recovery still sees Cuttler paths. Neither copy usable is a hard failure.
 */
export function rewriteCatalogLegacyPaths(catalogPath, replacements) {
  if (!catalogPath || !replacements?.length || !fs.existsSync(catalogPath)) return
  const backupPath = catalogBackupPath(catalogPath)
  const primary = readUsableCatalog(catalogPath)
  const backup = readUsableCatalog(backupPath)
  if (!primary && !backup) {
    throw new Error(`Could not read ${catalogPath} to rewrite library paths`)
  }
  if (primary) {
    const next = rewrittenCatalog(primary, replacements)
    if (next.changed) commitJson(catalogPath, next.value)
  } else {
    const recovered = rewrittenCatalog(backup, replacements)
    commitJson(catalogPath, recovered.value)
  }
  if (backup) {
    const next = rewrittenCatalog(backup, replacements)
    if (next.changed) commitJson(backupPath, next.value)
  }
}

function readMarker(dataRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataRoot, FOLDER_MIGRATION_FILE), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    return {
      dataFrom: typeof parsed.dataFrom === 'string' ? parsed.dataFrom : null,
      fontsFrom: typeof parsed.fontsFrom === 'string' ? parsed.fontsFrom : null,
    }
  } catch {
    return null
  }
}

function writeMarker(dataRoot, marker) {
  fs.mkdirSync(dataRoot, { recursive: true })
  const file = path.join(dataRoot, FOLDER_MIGRATION_FILE)
  const tmp = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`
  const body = {
    version: 1,
    dataFrom: marker.dataFrom ?? null,
    fontsFrom: marker.fontsFrom ?? null,
  }
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

function folderRank(dir) {
  return LEGACY_APP_FOLDER_NAMES.indexOf(path.basename(dir))
}

/**
 * Dest already in use: leave real sources alone and say which one still
 * holds the data. A lower-priority folder left behind after a recorded
 * move of a higher-priority folder is not a new stall.
 */
function unresolvedLibraryLink(dir) {
  const st = lstatOrNull(dir)
  return Boolean(st?.isSymbolicLink() && !followedDirectory(dir))
}

function migrateSide({ dest, sources, unused, movedFrom, hooks, beforeMove }) {
  const present = sources.filter(followedDirectory)
  const dangling = sources.filter(unresolvedLibraryLink)
  if (present.length === 0) {
    if (dangling.length > 0) return { status: 'stalled', source: dangling[0], occupied: false }
    return { status: 'absent', source: null }
  }
  const movedIndex = LEGACY_APP_FOLDER_NAMES.indexOf(movedFrom ?? '')
  const ignored = (dir) => {
    const rank = folderRank(dir)
    return movedIndex !== -1 && rank > movedIndex
  }
  if (!unused(dest)) {
    const blocking = present.find((dir) => !unused(dir) && !ignored(dir))
    if (blocking) return { status: 'stalled', source: blocking, occupied: true }
    return { status: 'absent', source: null }
  }
  const source = present.find((dir) => !unused(dir)) ?? present[0]
  try {
    beforeMove?.(source, dest)
    moveDirectoryAtomic(source, dest, hooks)
  } catch {
    // The source is still the library. Dest was restored if a fresh folder
    // had been moved aside. Say so instead of continuing with an empty Cuttler.
    if (followedDirectory(source)) return { status: 'stalled', source, occupied: false }
    if (followedDirectory(dest)) return { status: 'moved', source }
    throw new Error(`Could not move ${source}`)
  }
  return { status: 'moved', source }
}

function stallSentence(kind, oldDir, newDir, occupied) {
  const noun = kind === 'fonts' ? 'fonts are' : 'library is'
  if (occupied === false) {
    return `Your ${noun} still in ${oldDir}. The move to ${newDir} did not finish, so the old folder was left unchanged.`
  }
  return `Your ${noun} still in ${oldDir}. Cuttler already had files in ${newDir}, so that folder was left unchanged.`
}

export function migrationStallMessage(result) {
  if (!result?.stalled) return ''
  const parts = []
  if (result.stalledDataDir) {
    parts.push(stallSentence('library', result.stalledDataDir, result.dataRoot, result.dataOccupied))
  }
  if (result.stalledFontsDir) {
    parts.push(stallSentence('fonts', result.stalledFontsDir, result.installDir, result.fontsOccupied))
  }
  if (parts.length === 0) {
    return 'Your library is still in the previous folder. Cuttler already had files at the new path, so nothing was moved or deleted.'
  }
  return parts.join(' ')
}

export function adoptedMigrationDataRoot(env = process.env) {
  if (env?.[MIGRATION_STALL_ENV] !== '1') return null
  const root = env?.[MIGRATION_DATA_ROOT_ENV]
  if (typeof root !== 'string' || root.trim() === '') return null
  return root
}

/** Main already ran migration this launch, so the worker must not run it again. */
export function migrationAlreadyHandled(env = process.env) {
  return env?.[MIGRATION_HANDLED_ENV] === '1'
}

function pendingMigrationPath(home) {
  return path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
}

function readPendingMigration(home) {
  try {
    const parsed = JSON.parse(fs.readFileSync(pendingMigrationPath(home), 'utf8'))
    if (!parsed || parsed.version !== 1 || parsed.needsRewrite !== true) return null
    if (!Array.isArray(parsed.replacements) || parsed.replacements.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

function writePendingMigration(home, body) {
  const file = pendingMigrationPath(home)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, ...body }, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

function clearPendingMigration(home) {
  fs.rmSync(pendingMigrationPath(home), { force: true })
}

const ESSENTIAL_JSON = ['catalog.json', 'mutation-journal.json']
const APP_JSON = new Set([
  'operations.json',
  'settings.json',
  'retail-manifest.json',
  'projects.json',
  'family-tags.json',
  'saved-filters.json',
  // duplicates.json notifyKey is `${path}|fingerprint|occupying`. The whole
  // string is rewritten when the path sits under a moved folder. The skipped
  // list uses those same keys, so it has to move with them.
  'duplicates.json',
  'skipped-duplicates.json',
  'unlinked-sources.json',
])
/** Readers already tolerate a corrupt copy. A bad file must not block the journal rewrite. */
const NON_ESSENTIAL_JSON = new Set([
  'system-cache.json',
  'finder-sync-agent.json',
  'finder-sync-pending-error.json',
  'announcements.json',
  'opened-update-dmgs.json',
  'folder-migration.json',
])

function rewriteNamedJson(abs, name, replacements) {
  if (name === 'catalog.json') rewriteCatalogLegacyPaths(abs, replacements)
  else rewriteJsonLegacyPaths(abs, replacements)
}

/** Keep the bytes, but stop readers from opening a file that is not JSON. */
function quarantineUnreadable(filePath) {
  const dest = `${filePath}.unreadable`
  try {
    if (fs.existsSync(dest)) return
    fs.renameSync(filePath, dest)
  } catch {
    // The reader already ignores a truncated file. Launch still continues.
  }
}

/**
 * Settings, operations, plans, and the other app JSON readers return empty
 * when the file is truncated. A bad copy must not block catalog or journal.
 */
function rewriteOptionalJson(filePath, replacements) {
  if (!filePath || !replacements?.length || !fs.existsSync(filePath)) return
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    quarantineUnreadable(filePath)
    return
  }
  const next = rewriteJsonValue(parsed, replacements)
  if (next === parsed) return
  try {
    commitJson(filePath, next)
  } catch {
    // The readable file stays. A settings write failure is not a lost journal.
  }
}

function rewriteLibraryFiles(root, replacements) {
  if (!root || !replacements?.length || !followedDirectory(root)) return
  for (const name of ESSENTIAL_JSON) {
    const abs = path.join(root, name)
    if (fs.existsSync(abs)) rewriteNamedJson(abs, name, replacements)
  }
  const plans = path.join(root, 'plans')
  if (followedDirectory(plans)) {
    let planEntries = []
    try {
      planEntries = fs.readdirSync(plans, { withFileTypes: true })
    } catch {
      planEntries = []
    }
    for (const entry of planEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue
      rewriteOptionalJson(path.join(plans, entry.name), replacements)
    }
  }
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue
    if (ESSENTIAL_JSON.includes(entry.name) || NON_ESSENTIAL_JSON.has(entry.name)) continue
    if (!APP_JSON.has(entry.name)) continue
    rewriteOptionalJson(path.join(root, entry.name), replacements)
  }
}

/**
 * After migrate throws, decide where this launch may run. A pending rewrite
 * blocks the worker so journal recovery cannot delete snapshots. A stall
 * recorded in that marker keeps the app on the old library.
 */
export function launchAfterMigrationFailure(home) {
  const pending = readPendingMigration(home)
  const stalledDataDir =
    pending?.stalledDataDir && followedDirectory(pending.stalledDataDir) ? pending.stalledDataDir : null
  return {
    blockWorker: Boolean(pending?.needsRewrite),
    stalled: Boolean(stalledDataDir),
    stalledDataDir,
    dataRoot: typeof pending?.dataRoot === 'string' ? pending.dataRoot : null,
    installDir: path.join(home, 'Library/Fonts', APP_FOLDER_NAME),
  }
}

function pairMoved(pair) {
  return !followedDirectory(pair.from) && followedDirectory(pair.to)
}

function rememberMove(home, current, replacement, extra = {}) {
  const replacements = [...(current?.replacements ?? [])]
  if (
    replacement &&
    !replacements.some((item) => item.from === replacement.from && item.to === replacement.to)
  ) {
    replacements.push(replacement)
  }
  const next = {
    needsRewrite: true,
    replacements,
    dataRoot: extra.dataRoot ?? current?.dataRoot,
    stalledDataDir: extra.stalledDataDir === undefined ? current?.stalledDataDir ?? null : extra.stalledDataDir,
    dataFrom: extra.dataFrom === undefined ? current?.dataFrom ?? null : extra.dataFrom,
    fontsFrom: extra.fontsFrom === undefined ? current?.fontsFrom ?? null : extra.fontsFrom,
  }
  if (next.replacements.length === 0) return next.stalledDataDir ? next : current
  writePendingMigration(home, next)
  return next
}

/**
 * Real-library migration runs only for an unmarked Mac build with no
 * FONT_BUTLER_DATA / FONTCASE_DATA override. An explicit data root is an
 * isolated library and must not rename the folders the installed app uses.
 */
export function shouldMigrateRealMacLibrary({
  platform = process.platform,
  testFeed = false,
  env = process.env,
} = {}) {
  if (platform !== 'darwin' || testFeed === true) return false
  const override = env?.FONT_BUTLER_DATA ?? env?.FONTCASE_DATA
  return !override
}

const OWNER_WAIT_MS = 10_000
const OWNER_POLL_MS = 200
const COOKIE_FLOCK_PERL =
  'use Fcntl qw(:flock); open my $fh, "<", $ARGV[0] or exit 2; flock($fh, LOCK_EX | LOCK_NB) ? exit 0 : exit 1;'

function defaultSleepSync(ms) {
  if (!ms || ms < 0) return
  const until = Date.now() + ms
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
    return
  } catch {
    // A host that rejects Atomics.wait must still wait. Failing here would
    // skip the owner check and move the library out from under 0.4.0.
  }
  while (Date.now() < until) {
    // Spin only when timed waits are unavailable.
  }
}

function defaultProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/**
 * Chromium's SingletonLock symlink target is `hostname-pid`. The hostname may
 * contain dashes, so the pid is the trailing integer. A regular file with the
 * same text is accepted for fixtures.
 */
export function readSingletonLockPid(lockPath) {
  let raw = ''
  try {
    raw = fs.readlinkSync(lockPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    try {
      const st = fs.lstatSync(lockPath)
      if (!st.isFile() || st.isSymbolicLink()) return null
      raw = fs.readFileSync(lockPath, 'utf8')
    } catch {
      return null
    }
  }
  raw = String(raw).trim()
  const match = /-(\d+)$/.exec(raw)
  const pid = Number(match ? match[1] : /^\d+$/.test(raw) ? raw : '')
  if (!Number.isInteger(pid) || pid <= 0) return null
  return pid
}

/**
 * True when another process holds Chromium's exclusive flock on SingletonCookie.
 * False when the cookie is missing or the flock is free (the recorded pid was
 * recycled, or the owner already exited). Null when the check itself cannot run.
 */
export function singletonCookieHeld(cookiePath) {
  let st
  try {
    st = fs.lstatSync(cookiePath)
  } catch {
    return false
  }
  if (!st.isFile() || st.isSymbolicLink()) return null
  let result
  try {
    result = spawnSync('perl', ['-e', COOKIE_FLOCK_PERL, cookiePath], { timeout: 2000 })
  } catch {
    return null
  }
  if (result?.error || result?.status == null) return null
  if (result.status === 0) return false
  if (result.status === 1) return true
  return null
}

/**
 * True when a process other than this one still owns the legacy userData.
 * 0.4.0 holds Electron's SingletonLock in that folder. A dead pid, this pid,
 * or a live pid that does not hold SingletonCookie is not an owner.
 */
export function legacyLibraryHasRunningOwner(dir, {
  selfPid = process.pid,
  isAlive = defaultProcessAlive,
  cookieHeld = singletonCookieHeld,
} = {}) {
  if (!dir) return false
  const pid = readSingletonLockPid(path.join(dir, 'SingletonLock'))
  if (!pid || pid === selfPid) return false
  if (isAlive(pid) !== true) return false
  const held = cookieHeld(path.join(dir, 'SingletonCookie'), pid)
  if (held === false) return false
  return true
}

function legacyDataDirectories(home) {
  return LEGACY_APP_FOLDER_NAMES.map((name) => path.join(home, 'Library/Application Support', name))
}

export function findLegacyLibraryOwner(home, hooks) {
  const probe = {
    selfPid: hooks?.selfPid ?? process.pid,
    isAlive: hooks?.isAlive ?? defaultProcessAlive,
    cookieHeld: hooks?.cookieHeld ?? singletonCookieHeld,
  }
  for (const dir of legacyDataDirectories(home)) {
    if (!lstatOrNull(dir)) continue
    if (!legacyLibraryHasRunningOwner(dir, probe)) continue
    return { dir, pid: readSingletonLockPid(path.join(dir, 'SingletonLock')) }
  }
  return null
}

function waitForLegacyLibraryOwner(home, hooks) {
  const timeoutMs = Number.isFinite(hooks?.ownerWaitMs) ? hooks.ownerWaitMs : OWNER_WAIT_MS
  const intervalMs = Number.isFinite(hooks?.ownerPollMs) ? hooks.ownerPollMs : OWNER_POLL_MS
  const sleep = hooks?.sleepSync ?? defaultSleepSync
  const started = Date.now()
  let owner = findLegacyLibraryOwner(home, hooks)
  if (!owner || timeoutMs <= 0) return owner
  const maxSpins = Math.ceil(timeoutMs / Math.max(intervalMs, 1)) + 2
  let spins = 0
  while (owner && spins < maxSpins && Date.now() - started < timeoutMs) {
    sleep(Math.max(intervalMs, 0))
    spins += 1
    owner = findLegacyLibraryOwner(home, hooks)
  }
  return owner
}

export function legacyOwnerBlockMessage(result) {
  const where = result?.ownerDataDir ? ` (${result.ownerDataDir})` : ''
  return `Quit the previous Cuttler (Font Buttler) first. It is still running and using your current library${where}. This version did not move or open that library. Quit the other app, then open Cuttler again.`
}

function ownerBlockedResult(dataRoot, installDir, owner) {
  return {
    dataRoot,
    installDir,
    stalled: false,
    stalledDataDir: null,
    stalledFontsDir: null,
    dataOccupied: false,
    fontsOccupied: false,
    movedData: false,
    movedFonts: false,
    blockedByOwner: true,
    ownerPid: owner.pid,
    ownerDataDir: owner.dir,
  }
}

function movedReplacements(pending, { omitDest = '' } = {}) {
  return (pending?.replacements ?? []).filter(
    (pair) => pair.to !== omitDest && !followedDirectory(pair.from) && followedDirectory(pair.to),
  )
}

function rewriteKeptLibrary(pending, dataRoot) {
  if (!pending?.replacements?.length) return
  const retainingOldLibrary = Boolean(pending.stalledDataDir && followedDirectory(pending.stalledDataDir))
  const occupiedDest = retainingOldLibrary ? dataRoot : ''
  const target = retainingOldLibrary
    ? pending.stalledDataDir
    : followedDirectory(dataRoot)
      ? dataRoot
      : null
  const replacements = movedReplacements(pending, { omitDest: occupiedDest })
  if (!target || replacements.length === 0) return
  rewriteLibraryFiles(target, replacements)
}

export function migrateLegacyMacAppDirs(home, hooks) {
  const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const installDir = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  // 0.4.0's instance lock lives in the legacy folder. Electron's own lock
  // follows this process's userData (Cuttler) and cannot see that owner.
  // Wait out a quitting updater, then refuse rather than move the library
  // out from under a process that still has it open.
  const owner = waitForLegacyLibraryOwner(home, hooks)
  if (owner) return ownerBlockedResult(dataRoot, installDir, owner)
  let pending = readPendingMigration(home)
  if (pending) rewriteKeptLibrary(pending, dataRoot)
  const dataSources = LEGACY_APP_FOLDER_NAMES.map((name) =>
    path.join(home, 'Library/Application Support', name),
  )
  const fontSources = LEGACY_APP_FOLDER_NAMES.map((name) => path.join(home, 'Library/Fonts', name))
  const marker = readMarker(dataRoot)
  const data = migrateSide({
    dest: dataRoot,
    sources: dataSources,
    unused: isFreshDataRoot,
    movedFrom: marker?.dataFrom ?? pending?.dataFrom ?? null,
    hooks,
    beforeMove(source) {
      pending = rememberMove(home, pending, { from: source, to: dataRoot }, {
        dataRoot,
        dataFrom: path.basename(source),
      })
    },
  })
  if (data.status === 'stalled') {
    pending = rememberMove(home, pending, null, { dataRoot, stalledDataDir: data.source })
  } else if (data.status === 'moved') {
    pending = rememberMove(home, pending, null, { dataRoot, stalledDataDir: null })
  }
  if (hooks?.crashAfterDataMove) {
    throw new Error('killed after the data folder rename')
  }
  const fonts = migrateSide({
    dest: installDir,
    sources: fontSources,
    unused: isEmptyDir,
    movedFrom: marker?.fontsFrom ?? pending?.fontsFrom ?? null,
    hooks,
    beforeMove(source) {
      pending = rememberMove(home, pending, { from: source, to: installDir }, {
        dataRoot,
        fontsFrom: path.basename(source),
      })
    },
  })
  pending = readPendingMigration(home) ?? pending
  if (data.status === 'stalled' && data.source) {
    pending = rememberMove(home, pending, null, { dataRoot, stalledDataDir: data.source })
  }
  const record = {
    dataFrom: data.status === 'moved' ? path.basename(data.source) : marker?.dataFrom ?? pending?.dataFrom ?? null,
    fontsFrom: fonts.status === 'moved' ? path.basename(fonts.source) : marker?.fontsFrom ?? pending?.fontsFrom ?? null,
  }
  if (pending?.replacements?.length) {
    pending = { ...pending, dataFrom: record.dataFrom, fontsFrom: record.fontsFrom, dataRoot }
    writePendingMigration(home, pending)
    if (hooks?.failRewrite) throw new Error('rewrite failed')
    rewriteKeptLibrary(pending, dataRoot)
    const library = pending.stalledDataDir && followedDirectory(pending.stalledDataDir)
      ? pending.stalledDataDir
      : dataRoot
    if (followedDirectory(library) && (record.dataFrom || record.fontsFrom)) {
      writeMarker(library, record)
    }
    const unfinished = pending.replacements.some((pair) => followedDirectory(pair.from))
    if (!unfinished) clearPendingMigration(home)
  }
  return {
    dataRoot,
    installDir,
    stalled: data.status === 'stalled' || fonts.status === 'stalled',
    stalledDataDir: data.status === 'stalled' ? data.source : null,
    stalledFontsDir: fonts.status === 'stalled' ? fonts.source : null,
    dataOccupied: data.status === 'stalled' ? data.occupied !== false : false,
    fontsOccupied: fonts.status === 'stalled' ? fonts.occupied !== false : false,
    movedData: data.status === 'moved',
    movedFonts: fonts.status === 'moved',
    blockedByOwner: false,
    ownerPid: null,
    ownerDataDir: null,
  }
}

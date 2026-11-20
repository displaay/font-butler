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
 *
 * A cross-device copy that has been checked and renamed into place is the
 * library. Removing the source is cleanup. If that cleanup fails, or the
 * process dies before it runs, the leftover source is kept and recorded.
 * It is not adopted, and it is not deleted further.
 */

import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { carryFinderSyncPendingError } from './finder-sync-pending-error.mjs'

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
        if (entry.name === PARTIAL_MARKER_FILE) continue
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

/** macOS loads every font file under Library/Fonts, including a half-written copy. */
function libraryFontsDestination(dir) {
  const parts = path.resolve(String(dir ?? '')).split(path.sep)
  const fontsAt = parts.lastIndexOf('Fonts')
  return fontsAt > 0 && parts[fontsAt - 1] === 'Library'
}

/** Written inside a partial when it is created. Cleanup trusts this, not the name's pid. */
const PARTIAL_MARKER_FILE = '.cuttler-partial.json'

function processStartMs() {
  return Math.round(Date.now() - process.uptime() * 1000)
}

function writePartialMarker(dir, now = Date.now()) {
  const body = { pid: process.pid, startTime: processStartMs(), createdAt: now }
  fs.writeFileSync(path.join(dir, PARTIAL_MARKER_FILE), `${JSON.stringify(body)}\n`)
  return body
}

function directoryHasPartialMarker(dir) {
  try {
    return fs.lstatSync(path.join(dir, PARTIAL_MARKER_FILE)).isFile()
  } catch {
    return false
  }
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
 * Returns the source path when that folder is still on disk after the copy
 * has been committed, and null when the source is gone.
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
  let leftover = null
  try {
    try {
      renameAcross(from, to)
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error
      const tmp = `${to}.partial-${process.pid}-${process.hrtime.bigint()}`
      hooks.onPartialDir?.(tmp)
      let committed = false
      try {
        fs.mkdirSync(tmp, { recursive: true })
        writePartialMarker(tmp)
        copyTree(from, tmp, copyFileSync)
        if (!directoryTreesMatch(from, tmp)) {
          const mismatch = new Error('Copied folder did not match the source')
          mismatch.code = 'EVERIFY'
          throw mismatch
        }
        fs.renameSync(tmp, to)
        fs.rmSync(path.join(to, PARTIAL_MARKER_FILE), { force: true })
        committed = true
        if (hooks.crashBeforeCommitRecord) {
          const killed = new Error('killed before the copy commit record')
          killed.code = 'ECOPYGAP'
          throw killed
        }
        hooks.onCopyCommitted?.(from, to)
        if (backup) {
          discardEmptyBackup(backup)
          backup = null
        }
        if (hooks.crashAfterCopyCommit) {
          const killed = new Error('killed after the copy commit')
          killed.code = 'ECOPYCOMMIT'
          throw killed
        }
        const remove = hooks.rmSync ?? fs.rmSync
        try {
          remove(from, { recursive: true, force: true })
        } catch (cleanupError) {
          if (cleanupError?.code === 'ECOPYCOMMIT' || cleanupError?.code === 'ECOPYGAP' || cleanupError?.code === 'ECOMMITTED') {
            throw cleanupError
          }
          // One attempt. Do not delete more of a source that is already partial.
        }
        if (lstatOrNull(from)) leftover = from
      } catch (copyError) {
        if (
          copyError?.code === 'ECOPYCOMMIT' ||
          copyError?.code === 'ECOPYGAP' ||
          copyError?.code === 'ECOMMITTED'
        ) {
          throw copyError
        }
        if (committed) {
          const stuck = new Error('Library copy is in place; source cleanup did not finish')
          stuck.code = 'ECOMMITTED'
          stuck.cause = copyError
          throw stuck
        }
        fs.rmSync(tmp, { recursive: true, force: true })
        throw copyError
      }
    }
  } catch (error) {
    if (error?.code === 'ECOPYCOMMIT' || error?.code === 'ECOPYGAP' || error?.code === 'ECOMMITTED') throw error
    restoreBackup()
    throw error
  }
  if (backup) discardEmptyBackup(backup)
  return leftover
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

function migrateSide({ dest, sources, unused, movedFrom, hooks, beforeMove, committedSources }) {
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
  // A committed copy's leftover is never the library, even when dest was
  // emptied later and now looks unused. Do not rename that source back in.
  const committedSource = present.find((dir) => committedSources?.has(dir))
  if (committedSource) {
    return {
      status: 'moved',
      source: committedSource,
      leftover: committedSource,
      destEmpty: unused(dest),
    }
  }
  if (!unused(dest)) {
    const blocking = present.find((dir) => !unused(dir) && !ignored(dir))
    if (blocking) return { status: 'stalled', source: blocking, occupied: true }
    return { status: 'absent', source: null }
  }
  const source = present.find((dir) => !unused(dir)) ?? present[0]
  try {
    beforeMove?.(source, dest)
    const leftover = moveDirectoryAtomic(source, dest, hooks)
    return {
      status: 'moved',
      source,
      leftover: leftover && lstatOrNull(leftover) ? leftover : null,
    }
  } catch (error) {
    if (error?.code === 'ECOPYCOMMIT' || error?.code === 'ECOPYGAP' || error?.code === 'ECOMMITTED') {
      throw error
    }
    // The source is still the library. Dest was restored if a fresh folder
    // had been moved aside. Say so instead of continuing with an empty Cuttler.
    if (followedDirectory(source)) return { status: 'stalled', source, occupied: false }
    if (followedDirectory(dest)) return { status: 'moved', source }
    throw new Error(`Could not move ${source}`)
  }
}

function stallSentence(kind, oldDir, newDir, occupied, unfinishedCopy = false) {
  const noun = kind === 'fonts' ? 'fonts are' : 'library is'
  if (unfinishedCopy) {
    return `Your ${noun} still in ${oldDir}. ${newDir} is an unfinished copy and was left in place.`
  }
  if (occupied === false) {
    return `Your ${noun} still in ${oldDir}. The move to ${newDir} did not finish, so the old folder was left unchanged.`
  }
  return `Your ${noun} still in ${oldDir}. Cuttler already had files in ${newDir}, so that folder was left unchanged.`
}

function leftoverSentence(kind, oldDir, newDir, destEmpty = false) {
  if (destEmpty) {
    const noun = kind === 'fonts' ? 'fonts are' : 'library is'
    return `The folder at ${newDir} is empty. Your previous ${noun} still at ${oldDir}.`
  }
  const where = kind === 'fonts' ? `Your fonts are in ${newDir}.` : `Your library is in ${newDir}.`
  const active = kind === 'fonts' ? ' Fonts in that folder may still be active.' : ''
  return `${where} ${oldDir} is no longer used. You can remove it.${active}`
}

export function migrationStallMessage(result) {
  if (!result) return ''
  const parts = []
  if (result.stalled && result.stalledDataDir) {
    parts.push(
      stallSentence('library', result.stalledDataDir, result.dataRoot, result.dataOccupied, result.unfinishedDataCopy),
    )
  }
  const fontsDir = result.fontsStayDir || (result.stalled ? result.stalledFontsDir : null)
  if (result.fontsRenameReason === 'staged' && fontsDir) {
    const pointed = result.catalogPointsAt || fontsDir
    parts.push(
      `A staged copy from an earlier test build was kept and nothing was deleted. The catalog points at ${pointed}.`,
    )
  } else if ((result.fontsRenameReason === 'old-head' || result.fontsRenameReason === 'placed') && fontsDir) {
    const pointed = result.catalogPointsAt || result.installDir
    parts.push(
      `Both font folders were kept and nothing was deleted. The catalog points at ${pointed}. ${fontsDir} is still on disk.`,
    )
  } else if (fontsDir && result.fontsRenameReason === 'symlink') {
    parts.push(`${result.installDir} is a symlink, so nothing was moved. Your fonts stay in ${fontsDir}.`)
  } else if (fontsDir && result.fontsRenameReason === 'file') {
    parts.push(`${result.installDir} is a file, so nothing was moved. Your fonts stay in ${fontsDir}.`)
  } else if (fontsDir && result.fontsRenameReason === 'EXDEV') {
    parts.push(`Your fonts stay in ${fontsDir}. The rename did not finish because the folders are on different disks (EXDEV). Nothing was copied or removed.`)
  } else if (fontsDir && (result.fontsRenameReason === 'EACCES' || result.fontsRenameReason === 'EPERM')) {
    parts.push(`Your fonts stay in ${fontsDir}. The rename was not permitted (${result.fontsRenameReason}). Nothing was copied or removed.`)
  } else if (fontsDir && result.fontsRenameReason && result.fontsRenameReason !== 'occupied') {
    parts.push(`Your fonts stay in ${fontsDir}. The rename did not finish (${result.fontsRenameReason}). Nothing was copied or removed.`)
  } else if (fontsDir) {
    parts.push(
      result.fontsOccupied === true
        ? `Your fonts stay in ${fontsDir}. ${result.installDir} already has files, so nothing was moved.`
        : `Your fonts stay in ${fontsDir}. Nothing was copied or removed.`,
    )
  }
  for (const note of result.oldHeadNotes ?? []) {
    parts.push(`${note} was kept, nothing deleted.`)
  }
  if (result.leftoverDataDir) {
    parts.push(leftoverSentence('library', result.leftoverDataDir, result.dataRoot, result.leftoverDataDestEmpty))
  }
  if (result.leftoverFontsDir) {
    parts.push(leftoverSentence('fonts', result.leftoverFontsDir, result.installDir, result.leftoverFontsDestEmpty))
  }
  if (parts.length > 0) return parts.join(' ')
  if (!result.stalled) return ''
  return 'Your library is still in the previous folder. Cuttler already had files at the new path, so nothing was moved or deleted.'
}

/**
 * Stall keeps its own announcement, which shows again every launch.
 * A leftover with no stall uses a separate id that stays dismissed.
 */
export function migrationAnnouncementFlags(result) {
  if (result?.blockedByOwner || result?.runningInstanceDataDir) {
    return { migrationStalled: false, migrationLeftover: false, fontsRenameReason: null, oldHeadNotice: false, oldHeadNoticeId: null }
  }
  const migrationStalled = result?.stalled === true
  const migrationLeftover = !migrationStalled && Boolean(result?.leftoverDataDir || result?.leftoverFontsDir)
  const fontsRenameReason = typeof result?.fontsRenameReason === 'string' ? result.fontsRenameReason : null
  const notes = Array.isArray(result?.oldHeadNotes) ? result.oldHeadNotes.filter((item) => typeof item === 'string') : []
  const oldHeadNotice = notes.length > 0
  const oldHeadNoticeId = oldHeadNotice
    ? `old-head-kept-${crypto.createHash('sha256').update([...notes].sort().join('\n')).digest('hex').slice(0, 12)}`
    : null
  return { migrationStalled, migrationLeftover, fontsRenameReason, oldHeadNotice, oldHeadNoticeId }
}

/** Directories left behind after a committed copy. Callers must not modify them. */
export function committedLeftoverDirectories(home) {
  const pending = readPendingMigration(home)
  const dirs = []
  for (const pair of pending?.replacements ?? []) {
    if (pair?.committed !== true || typeof pair.from !== 'string' || !fontPlacementRecorded(pair)) continue
    if (lstatOrNull(pair.from)) dirs.push(pair.from)
  }
  return dirs
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
    if (entry.name === 'unlinked-sources.json') {
      rewriteUnlinkedSources(path.join(root, entry.name), replacements)
      continue
    }
    if (!APP_JSON.has(entry.name)) continue
    rewriteOptionalJson(path.join(root, entry.name), replacements)
  }
}

/**
 * A missing unlinked-sources.json is an empty list. A present but invalid
 * primary is resettable, and loadUnlinkedList recovers a valid .bak only in
 * that case. Quarantining the primary would drop the unlink list.
 */
function readUsableUnlinked(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!parsed || parsed.version !== 1) return null
    if (Array.isArray(parsed.paths) || Array.isArray(parsed.entries)) return parsed
    return null
  } catch {
    return null
  }
}

function rewrittenJsonDocument(parsed, replacements) {
  const copy = structuredClone(parsed)
  const next = rewriteJsonValue(copy, replacements)
  return { value: next, changed: next !== copy }
}

function rewriteUnlinkedSources(filePath, replacements) {
  if (!filePath || !replacements?.length || !fs.existsSync(filePath)) return
  const backupPath = `${filePath}.bak`
  const primary = readUsableUnlinked(filePath)
  const backup = readUsableUnlinked(backupPath)
  if (!primary && !backup) return
  if (primary) {
    const next = rewrittenJsonDocument(primary, replacements)
    if (next.changed) commitJson(filePath, next.value)
  } else {
    const recovered = rewrittenJsonDocument(backup, replacements)
    commitJson(filePath, recovered.value)
  }
  if (backup) {
    const next = rewrittenJsonDocument(backup, replacements)
    if (next.changed) commitJson(backupPath, next.value)
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
    fontVolumeBlocked:
      extra.fontVolumeBlocked === undefined ? current?.fontVolumeBlocked === true : extra.fontVolumeBlocked,
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
 * True when another process holds an exclusive flock on a regular-file
 * SingletonCookie. False when the cookie is missing or the flock is free.
 * Null when the cookie is not a regular file, or the flock check cannot run.
 * Chromium 152's cookie is a symlink and is never flocked; callers must not
 * treat that null as an owner.
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

function cookieLayout(cookiePath) {
  let st
  try {
    st = fs.lstatSync(cookiePath)
  } catch {
    return 'missing'
  }
  if (st.isSymbolicLink()) return 'symlink'
  if (st.isFile()) return 'file'
  return 'other'
}

/** Chromium's IsChromeProcess check, for this app's main executables. Helpers are not the lock owner. */
export function isLegacyAppExecutable(exePath) {
  const base = path.basename(String(exePath ?? '')).replace(/ \(deleted\)$/, '')
  if (!base || /helper/i.test(base)) return false
  return /^(cuttler|font buttler|font butler|electron)$/i.test(base)
}

function processExecutableIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  if (process.platform === 'darwin') return darwinProcessExecutable(pid)
  try {
    const st = fs.statSync(`/proc/${pid}/exe`)
    const link = fs.readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, '')
    return { path: link, dev: st.dev, ino: st.ino }
  } catch {
    return null
  }
}

function darwinProcessExecutable(pid) {
  let result
  try {
    result = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-F', 'ni'], {
      encoding: 'utf8',
      timeout: 2000,
    })
  } catch {
    return null
  }
  if (result?.status !== 0 || !result.stdout) return null
  let exePath = ''
  let ino = null
  for (const line of String(result.stdout).split('\n')) {
    if (line.startsWith('n') && line.length > 1 && !exePath) exePath = line.slice(1)
    else if (line.startsWith('i') && ino == null) {
      const value = Number(line.slice(1))
      if (Number.isInteger(value) && value > 0) ino = value
    }
  }
  if (!exePath) return null
  let dev = null
  try {
    dev = fs.statSync(exePath).dev
  } catch {
    dev = null
  }
  return { path: exePath, dev, ino }
}

function defaultIsSameExecutable(pid, execPath = process.execPath) {
  const other = processExecutableIdentity(pid)
  if (!other || other.ino == null) return null
  let self
  try {
    self = fs.statSync(execPath)
  } catch {
    return null
  }
  if (self.ino == null) return null
  return String(other.ino) === String(self.ino) && String(other.dev) === String(self.dev)
}

function defaultIsAppProcess(pid) {
  const other = processExecutableIdentity(pid)
  if (!other?.path) return null
  return isLegacyAppExecutable(other.path)
}

/**
 * 'legacy': a different binary still owns the old library (0.4.0 or Font Butler).
 * 'same-app': this exact executable already holds the lock (stalled 0.4.1).
 * 'none': no live owner.
 */
function classifyLegacyOwner(dir, hooks) {
  if (!dir) return 'none'
  const selfPid = hooks?.selfPid ?? process.pid
  const isAlive = hooks?.isAlive ?? defaultProcessAlive
  const pid = readSingletonLockPid(path.join(dir, 'SingletonLock'))
  if (!pid || pid === selfPid) return 'none'
  if (isAlive(pid) !== true) return 'none'
  const cookiePath = path.join(dir, 'SingletonCookie')
  const layout = cookieLayout(cookiePath)
  if (layout === 'missing') return 'none'
  if (layout !== 'symlink') {
    const cookieHeld = hooks?.cookieHeld ?? singletonCookieHeld
    const held = cookieHeld(cookiePath, pid)
    if (held === false) return 'none'
    return 'legacy'
  }
  const same = typeof hooks?.isSameExecutable === 'function'
    ? hooks.isSameExecutable(pid)
    : defaultIsSameExecutable(pid, hooks?.execPath)
  if (same === true) return 'same-app'
  const app = typeof hooks?.isAppProcess === 'function' ? hooks.isAppProcess(pid) : defaultIsAppProcess(pid)
  if (app === true) return 'legacy'
  // Chromium treats an empty executable path as an orphaned lock. An identity
  // we cannot read (failed lsof, another user's process) is not an owner.
  return 'none'
}

/**
 * True when a different still-running app owns the legacy userData.
 * A dead pid, this pid, a same-executable second instance, an unflocked
 * regular cookie, a symlink cookie whose process is not this app, or a
 * symlink cookie whose executable cannot be read is not an owner. A regular
 * cookie whose flock check cannot run stays an owner.
 */
export function legacyLibraryHasRunningOwner(dir, hooks = {}) {
  return classifyLegacyOwner(dir, hooks) === 'legacy'
}

function legacyDataDirectories(home) {
  return LEGACY_APP_FOLDER_NAMES.map((name) => path.join(home, 'Library/Application Support', name))
}

export function findLegacyLibraryOwner(home, hooks) {
  let sameApp = null
  for (const dir of legacyDataDirectories(home)) {
    if (!lstatOrNull(dir)) continue
    const kind = classifyLegacyOwner(dir, hooks)
    if (kind === 'none') continue
    const found = { dir, pid: readSingletonLockPid(path.join(dir, 'SingletonLock')), kind }
    if (kind === 'legacy') return found
    if (!sameApp) sameApp = found
  }
  return sameApp
}

function waitForLegacyLibraryOwner(home, hooks) {
  const timeoutMs = Number.isFinite(hooks?.ownerWaitMs) ? hooks.ownerWaitMs : OWNER_WAIT_MS
  const intervalMs = Number.isFinite(hooks?.ownerPollMs) ? hooks.ownerPollMs : OWNER_POLL_MS
  const sleep = hooks?.sleepSync ?? defaultSleepSync
  const started = Date.now()
  let owner = findLegacyLibraryOwner(home, hooks)
  if (!owner || owner.kind === 'same-app' || timeoutMs <= 0) return owner
  const maxSpins = Math.ceil(timeoutMs / Math.max(intervalMs, 1)) + 2
  let spins = 0
  while (owner?.kind === 'legacy' && spins < maxSpins && Date.now() - started < timeoutMs) {
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
    runningInstanceDataDir: null,
  }
}

function sameAppInstanceResult(dataRoot, installDir, owner) {
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
    blockedByOwner: false,
    ownerPid: null,
    ownerDataDir: null,
    runningInstanceDataDir: owner.dir,
  }
}

function fontPlacementRecorded(pair) {
  if (!pair || !libraryFontsDestination(pair.to)) return pair?.committed === true
  return pair.committed === true && (pair.phase === 'placed' || pair.phase === 'done')
}

function fontDestPlaced(pair) {
  return fontPlacementRecorded(pair) && followedDirectory(pair.to) && !isEmptyDir(pair.to)
}

function movedReplacements(home, pending, { omitDest = '' } = {}) {
  return (pending?.replacements ?? []).filter((pair) => {
    if (!recordPairAllowed(home, pair)) return false
    if (pair.to === omitDest || !followedDirectory(pair.to) || isEmptyDir(pair.to)) return false
    if (libraryFontsDestination(pair.to) && pair.committed === true && !fontDestPlaced(pair)) return false
    // A committed copy is in place even when the source folder is still there.
    if (pair.committed === true) return true
    if (libraryFontsDestination(pair.to) && !fontDestPlaced(pair)) return false
    return !followedDirectory(pair.from)
  })
}

function markCopyCommitted(home, current, from, to) {
  const replacements = (current?.replacements ?? []).map((item) => ({ ...item }))
  const index = replacements.findIndex((item) => item.from === from && item.to === to)
  const placed = { committed: true, phase: libraryFontsDestination(to) ? 'placed' : undefined }
  if (index === -1) replacements.push({ from, to, ...placed })
  else replacements[index] = { ...replacements[index], ...placed, staging: undefined }
  const next = {
    needsRewrite: true,
    replacements,
    dataRoot: current?.dataRoot,
    stalledDataDir: current?.stalledDataDir === from ? null : current?.stalledDataDir ?? null,
    dataFrom: current?.dataFrom ?? null,
    fontsFrom: current?.fontsFrom ?? null,
  }
  writePendingMigration(home, next)
  return next
}

function rewriteKeptLibrary(home, pending, dataRoot) {
  if (!pending?.replacements?.length) return
  const retainingOldLibrary = Boolean(pending.stalledDataDir && followedDirectory(pending.stalledDataDir))
  const occupiedDest = retainingOldLibrary ? dataRoot : ''
  const target = retainingOldLibrary
    ? pending.stalledDataDir
    : followedDirectory(dataRoot)
      ? dataRoot
      : null
  const replacements = movedReplacements(home, pending, { omitDest: occupiedDest })
  if (!target || replacements.length === 0) return
  rewriteLibraryFiles(target, replacements)
}

function libraryCopyUncommitted(pending, dataRoot) {
  return (pending?.replacements ?? []).some(
    (pair) => pair?.committed !== true && pair?.to === dataRoot && followedDirectory(pair.from) && followedDirectory(dataRoot),
  )
}

function lexicalDirs(home, parentName) {
  const root = path.join(home, 'Library', parentName)
  return {
    dest: path.join(root, APP_FOLDER_NAME),
    sources: LEGACY_APP_FOLDER_NAMES.map((name) => path.join(root, name)),
  }
}

function pathsIdentify(actual, known) {
  if (!actual || !known) return false
  if (path.resolve(actual) === path.resolve(known)) return true
  try {
    return fs.realpathSync(actual) === fs.realpathSync(known)
  } catch {
    return false
  }
}

function fontPairAllowed(home, pair) {
  const fonts = lexicalDirs(home, 'Fonts')
  return fonts.sources.some((dir) => pathsIdentify(pair?.from, dir)) && pathsIdentify(pair?.to, fonts.dest)
}

function recordPairAllowed(home, pair) {
  if (fontPairAllowed(home, pair)) return true
  const data = lexicalDirs(home, 'Application Support')
  return data.sources.some((dir) => pathsIdentify(pair?.from, dir)) && pathsIdentify(pair?.to, data.dest)
}

function lexicalFontSource(home, from) {
  const fonts = lexicalDirs(home, 'Fonts')
  return fonts.sources.find((dir) => pathsIdentify(from, dir)) ?? null
}

function plainDirectory(dir) {
  const st = lstatOrNull(dir)
  return Boolean(st && st.isDirectory() && !st.isSymbolicLink())
}

function isFinderJunk(name) {
  return name === '.DS_Store' || name === '.localized'
}

function finderJunkFile(dir, name) {
  if (!isFinderJunk(name)) return false
  const st = lstatOrNull(path.join(dir, name))
  return Boolean(st && st.isFile() && !st.isSymbolicLink())
}

function plainEmptyDirectory(dir) {
  if (!plainDirectory(dir)) return false
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return false
  }
  return names.every((name) => finderJunkFile(dir, name))
}

/** A fresh Cuttler may be replaced only when it has no user files. */
function discardableEntry(dir, name) {
  const st = lstatOrNull(path.join(dir, name))
  if (!st) return false
  if (st.isSymbolicLink()) return name === 'finder-sync-pending-error.json'
  if (!st.isFile()) return false
  return finderJunkFile(dir, name) || name === 'finder-sync-pending-error.json'
}

function safeToDiscardFresh(dir) {
  if (!lstatOrNull(dir)) return true
  if (!plainDirectory(dir)) return false
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return false
  }
  return names.every((name) => discardableEntry(dir, name))
}

function discardEmptyBackup(dir) {
  const st = lstatOrNull(dir)
  if (!st || st.isSymbolicLink() || !st.isDirectory()) return
  if (!safeToDiscardFresh(dir)) return
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const abs = path.join(dir, name)
    const entry = lstatOrNull(abs)
    if (!entry || entry.isDirectory()) return
    fs.unlinkSync(abs)
  }
  try {
    fs.rmdirSync(dir)
  } catch {
    // Leave a backup that is not an empty directory.
  }
}

/** Unlink Finder metadata, then rmdir. Never rm -r a font folder. */
function rmdirEmptyPlainDir(dir) {
  if (!plainDirectory(dir)) return false
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return false
  }
  if (names.some((name) => !isFinderJunk(name))) return false
  for (const name of names) {
    const abs = path.join(dir, name)
    const st = lstatOrNull(abs)
    if (!st || st.isSymbolicLink() || !st.isFile()) return false
    fs.unlinkSync(abs)
  }
  if (fs.readdirSync(dir).length !== 0) return false
  fs.rmdirSync(dir)
  return true
}

function updateFontPair(home, current, from, to, patch) {
  const replacements = (current?.replacements ?? []).map((item) => ({ ...item }))
  const index = replacements.findIndex((item) => pathsIdentify(item.from, from) && pathsIdentify(item.to, to))
  const nextPair = { ...(index === -1 ? {} : replacements[index]), ...patch, from, to }
  if (index === -1) replacements.push(nextPair)
  else replacements[index] = nextPair
  const next = {
    needsRewrite: true,
    replacements,
    dataRoot: current?.dataRoot,
    stalledDataDir: current?.stalledDataDir ?? null,
    dataFrom: current?.dataFrom ?? null,
    fontsFrom: current?.fontsFrom ?? null,
  }
  writePendingMigration(home, next)
  return next
}

function oldHeadLeftoverName(name) {
  return (
    /^(?:Cuttler|Font Buttler|Font Butler)\.partial-\d+-\d+$/.test(name) ||
    /^\.cuttler-move\.partial-\d+-\d+$/.test(name) ||
    /^Cuttler\.fresh-/.test(name)
  )
}

function listOldHeadLeftovers(home) {
  const notes = []
  const parents = [
    path.join(home, 'Library'),
    path.join(home, 'Library/Application Support'),
    path.join(home, 'Library/Fonts'),
  ]
  for (const parent of parents) {
    let entries = []
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!oldHeadLeftoverName(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) continue
      notes.push(path.join(parent, entry.name))
    }
  }
  return notes
}

const LIBRARY_PARTIAL_NAME = /^Cuttler\.partial-\d+-\d+$/

function readBuildPartialMarker(dir) {
  try {
    const st = fs.lstatSync(path.join(dir, PARTIAL_MARKER_FILE))
    if (!st.isFile() || st.isSymbolicLink()) return null
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, PARTIAL_MARKER_FILE), 'utf8'))
    if (!parsed || !Number.isInteger(parsed.pid) || !Number.isInteger(parsed.startTime) || !Number.isInteger(parsed.createdAt)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Remove only this build's verified Application Support partial. Never a Fonts partial. */
function removeVerifiedLibraryPartial(home, hooks) {
  const support = path.join(home, 'Library/Application Support')
  let entries = []
  try {
    entries = fs.readdirSync(support, { withFileTypes: true })
  } catch {
    return
  }
  const sources = LEGACY_APP_FOLDER_NAMES.map((name) => path.join(support, name)).filter((dir) => plainDirectory(dir))
  const isAlive = hooks?.isAlive ?? defaultProcessAlive
  for (const entry of entries) {
    if (!LIBRARY_PARTIAL_NAME.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) continue
    const abs = path.join(support, entry.name)
    const marker = readBuildPartialMarker(abs)
    if (!marker) continue
    if (isAlive(marker.pid) === true && marker.pid !== process.pid) continue
    const source = sources.find((dir) => {
      try {
        return directoryTreesMatch(abs, dir)
      } catch {
        return false
      }
    })
    if (!source) continue
    fs.rmSync(abs, { recursive: true, force: true })
  }
}

/**
 * Fonts/Font Buttler and Fonts/Cuttler are siblings, so the move is a rename.
 * A cross-device mount or a permission error is left in place. Nothing is copied
 * and no font folder is removed except an empty directory via rmdir.
 */
function dropReplacement(home, current, pair) {
  const replacements = (current?.replacements ?? []).filter((item) => item !== pair)
  if (replacements.length === 0) {
    clearPendingMigration(home)
    return null
  }
  const next = { ...current, needsRewrite: true, replacements }
  writePendingMigration(home, next)
  return next
}

function fontDirHasFaces(dir) {
  if (!plainDirectory(dir)) return false
  try {
    return fs.readdirSync(dir).some((name) => !finderJunkFile(dir, name))
  } catch {
    return false
  }
}

function chooseFontSource(fonts, from, fontsFrom) {
  const nonempty = (dir) => fontDirHasFaces(dir)
  if (from && nonempty(from)) return from
  if (fontsFrom) {
    const recorded = fonts.sources.find((dir) => path.basename(dir) === fontsFrom)
    if (recorded && nonempty(recorded)) return recorded
    if (recorded && !lstatOrNull(recorded)) return null
  }
  const filled = fonts.sources.filter(nonempty)
  if (filled.length > 0) return filled[0]
  if (from && (plainDirectory(from) || lstatOrNull(from)?.isSymbolicLink())) return from
  return fonts.sources.find((dir) => plainDirectory(dir) || lstatOrNull(dir)?.isSymbolicLink()) ?? null
}

/**
 * Fonts/Font Buttler and Fonts/Cuttler are siblings, so the move is a rename.
 * Records and catalog rewrites keep the lexical path. realpath is only for
 * checking that a record names those folders. A cross-device mount or a
 * permission error is left in place. Nothing is copied.
 */
function catalogPointsAt(dataRoot, from, to) {
  try {
    const text = fs.readFileSync(path.join(dataRoot, 'catalog.json'), 'utf8')
    if (to && text.includes(to)) return to
    if (from && text.includes(from)) return from
  } catch {
    // No catalog yet. The destination name is the folder Cuttler would use.
  }
  return to
}

function renameLegacyFonts(home, pending, hooks, fontsFrom, dataRoot) {
  const fonts = lexicalDirs(home, 'Fonts')
  const rename = hooks?.fontRenameSync ?? fs.renameSync
  const to = fonts.dest
  const notice = (source, reason, occupied = false) => ({
    status: 'blocked',
    source,
    occupied,
    fontsStayDir: source,
    fontsRenameReason: reason,
    pending,
  })
  const placed = (source) => {
    const lexical = lexicalFontSource(home, source) ?? source
    pending = updateFontPair(home, pending, lexical, to, { phase: 'placed', committed: true })
    return { status: 'moved', source: lexical, pending }
  }
  let recorded = (pending?.replacements ?? []).find(
    (item) => item?.phase === 'renaming' || libraryFontsDestination(item?.to),
  )
  if (recorded && !fontPairAllowed(home, recorded)) {
    console.error('Dropping a font migration record whose paths are not the Cuttler font folders')
    pending = dropReplacement(home, pending, recorded)
    recorded = null
  }
  const intent = recorded && (recorded.phase === 'renaming' || recorded.committed !== true)
  if (recorded?.phase === 'staged') {
    const source = lexicalFontSource(home, recorded.from) ?? recorded.from
    const pointed = catalogPointsAt(dataRoot, source, to)
    return { ...notice(source, 'staged', false), catalogPointsAt: pointed, pending }
  }
  const keptRecord = recorded && (recorded.committed === true || recorded.phase === 'placed') && recorded.phase !== 'renaming'
  if (keptRecord && plainDirectory(recorded.from) && plainDirectory(recorded.to) && !plainEmptyDirectory(recorded.to)) {
    const source = lexicalFontSource(home, recorded.from) ?? recorded.from
    const pointed = catalogPointsAt(dataRoot, source, to)
    return { ...notice(source, recorded.phase === 'placed' ? 'placed' : 'old-head', true), catalogPointsAt: pointed, pending }
  }
  const from = recorded && fontPairAllowed(home, recorded) ? lexicalFontSource(home, recorded.from) : null
  if (from && !lstatOrNull(from) && plainDirectory(to) && !plainEmptyDirectory(to)) return placed(from)
  const source = chooseFontSource(fonts, from, fontsFrom)
  if (!source) return { status: 'absent', source: null, pending }
  const sourceStat = lstatOrNull(source)
  if (!sourceStat || sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) return notice(source, 'symlink', false)
  const destStat = lstatOrNull(to)
  if (destStat && !plainDirectory(to)) {
    return notice(source, destStat.isSymbolicLink() ? 'symlink' : 'file', true)
  }
  if (plainDirectory(to) && !plainEmptyDirectory(to)) return notice(source, 'occupied', true)
  if (plainEmptyDirectory(to)) {
    try {
      if (!rmdirEmptyPlainDir(to) && lstatOrNull(to)) return notice(source, 'occupied', true)
    } catch (error) {
      return { ...notice(source, error?.code || 'EIO', false), pending }
    }
  }
  if (!intent) pending = updateFontPair(home, pending, source, to, { phase: 'renaming', committed: false })
  try {
    rename(source, to)
  } catch (error) {
    const code = error?.code
    if (code === 'ENOENT') {
      if (!lstatOrNull(source) && plainDirectory(to)) return placed(source)
      return { status: 'absent', source, pending }
    }
    if (code === 'EXDEV' || code === 'EACCES' || code === 'EPERM') return { ...notice(source, code, false), pending }
    throw error
  }
  if (hooks?.crashAfterFontRename) {
    const killed = new Error('killed after the fonts rename')
    killed.code = 'EFONTRENAME'
    throw killed
  }
  const moved = placed(source)
  const kept = fonts.sources.find((dir) => dir !== source && fontDirHasFaces(dir))
  if (kept) moved.keptBeside = kept
  return moved
}

export function migrateLegacyMacAppDirs(home, hooks) {
  const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const installDir = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  // 0.4.0's instance lock lives in the legacy folder. Electron's own lock
  // follows this process's userData (Cuttler) and cannot see that owner.
  // Wait out a quitting updater, then refuse rather than move the library
  // out from under a process that still has it open.
  const owner = waitForLegacyLibraryOwner(home, hooks)
  if (owner?.kind === 'legacy') return ownerBlockedResult(dataRoot, installDir, owner)
  if (owner?.kind === 'same-app') return sameAppInstanceResult(dataRoot, installDir, owner)
  let pending = readPendingMigration(home)
  removeVerifiedLibraryPartial(home, hooks)
  const oldHeadNotes = listOldHeadLeftovers(home)
  if (pending) rewriteKeptLibrary(home, pending, dataRoot)
  const committedSources = new Set(
    (pending?.replacements ?? [])
      .filter((item) => item?.committed === true && typeof item.from === 'string' && fontPlacementRecorded(item) && recordPairAllowed(home, item))
      .map((item) => item.from),
  )
  const moveHooks = {
    ...hooks,
    onCopyCommitted(from, to) {
      if (hooks?.failCommitRecord) {
        const error = new Error('commit record failed')
        error.code = 'ECOMMITTED'
        throw error
      }
      committedSources.add(from)
      pending = markCopyCommitted(home, pending, from, to)
    },
  }
  const dataSources = LEGACY_APP_FOLDER_NAMES.map((name) =>
    path.join(home, 'Library/Application Support', name),
  )
  const marker = readMarker(dataRoot)
  const data = migrateSide({
    dest: dataRoot,
    sources: dataSources,
    unused: isFreshDataRoot,
    movedFrom: marker?.dataFrom ?? pending?.dataFrom ?? null,
    hooks: moveHooks,
    committedSources,
    beforeMove(source) {
      // A fresh Cuttler folder is renamed aside and deleted. A queued Finder
      // error written there would go with it. Copy the record into the
      // library first. A failure must not block the move.
      try {
        carryFinderSyncPendingError(source, dataRoot)
      } catch {
        // The library move still has to finish.
      }
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
  // The library copy is not the library until its commit record is written.
  // Moving fonts first would activate both font folders and rewrite only one catalog.
  const unfinishedDataCopy = data.status === 'stalled' && libraryCopyUncommitted(pending, dataRoot)
  const fonts = unfinishedDataCopy
    ? { status: 'absent', source: null, occupied: false }
    : renameLegacyFonts(home, pending, hooks, marker?.fontsFrom ?? pending?.fontsFrom ?? null, dataRoot)
  if (fonts.keptBeside) oldHeadNotes.push(fonts.keptBeside)
  if (Object.prototype.hasOwnProperty.call(fonts, 'pending')) pending = fonts.pending
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
    if (!unfinishedDataCopy) rewriteKeptLibrary(home, pending, dataRoot)
    const library = pending.stalledDataDir && followedDirectory(pending.stalledDataDir)
      ? pending.stalledDataDir
      : dataRoot
    // An uncommitted copy that stalled must not gain a marker in either folder.
    const uncommittedData = pending.replacements.some(
      (pair) => pair?.committed !== true && pair?.to === dataRoot && followedDirectory(pair.from),
    )
    if (
      followedDirectory(library) &&
      (record.dataFrom || record.fontsFrom) &&
      !(data.status === 'stalled' && uncommittedData && library === data.source)
    ) {
      writeMarker(library, record)
    }
    const keepPending = pending.replacements.some((pair) => {
      if (!lstatOrNull(pair.from)) return false
      if (pair.committed === true) return true
      return followedDirectory(pair.from)
    })
    if (!keepPending) clearPendingMigration(home)
  }
  const leftoverDataDir = data.status === 'moved' && data.leftover && lstatOrNull(data.leftover) ? data.leftover : null
  const leftoverFontsDir = fonts.status === 'moved' && fonts.leftover && lstatOrNull(fonts.leftover) ? fonts.leftover : null
  return {
    dataRoot,
    installDir,
    stalled: data.status === 'stalled',
    stalledDataDir: data.status === 'stalled' ? data.source : null,
    stalledFontsDir: fonts.status === 'blocked' ? fonts.source : null,
    leftoverDataDir,
    leftoverFontsDir,
    leftoverDataDestEmpty: data.destEmpty === true,
    leftoverFontsDestEmpty: fonts.destEmpty === true,
    unfinishedDataCopy,
    fontsStayDir: fonts.fontsStayDir ?? null,
    fontsRenameReason: fonts.fontsRenameReason ?? null,
    catalogPointsAt: fonts.catalogPointsAt ?? null,
    oldHeadNotes,
    dataOccupied: data.status === 'stalled' ? data.occupied !== false : false,
    fontsOccupied: fonts.status === 'blocked' ? fonts.occupied === true : false,
    movedData: data.status === 'moved',
    movedFonts: fonts.status === 'moved',
    blockedByOwner: false,
    ownerPid: null,
    ownerDataDir: null,
    runningInstanceDataDir: null,
  }
}

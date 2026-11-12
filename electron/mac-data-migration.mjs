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

export function rewriteCatalogLegacyPaths(catalogPath, replacements) {
  if (!catalogPath || !fs.existsSync(catalogPath) || !replacements?.length) return
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read ${catalogPath} to rewrite library paths`, { cause: error })
  }
  if (!parsed || !Array.isArray(parsed.entries)) return
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
  if (!changed) return
  commitJson(catalogPath, parsed)
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

function migrateSide({ dest, sources, unused, movedFrom, hooks }) {
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

function applyLibraryRewrites(dataRoot, stalledDataDir, replacements) {
  if (!replacements?.length) return
  const roots = new Set([dataRoot, stalledDataDir].filter(Boolean))
  for (const root of roots) {
    rewriteCatalogLegacyPaths(path.join(root, 'catalog.json'), replacements)
    rewriteJsonLegacyPaths(path.join(root, 'mutation-journal.json'), replacements)
  }
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

export function migrateLegacyMacAppDirs(home, hooks) {
  const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const installDir = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  const pending = readPendingMigration(home)
  if (pending) {
    applyLibraryRewrites(pending.dataRoot, pending.stalledDataDir, pending.replacements)
    if (pending.dataRoot && followedDirectory(pending.dataRoot)) {
      writeMarker(pending.dataRoot, {
        dataFrom: pending.dataFrom,
        fontsFrom: pending.fontsFrom,
      })
    }
    clearPendingMigration(home)
  }
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
  })
  const fonts = migrateSide({
    dest: installDir,
    sources: fontSources,
    unused: isEmptyDir,
    movedFrom: marker?.fontsFrom ?? pending?.fontsFrom ?? null,
    hooks,
  })
  const replacements = []
  if (data.status === 'moved') replacements.push({ from: data.source, to: dataRoot })
  if (fonts.status === 'moved') replacements.push({ from: fonts.source, to: installDir })
  const record = {
    dataFrom: data.status === 'moved' ? path.basename(data.source) : marker?.dataFrom ?? pending?.dataFrom ?? null,
    fontsFrom: fonts.status === 'moved' ? path.basename(fonts.source) : marker?.fontsFrom ?? pending?.fontsFrom ?? null,
  }
  if (replacements.length > 0) {
    const stalledDataDir = data.status === 'stalled' ? data.source : null
    writePendingMigration(home, {
      needsRewrite: true,
      replacements,
      dataRoot,
      stalledDataDir,
      dataFrom: record.dataFrom,
      fontsFrom: record.fontsFrom,
    })
    if (hooks?.failRewrite) {
      throw new Error('rewrite failed')
    }
    applyLibraryRewrites(dataRoot, stalledDataDir, replacements)
    if (data.status === 'moved' || followedDirectory(dataRoot)) {
      writeMarker(dataRoot, record)
    }
    clearPendingMigration(home)
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
  }
}

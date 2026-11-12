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

/** True when the folder is missing, or has neither catalog.json nor settings.json. */
export function isFreshDataRoot(dir) {
  const st = lstatOrNull(dir)
  if (!st) return true
  if (!st.isDirectory() || st.isSymbolicLink()) return false
  return (
    !fs.existsSync(path.join(dir, 'catalog.json')) && !fs.existsSync(path.join(dir, 'settings.json'))
  )
}

/** True when the folder is missing or contains no entries. A symlink is not empty. */
export function isEmptyDir(dir) {
  const st = lstatOrNull(dir)
  if (!st) return true
  if (!st.isDirectory() || st.isSymbolicLink()) return false
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

export function rewriteCatalogLegacyPaths(catalogPath, replacements) {
  if (!catalogPath || !fs.existsSync(catalogPath) || !replacements?.length) return
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  } catch {
    return
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
  const tmp = `${catalogPath}.${process.pid}.${process.hrtime.bigint()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2))
    fs.renameSync(tmp, catalogPath)
  } catch {
    fs.rmSync(tmp, { force: true })
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
function migrateSide({ dest, sources, unused, movedFrom, hooks }) {
  const present = sources.filter(realDirectory)
  if (present.length === 0) return { status: 'absent', source: null }
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
    if (realDirectory(source)) return { status: 'stalled', source, occupied: false }
    if (realDirectory(dest)) return { status: 'moved', source }
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

export function migrateLegacyMacAppDirs(home, hooks) {
  const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const installDir = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  const dataSources = LEGACY_APP_FOLDER_NAMES.map((name) =>
    path.join(home, 'Library/Application Support', name),
  )
  const fontSources = LEGACY_APP_FOLDER_NAMES.map((name) => path.join(home, 'Library/Fonts', name))
  const marker = readMarker(dataRoot)
  const data = migrateSide({
    dest: dataRoot,
    sources: dataSources,
    unused: isFreshDataRoot,
    movedFrom: marker?.dataFrom,
    hooks,
  })
  const fonts = migrateSide({
    dest: installDir,
    sources: fontSources,
    unused: isEmptyDir,
    movedFrom: marker?.fontsFrom,
    hooks,
  })
  const replacements = []
  if (data.status === 'moved') replacements.push({ from: data.source, to: dataRoot })
  if (fonts.status === 'moved') replacements.push({ from: fonts.source, to: installDir })
  if (replacements.length > 0) {
    const catalogs = new Set([path.join(dataRoot, 'catalog.json')])
    if (data.status === 'stalled' && data.source) catalogs.add(path.join(data.source, 'catalog.json'))
    for (const catalog of catalogs) rewriteCatalogLegacyPaths(catalog, replacements)
  }
  if (data.status === 'moved' || fonts.status === 'moved') {
    writeMarker(dataRoot, {
      dataFrom: data.status === 'moved' ? path.basename(data.source) : marker?.dataFrom ?? null,
      fontsFrom: fonts.status === 'moved' ? path.basename(fonts.source) : marker?.fontsFrom ?? null,
    })
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

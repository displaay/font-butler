import chokidar, { type FSWatcher } from 'chokidar'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MAX_IMPORT_FILES } from './constants.ts'
import {
  buildPathOccupancyIndex,
  findBySourcePath,
  isExternalSource,
  loadCatalog,
  resolveStatusWhenSourceFound,
  runCatalogTask,
  saveCatalog,
} from './catalog.ts'
import { emitEvent } from './events.ts'
import { countInstallableFormats, isWebFontFile } from './formats.ts'
import { tryFingerprintFile } from './fingerprint.ts'
import { isFontFile, isPreviewableFontFile, readFileStat } from './parse.ts'
import { applyEntryFacts } from './state.ts'
import type { AppPaths } from './paths.ts'
import { loadSettings } from './settings.ts'
import type { CatalogEntry } from './types.ts'

let watcher: FSWatcher | null = null
let watchedSourcePaths = new Set<string>()
let inboxWatcher: FSWatcher | null = null
let userFontsWatcher: FSWatcher | null = null
let destParentWatcher: FSWatcher | null = null
let destAppearPoll: ReturnType<typeof setInterval> | null = null
let userFontsTimer: ReturnType<typeof setTimeout> | null = null
let inboxTimer: ReturnType<typeof setTimeout> | null = null
let inboxPending: string[] = []
let sourceStatusListener: ((entry: CatalogEntry) => void) | undefined
let pendingSourceStatusPaths = new Set<string>()
let sourceStatusBatchTimer: ReturnType<typeof setTimeout> | null = null
let sourceStatusBatchPaths: AppPaths | null = null

export function setSourceStatusListener(listener?: (entry: CatalogEntry) => void): void {
  sourceStatusListener = listener
}

function persistCatalogIfChanged(
  paths: AppPaths,
  catalog: ReturnType<typeof loadCatalog>,
  changed: boolean,
): void {
  if (!changed) return
  saveCatalog(paths, catalog)
  emitEvent({ type: 'catalog', entries: catalog.entries })
}

export function refreshWatchedEntry(
  entry: CatalogEntry,
  options: { forceFingerprint?: boolean } = {},
): boolean {
  let changed = applyEntryFacts(entry)
  if (entry.sourceAvailability !== 'present' || !entry.sourcePath) {
    if (changed) entry.updatedAt = Date.now()
    return changed
  }
  const sourcePath = entry.sourcePath
  const stat = readFileStat(sourcePath)
  // Periodic reconcile can trust mtime+size. Watcher-triggered refresh cannot:
  // timestamp-preserving sync (Dropbox-style) can replace bytes without a stamp change.
  const stampUnchanged =
    !options.forceFingerprint &&
    stat.mtimeMs === entry.sourceMtimeMs &&
    stat.size === entry.sourceSize &&
    Boolean(entry.sourceFingerprint)
  let fingerprint = entry.sourceFingerprint
  if (!stampUnchanged) {
    if (entry.sourceMtimeMs !== stat.mtimeMs) {
      entry.sourceMtimeMs = stat.mtimeMs
      changed = true
    }
    if (entry.sourceSize !== stat.size) {
      entry.sourceSize = stat.size
      changed = true
    }
    fingerprint = tryFingerprintFile(sourcePath) ?? fingerprint
    if (fingerprint && fingerprint !== entry.sourceFingerprint) {
      entry.sourceFingerprint = fingerprint
      changed = true
    }
  }
  const bytesDiffer = fingerprint && entry.installedFingerprint
    ? fingerprint !== entry.installedFingerprint
    : stat.mtimeMs !== entry.installedSnapshotMtimeMs || stat.size !== entry.installedSnapshotSize
  let nextStatus = entry.status
  if (
    (entry.status === 'installed' || entry.status === 'outdated') &&
    bytesDiffer &&
    !entry.updateHold
  ) {
    nextStatus = 'outdated'
  } else if (entry.status === 'source-missing') {
    nextStatus = resolveStatusWhenSourceFound(entry)
  } else if (entry.status === 'outdated' && !bytesDiffer) {
    nextStatus = 'installed'
  }
  if (nextStatus !== entry.status) {
    entry.status = nextStatus
    changed = true
  }
  if (changed) entry.updatedAt = Date.now()
  return changed
}

function refreshStatusUnlocked(paths: AppPaths, sourcePath: string): CatalogEntry | undefined {
  const catalog = loadCatalog(paths)
  const entry = findBySourcePath(catalog, sourcePath)
  if (!entry) {
    return undefined
  }
  persistCatalogIfChanged(paths, catalog, refreshWatchedEntry(entry, { forceFingerprint: true }))
  return entry
}

function refreshStatusesBatchUnlocked(
  paths: AppPaths,
  sourcePaths: string[],
): CatalogEntry[] {
  if (sourcePaths.length === 0) return []
  const catalog = loadCatalog(paths)
  const index = buildPathOccupancyIndex(catalog.entries)
  const updated: CatalogEntry[] = []
  let changedAny = false
  for (const raw of sourcePaths) {
    const resolved = path.resolve(raw)
    const entry = index.findBySourcePath(resolved)
    if (!entry) continue
    if (refreshWatchedEntry(entry, { forceFingerprint: true })) {
      changedAny = true
      updated.push(entry)
    }
  }
  persistCatalogIfChanged(paths, catalog, changedAny)
  return updated
}

export function enqueueSourceStatusRefresh(paths: AppPaths, filePath: string): void {
  if (!isFontFile(filePath)) return
  sourceStatusBatchPaths = paths
  pendingSourceStatusPaths.add(path.resolve(filePath))
  if (sourceStatusBatchTimer) return
  sourceStatusBatchTimer = setTimeout(() => {
    sourceStatusBatchTimer = null
    const batchPaths = sourceStatusBatchPaths
    const batch = [...pendingSourceStatusPaths]
    pendingSourceStatusPaths.clear()
    if (!batchPaths || batch.length === 0) return
    void runCatalogTask(() => {
      const updated = refreshStatusesBatchUnlocked(batchPaths, batch)
      for (const entry of updated) {
        sourceStatusListener?.(entry)
      }
    })
  }, 75)
}

/** Test hook: flush coalesced source-status refreshes immediately. */
export async function flushSourceStatusRefreshForTest(paths: AppPaths): Promise<void> {
  if (sourceStatusBatchTimer) {
    clearTimeout(sourceStatusBatchTimer)
    sourceStatusBatchTimer = null
  }
  const batch = [...pendingSourceStatusPaths]
  pendingSourceStatusPaths.clear()
  sourceStatusBatchPaths = null
  if (batch.length === 0) return
  await runCatalogTask(() => {
    refreshStatusesBatchUnlocked(paths, batch)
  })
}

export function refreshSourceStatus(
  paths: AppPaths,
  sourcePath: string,
): Promise<CatalogEntry | undefined> {
  return runCatalogTask(() => refreshStatusUnlocked(paths, sourcePath))
}

export function reconcileWatchedSources(paths: AppPaths): Promise<CatalogEntry[]> {
  return runCatalogTask(() => {
    const catalog = loadCatalog(paths)
    const changed: CatalogEntry[] = []
    for (const entry of catalog.entries) {
      if (!isExternalSource(entry) || !entry.sourcePath) continue
      if (refreshWatchedEntry(entry)) changed.push(entry)
    }
    persistCatalogIfChanged(paths, catalog, changed.length > 0)
    return changed
  })
}

export const FONT_TREE_MAX_DEPTH = 10

const SOURCE_WATCH_OPTIONS = {
  ignoreInitial: true,
  depth: FONT_TREE_MAX_DEPTH,
  ignored: (watchPath: string, stats?: fs.Stats) => {
    const base = path.basename(watchPath)
    if (shouldSkipFontWalkName(base)) return true
    if (stats?.isFile() && !isFontFile(watchPath)) return true
    return false
  },
  awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
} as const

function isLiveWatcher(value: FSWatcher | null): value is FSWatcher {
  return Boolean(value) && !value.closed
}

function bindSourceWatcher(paths: AppPaths, instance: FSWatcher): void {
  const apply = (filePath: string) => {
    enqueueSourceStatusRefresh(paths, filePath)
  }
  instance.on('change', apply)
  instance.on('unlink', apply)
  instance.on('add', apply)
}

async function closeSourceWatcher(): Promise<void> {
  if (watcher) {
    try {
      await watcher.close()
    } catch {
      // Already gone.
    }
    watcher = null
  }
  watchedSourcePaths.clear()
}

export function externalSourceWatchTargets(
  paths: AppPaths,
  catalog = loadCatalog(paths),
): string[] {
  const settings = loadSettings(paths)
  const watchingRoots = [
    ...new Set(
      settings.folders
        .filter((folder) => folder.watching && !folder.paused)
        .map((folder) => path.resolve(folder.root)),
    ),
  ]
  const looseFiles: string[] = []
  for (const entry of catalog.entries) {
    if (!isExternalSource(entry) || !entry.sourcePath) continue
    const resolved = path.resolve(entry.sourcePath)
    if (
      watchingRoots.some(
        (root) => resolved === root || resolved.startsWith(root + path.sep),
      )
    ) {
      continue
    }
    looseFiles.push(resolved)
  }
  return looseFiles
}

export async function syncWatchers(paths: AppPaths): Promise<void> {
  const catalog = loadCatalog(paths)
  const targets = externalSourceWatchTargets(paths, catalog)

  if (!isLiveWatcher(watcher)) {
    await closeSourceWatcher()
    if (targets.length === 0) {
      return
    }
    watcher = chokidar.watch(targets, SOURCE_WATCH_OPTIONS)
    watchedSourcePaths = new Set(targets)
    bindSourceWatcher(paths, watcher)
    return
  }

  const next = new Set(targets)
  const toAdd = targets.filter((target) => !watchedSourcePaths.has(target))
  const toRemove = [...watchedSourcePaths].filter((target) => !next.has(target))
  if (toAdd.length) watcher.add(toAdd)
  if (toRemove.length) watcher.unwatch(toRemove)
  watchedSourcePaths = next
}

export function shouldSkipFontWalkName(name: string): boolean {
  return name.startsWith('.') || name === '__MACOSX'
}

type TreeFonts = {
  files: string[]
  previewFiles: string[]
  skippedWeb: number
}

function collectTreeFonts(
  root: string,
  depth = 0,
  maxDepth = FONT_TREE_MAX_DEPTH,
  includeWeb = false,
): TreeFonts {
  if (depth > maxDepth) {
    return { files: [], previewFiles: [], skippedWeb: 0 }
  }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return { files: [], previewFiles: [], skippedWeb: 0 }
  }
  const files: string[] = []
  const previewFiles: string[] = []
  let skippedWeb = 0
  for (const entry of entries) {
    if (files.length + previewFiles.length >= MAX_IMPORT_FILES) break
    if (shouldSkipFontWalkName(entry.name)) {
      continue
    }
    const full = path.join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      const nested = collectTreeFonts(full, depth + 1, maxDepth, includeWeb)
      files.push(...nested.files)
      previewFiles.push(...nested.previewFiles)
      skippedWeb += nested.skippedWeb
    } else if (entry.isFile()) {
      if (isWebFontFile(full)) {
        skippedWeb += 1
        previewFiles.push(path.resolve(full))
        if (includeWeb) {
          files.push(path.resolve(full))
        }
      } else if (isFontFile(full)) {
        files.push(path.resolve(full))
      }
    }
  }
  return { files, previewFiles, skippedWeb }
}

export function listFontFilesInTree(
  root: string,
  depth = 0,
  maxDepth = FONT_TREE_MAX_DEPTH,
): string[] {
  return collectTreeFonts(root, depth, maxDepth, false).files
}

export function listInboxFontFiles(root: string, depth = 0): string[] {
  return collectTreeFonts(root, depth, FONT_TREE_MAX_DEPTH, true).files
}

export function expandImportPaths(inputPaths: string[]): {
  files: string[]
  errors: string[]
  skippedWeb: number
} {
  const files: string[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  let skippedWeb = 0

  const addFile = (filePath: string) => {
    const resolved = path.resolve(filePath)
    if (seen.has(resolved)) {
      return
    }
    seen.add(resolved)
    files.push(resolved)
  }

  for (const raw of inputPaths) {
    const resolved = path.resolve(raw)
    if (!fs.existsSync(resolved)) {
      errors.push(`${raw}: Not found.`)
      continue
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(resolved)
    } catch (error) {
      errors.push(`${raw}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (stat.isDirectory()) {
      const found = collectTreeFonts(resolved, 0, FONT_TREE_MAX_DEPTH, true)
      skippedWeb += found.skippedWeb
      if (found.files.length === 0) {
        errors.push(`${raw}: No font files in that folder.`)
        continue
      }
      for (const filePath of found.files) {
        addFile(filePath)
      }
      continue
    }
    if (stat.isFile()) {
      if (isWebFontFile(resolved)) {
        skippedWeb += 1
      }
      addFile(resolved)
      continue
    }
    errors.push(`${raw}: Not a file.`)
  }

  return { files, errors, skippedWeb }
}

const WELL_KNOWN_HOME_FOLDERS = new Set([
  'Desktop',
  'Documents',
  'Downloads',
  'Library',
  'Movies',
  'Music',
  'Pictures',
  'Public',
])

function isWellKnownUserDir(dir: string): boolean {
  const resolved = path.resolve(dir)
  const home = path.resolve(os.homedir())
  if (resolved === home) return true
  const root = path.parse(resolved).root
  if (resolved === root) return true
  return path.dirname(resolved) === home && WELL_KNOWN_HOME_FOLDERS.has(path.basename(resolved))
}

function samePathSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const values = new Set(left.map(canonicalize))
  return right.every((filePath) => values.has(canonicalize(filePath)))
}

function longestCommonDir(filePaths: string[]): string | undefined {
  if (filePaths.length === 0) return undefined
  const dirs = filePaths.map((filePath) => path.dirname(path.resolve(filePath)))
  let common = dirs[0]
  for (const dir of dirs.slice(1)) {
    while (common !== path.parse(common).root && dir !== common && !dir.startsWith(`${common}${path.sep}`)) {
      common = path.dirname(common)
    }
  }
  return common
}

function isPathInside(filePath: string, folder: string): boolean {
  const resolved = path.resolve(filePath)
  const root = path.resolve(folder)
  return resolved === root || resolved.startsWith(`${root}${path.sep}`)
}

function canonicalize(filePath: string): string {
  const resolved = path.resolve(filePath)
  try {
    return fs.realpathSync(resolved)
  } catch {
    return resolved
  }
}

function installableDropFiles(filePaths: string[]): string[] {
  return [...new Set(filePaths.filter((filePath) => isFontFile(filePath)).map((filePath) => path.resolve(filePath)))]
}

export function inferExpandedFolderDrops(filePaths: string[]): string[] {
  const files = installableDropFiles(filePaths)
  if (files.length < 2) return []

  const common = longestCommonDir(files)
  if (common && !isWellKnownUserDir(common)) {
    let candidate: string | undefined = common
    const home = path.resolve(os.homedir())
    while (candidate && candidate !== path.parse(candidate).root) {
      if (isWellKnownUserDir(candidate)) break
      if (samePathSet(listFontFilesInTree(candidate), files)) {
        return [candidate]
      }
      if (candidate === home) break
      candidate = path.dirname(candidate)
    }
  }

  const parents = new Set(files.map((filePath) => path.dirname(filePath)))
  if (parents.size > 1 && common && !isWellKnownUserDir(common)) {
    return [common]
  }

  const byParent = new Map<string, string[]>()
  for (const filePath of files) {
    const parent = path.dirname(filePath)
    const list = byParent.get(parent) ?? []
    list.push(filePath)
    byParent.set(parent, list)
  }
  const inferred: string[] = []
  for (const [parent, group] of byParent) {
    if (isWellKnownUserDir(parent)) continue
    if (samePathSet(listFontFilesInTree(parent), group)) {
      inferred.push(parent)
    }
  }
  return inferred
}

export type DropInspect = {
  folders: string[]
  files: string[]
  formats: Array<{ format: string; count: number }>
  skippedWeb: number
}

export function inspectDropPaths(inputPaths: string[]): DropInspect {
  const folders = new Set<string>()
  const filePaths: string[] = []

  for (const raw of inputPaths) {
    const resolved = path.resolve(raw)
    if (!fs.existsSync(resolved)) continue
    let stat: fs.Stats
    try {
      stat = fs.statSync(resolved)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      folders.add(resolved)
      continue
    }
    if (stat.isFile()) {
      filePaths.push(resolved)
    }
  }

  if (folders.size === 0) {
    for (const inferred of inferExpandedFolderDrops(filePaths)) {
      folders.add(inferred)
    }
  }

  const folderList = [...folders]
  const toExpand =
    folderList.length > 0
      ? [...folderList, ...filePaths.filter((filePath) => !folderList.some((folder) => isPathInside(filePath, folder)))]
      : filePaths
  const expanded = expandImportPaths(toExpand)
  return {
    folders: folderList,
    files: expanded.files,
    formats: countInstallableFormats(expanded.files),
    skippedWeb: expanded.skippedWeb,
  }
}

function existingWatchFolders(folders: string[]): string[] {
  const existing: string[] = []
  for (const folder of folders) {
    if (!folder) continue
    try {
      if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
        existing.push(folder)
      }
    } catch {
      // Skip folders that disappeared between settings save and watch setup.
    }
  }
  return existing
}

export async function syncInboxWatcher(
  folders: string[],
  onBatch: (filePaths: string[]) => void,
  paths?: AppPaths,
): Promise<void> {
  if (inboxTimer) {
    clearTimeout(inboxTimer)
    inboxTimer = null
  }
  const pending = inboxPending
  if (inboxWatcher) {
    await inboxWatcher.close()
    inboxWatcher = null
  }
  inboxPending = pending
  const existing = existingWatchFolders(folders)
  if (existing.length === 0) {
    return
  }
  inboxWatcher = chokidar.watch(existing, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    depth: FONT_TREE_MAX_DEPTH,
  })
  const queue = (filePath: string) => {
    if (!isPreviewableFontFile(filePath)) {
      return
    }
    inboxPending.push(path.resolve(filePath))
    if (inboxTimer) {
      clearTimeout(inboxTimer)
    }
    inboxTimer = setTimeout(() => {
      const batch = [...new Set(inboxPending)]
      inboxPending = []
      inboxTimer = null
      if (batch.length) {
        onBatch(batch)
      }
    }, 350)
  }
  inboxWatcher.on('add', queue)
  if (paths) {
    const touchStatus = (filePath: string) => {
      enqueueSourceStatusRefresh(paths, filePath)
    }
    inboxWatcher.on('change', touchStatus)
    inboxWatcher.on('unlink', touchStatus)
  }
}

const USER_FONTS_WATCH_OPTIONS = {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  depth: FONT_TREE_MAX_DEPTH,
} as const

async function closeUserFontsWatchers(): Promise<void> {
  if (userFontsTimer) {
    clearTimeout(userFontsTimer)
    userFontsTimer = null
  }
  if (destAppearPoll) {
    clearInterval(destAppearPoll)
    destAppearPoll = null
  }
  if (userFontsWatcher) {
    try {
      await userFontsWatcher.close()
    } catch {
      // Already gone.
    }
    userFontsWatcher = null
  }
  if (destParentWatcher) {
    try {
      await destParentWatcher.close()
    } catch {
      // Already gone.
    }
    destParentWatcher = null
  }
}

function isExistingDir(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function waitForReady(instance: FSWatcher | null): Promise<void> {
  if (!isLiveWatcher(instance)) return Promise.resolve()
  return Promise.race([
    new Promise<void>((resolve) => {
      instance.once('ready', () => resolve())
    }),
    new Promise<void>((resolve) => {
      setTimeout(resolve, 400)
    }),
  ])
}

export async function syncUserFontsWatcher(
  dirs: string | readonly string[],
  onChange: () => void,
): Promise<void> {
  await closeUserFontsWatchers()
  const requested = [
    ...new Set(
      (Array.isArray(dirs) ? dirs : [dirs])
        .filter((dir): dir is string => typeof dir === 'string' && dir.trim().length > 0)
        .map((dir) => path.resolve(dir)),
    ),
  ]
  const existing = requested.filter(isExistingDir)
  const missing = new Set(requested.filter((dir) => !isExistingDir(dir)))
  const parents = [
    ...new Set(
      [...missing]
        .map((dir) => path.dirname(dir))
        .filter((dir) => dir && isExistingDir(dir)),
    ),
  ]
  if (existing.length === 0 && missing.size === 0) {
    return
  }
  const kick = () => {
    if (userFontsTimer) {
      clearTimeout(userFontsTimer)
    }
    userFontsTimer = setTimeout(() => {
      userFontsTimer = null
      onChange()
    }, 350)
  }
  const bindDestWatcher = (instance: FSWatcher) => {
    instance.on('add', kick)
    instance.on('unlink', kick)
  }
  const subscribeDest = (dir: string) => {
    if (isLiveWatcher(userFontsWatcher)) {
      userFontsWatcher.add(dir)
      return
    }
    userFontsWatcher = chokidar.watch(dir, USER_FONTS_WATCH_OPTIONS)
    bindDestWatcher(userFontsWatcher)
  }
  const claimDest = (dir: string): boolean => {
    const resolved = path.resolve(dir)
    if (!missing.has(resolved) || !isExistingDir(resolved)) return false
    missing.delete(resolved)
    subscribeDest(resolved)
    kick()
    return true
  }
  if (existing.length) {
    userFontsWatcher = chokidar.watch(existing, USER_FONTS_WATCH_OPTIONS)
    bindDestWatcher(userFontsWatcher)
  }
  if (parents.length) {
    destParentWatcher = chokidar.watch(parents, { ignoreInitial: true, depth: 0 })
    const onMaybeDest = (added: string) => {
      claimDest(added)
    }
    destParentWatcher.on('addDir', onMaybeDest)
    destParentWatcher.on('add', onMaybeDest)
  }
  if (missing.size) {
    destAppearPoll = setInterval(() => {
      for (const dir of [...missing]) {
        claimDest(dir)
      }
      if (missing.size === 0 && destAppearPoll) {
        clearInterval(destAppearPoll)
        destAppearPoll = null
      }
    }, 400)
    destAppearPoll.unref?.()
  }
  await Promise.all([waitForReady(userFontsWatcher), waitForReady(destParentWatcher)])
}

export async function closeAllWatchers(): Promise<void> {
  sourceStatusListener = undefined
  await closeSourceWatcher()
  await syncInboxWatcher([], () => {})
  await syncUserFontsWatcher('', () => {})
}

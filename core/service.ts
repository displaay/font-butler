import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  applySourcePresence,
  findByFaceIdentity,
  findById,
  findByInstalledPath,
  findBySourcePath,
  isExternalSource,
  loadCatalog,
  removeEntryById,
  resolveStatusWhenSourceFound,
  runCatalogTask,
  saveCatalog,
  sourceFileExists,
  upsertEntry,
} from './catalog.ts'
import { getOrCreateApiToken } from './auth.ts'
import { locateAdobeFontCache, locateOfficeFontCache } from './caches.ts'
import { MAX_UPLOAD_BYTES } from './constants.ts'
import { emitEvent } from './events.ts'
import {
  assertNotWebFont,
  assertSingleInstallableFormat,
  formatConflictMessage,
  installedFormatConflicts,
  isWebFontFile,
  WOFF_INSTALL_ERROR,
} from './formats.ts'
import {
  applyInstalledMetadata,
  commitInstalledFile,
  extensionForFormat,
  removeStagedFile,
  stageFontFile,
  uniquePathFromOriginal,
  uniqueSiblingPath,
} from './install.ts'
import { getFontNative } from './native.ts'
import { isFontFile, mimeForFont, parseFontFile, readFileStat } from './parse.ts'
import { isUnderAnyRoot } from './containment.ts'
import { ensureDirs, getPaths, isMac, type AppPaths } from './paths.ts'
import { postscriptPreview, renameFamilyCopy } from './rename.ts'
import { moveToTrash, revealInFileManager } from './reveal.ts'
import { loadSettings, saveSettings } from './settings.ts'
import { allowedFontPath, scanSystemFonts } from './system.ts'
import type {
  AdobeFontCacheInfo,
  AppSettings,
  CatalogEntry,
  Notice,
  OfficeFontCacheInfo,
  SortMode,
  SystemFace,
  ThemeMode,
  ViewLayout,
} from './types.ts'
import {
  expandImportPaths,
  inspectDropPaths,
  listFontFilesInTree,
  listInboxFontFiles,
  reconcileWatchedSources,
  setSourceStatusListener,
  syncInboxWatcher,
  syncUserFontsWatcher,
  syncWatchers,
  type DropInspect,
} from './watch.ts'

function now(): number {
  return Date.now()
}

function newId(): string {
  return crypto.randomUUID()
}

function displayFamily(entry: CatalogEntry): string {
  return entry.customFamilyName || entry.faces[0]?.familyName || 'Unknown'
}

function bindEntryToInstalledFile(entry: CatalogEntry, dest: string): void {
  const resolved = path.resolve(dest)
  const stat = readFileStat(resolved)
  entry.sourcePath = resolved
  entry.installedPath = resolved
  entry.disabledPath = undefined
  entry.sourceMtimeMs = stat.mtimeMs
  entry.sourceSize = stat.size
  entry.sourcePresent = false
  entry.installedSnapshotMtimeMs = stat.mtimeMs
  entry.installedSnapshotSize = stat.size
  entry.status = 'installed'
}

function sameFile(left: string, right: string): boolean {
  try {
    const a = fs.statSync(left)
    const b = fs.statSync(right)
    return a.dev === b.dev && a.ino === b.ino
  } catch {
    return path.resolve(left) === path.resolve(right)
  }
}

function destinationForInstall(
  paths: AppPaths,
  entry: CatalogEntry,
  fromPath: string,
  options: { reuseInstalled?: boolean } = {},
): string {
  const resolvedFrom = path.resolve(fromPath)
  const reuseInstalled = options.reuseInstalled !== false
  if (reuseInstalled && isUnderAnyRoot(resolvedFrom, [paths.installDir, paths.userFontsDir])) {
    return resolvedFrom
  }
  if (
    reuseInstalled &&
    entry.installedPath &&
    fs.existsSync(entry.installedPath) &&
    isUnderAnyRoot(entry.installedPath, [paths.installDir, paths.userFontsDir])
  ) {
    const installedExt = path.extname(entry.installedPath).toLowerCase()
    const incomingExt = extensionForFormat(entry.format, resolvedFrom).toLowerCase()
    if (!installedExt || installedExt === incomingExt) {
      return path.resolve(entry.installedPath)
    }
  }
  fs.mkdirSync(paths.installDir, { recursive: true })
  const ext = extensionForFormat(entry.format, resolvedFrom)
  const dest = path.join(paths.installDir, `${path.basename(resolvedFrom, path.extname(resolvedFrom))}${ext}`)
  if (!fs.existsSync(dest) || sameFile(dest, resolvedFrom)) {
    return dest
  }
  const stem = path.basename(dest, ext)
  const hash = crypto.createHash('sha1').update(resolvedFrom).digest('hex').slice(0, 8)
  return path.join(paths.installDir, `${stem}-${hash}${ext}`)
}

function emitCatalog(paths: AppPaths): CatalogEntry[] {
  const catalog = loadCatalog(paths)
  emitEvent({ type: 'catalog', entries: catalog.entries })
  return catalog.entries
}

function emitNotice(notice: Notice): void {
  emitEvent({ type: 'notice', notice })
}

function touchEntry(entry: CatalogEntry): void {
  entry.updatedAt = now()
}

async function removeInstalledCopy(entry: CatalogEntry): Promise<void> {
  if (entry.installedPath) {
    await getFontNative().unregisterFont(entry.installedPath)
    if (fs.existsSync(entry.installedPath)) {
      fs.rmSync(entry.installedPath, { force: true })
    }
  }
  entry.installedPath = undefined
}

function isProtectedSource(filePath: string, paths: AppPaths): boolean {
  return isUnderAnyRoot(filePath, [
    paths.systemFontsDir,
    paths.computerFontsDir,
    paths.supplementalFontsDir,
  ])
}

function isComputerOrigin(filePath: string, paths: AppPaths): boolean {
  return isUnderAnyRoot(filePath, [paths.computerFontsDir])
}

function writeUploadExclusive(dir: string, filename: string, data: Buffer): string {
  const safe = path.basename(filename).replace(/[^\w.-]+/g, '_') || 'font.bin'
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const dest = path.join(dir, `${crypto.randomUUID()}-${safe}`)
    try {
      fs.writeFileSync(dest, data, { flag: 'wx' })
      return dest
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (code !== 'EEXIST') {
        throw error
      }
    }
  }
  throw new Error(`Could not save ${filename}`)
}

function eligibleForInstall(entry: CatalogEntry): boolean {
  return entry.status === 'uninstalled' || entry.status === 'deactivated' || entry.status === 'outdated'
}

function eligibleForDeactivate(entry: CatalogEntry): boolean {
  return entry.status === 'installed' || entry.status === 'outdated'
}

function eligibleForReinstall(entry: CatalogEntry): boolean {
  return (
    entry.status === 'outdated' ||
    (entry.status === 'deactivated' && Boolean(entry.installedPath && fs.existsSync(entry.installedPath)))
  )
}

async function deleteSourceFile(filePath: string, paths: AppPaths): Promise<void> {
  const resolved = path.resolve(filePath)
  if (isProtectedSource(resolved, paths)) {
    throw new Error('System font files cannot be deleted.')
  }
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(resolved)
  } catch {
    return
  }
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(resolved)
    return
  }
  if (!stat.isFile()) {
    throw new Error('That source path is not a file.')
  }
  await moveToTrash(resolved)
}

export class FontButlerService {
  readonly paths: AppPaths
  private autoReinstallTimer: ReturnType<typeof setTimeout> | null = null
  private autoReinstallPending = new Set<string>()

  constructor(paths: AppPaths = getPaths()) {
    this.paths = paths
    ensureDirs(paths)
    setSourceStatusListener((entry) => {
      if (entry.status === 'outdated') {
        this.queueAutoReinstall(entry.id)
      }
    })
  }

  dispose(): void {
    if (this.autoReinstallTimer) {
      clearTimeout(this.autoReinstallTimer)
      this.autoReinstallTimer = null
    }
    this.autoReinstallPending.clear()
  }

  async init(): Promise<void> {
    ensureDirs(this.paths)
    await this.restoreDisabledCopies()
    await this.adoptUserFonts()
    await this.detachRenamedInstallSources()
    await this.seedIfEmpty()
    await this.refreshSourceStatuses()
    await this.reinstallCurrentlyOutdated()
    await syncWatchers(this.paths)
    await reconcileWatchedSources(this.paths)
    await this.refreshUserFontsWatcher()
    await this.refreshInboxWatcher(loadSettings(this.paths).watchFolders, { importExisting: true })
  }

  listCatalog(): CatalogEntry[] {
    return loadCatalog(this.paths).entries
  }

  getSettings(): AppSettings {
    return loadSettings(this.paths)
  }

  async updateSettings(patch: {
    watchFolders?: string[]
    defaultView?: ViewLayout
    defaultSort?: SortMode | 'installed'
    installAfterUpload?: boolean
    installWatchFolderFonts?: boolean
    theme?: ThemeMode
    menuBarIcon?: boolean
    openAtLogin?: boolean
    clearOfficeFontCache?: boolean
    clearAdobeFontCache?: boolean
    autoReinstallOnUpdate?: boolean
    skipCacheClearOnReinstall?: boolean
    nativeNotifications?: boolean
    onboardingCompleted?: boolean
  }): Promise<AppSettings> {
    const current = loadSettings(this.paths)
    const next: AppSettings = { ...current }
    if (patch.defaultView === 'list' || patch.defaultView === 'grid') {
      next.defaultView = patch.defaultView
    }
    if (patch.defaultSort === 'name' || patch.defaultSort === 'added') {
      next.defaultSort = patch.defaultSort
    } else if (patch.defaultSort === 'installed') {
      next.defaultSort = 'added'
    }
    if (typeof patch.installAfterUpload === 'boolean') {
      next.installAfterUpload = patch.installAfterUpload
    }
    if (typeof patch.installWatchFolderFonts === 'boolean') {
      next.installWatchFolderFonts = patch.installWatchFolderFonts
    }
    if (patch.theme === 'light' || patch.theme === 'dark' || patch.theme === 'system') {
      next.theme = patch.theme
    }
    if (typeof patch.menuBarIcon === 'boolean') {
      next.menuBarIcon = patch.menuBarIcon
    }
    if (typeof patch.openAtLogin === 'boolean') {
      next.openAtLogin = patch.openAtLogin
    }
    if (typeof patch.clearOfficeFontCache === 'boolean') {
      next.clearOfficeFontCache = patch.clearOfficeFontCache
    }
    if (typeof patch.clearAdobeFontCache === 'boolean') {
      next.clearAdobeFontCache = patch.clearAdobeFontCache
    }
    if (typeof patch.autoReinstallOnUpdate === 'boolean') {
      next.autoReinstallOnUpdate = patch.autoReinstallOnUpdate
    }
    if (typeof patch.skipCacheClearOnReinstall === 'boolean') {
      next.skipCacheClearOnReinstall = patch.skipCacheClearOnReinstall
    }
    if (typeof patch.nativeNotifications === 'boolean') {
      next.nativeNotifications = patch.nativeNotifications
    }
    if (typeof patch.onboardingCompleted === 'boolean') {
      next.onboardingCompleted = patch.onboardingCompleted
    }
    if ('watchFolders' in patch) {
      next.watchFolders = this.resolveWatchFolders(patch.watchFolders ?? [])
    }
    saveSettings(this.paths, next)
    emitEvent({ type: 'settings', settings: next })
    if ('watchFolders' in patch) {
      await this.refreshInboxWatcher(next.watchFolders, { importExisting: true })
    }
    if (next.autoReinstallOnUpdate && !current.autoReinstallOnUpdate) {
      await this.refreshSourceStatuses()
      await this.reinstallCurrentlyOutdated()
    }
    return next
  }

  officeFontCacheInfo(): OfficeFontCacheInfo {
    return locateOfficeFontCache()
  }

  adobeFontCacheInfo(): AdobeFontCacheInfo {
    return locateAdobeFontCache()
  }

  getApiToken(): string {
    return getOrCreateApiToken(this.paths.apiTokenPath)
  }

  listSystem(): SystemFace[] {
    const faces = scanSystemFonts(this.paths)
    emitEvent({ type: 'system', faces })
    return faces
  }

  inspectDrop(paths: string[]): DropInspect {
    return inspectDropPaths(paths)
  }

  async importPaths(filePaths: string[]): Promise<{
    entries: CatalogEntry[]
    errors: string[]
    ignored: number
  }> {
    return runCatalogTask(async () => {
      const expanded = expandImportPaths(filePaths)
      const errors = [...expanded.errors]
      if (expanded.files.length === 0 && expanded.skippedWeb > 0 && errors.length === 0) {
        errors.push(WOFF_INSTALL_ERROR)
      }
      const imported: CatalogEntry[] = []
      for (const filePath of expanded.files) {
        try {
          imported.push(this.importOneUnlocked(filePath))
        } catch (error) {
          errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return { entries: imported, errors, ignored: expanded.skippedWeb }
    })
  }

  async importUploads(
    files: { filename: string; data: Buffer }[],
  ): Promise<{ entries: CatalogEntry[]; errors: string[]; ignored: number }> {
    return runCatalogTask(async () => {
      fs.mkdirSync(this.paths.uploadsDir, { recursive: true })
      const saved: string[] = []
      const errors: string[] = []
      let ignored = 0
      for (const file of files) {
        if (isWebFontFile(file.filename)) {
          ignored += 1
          continue
        }
        if (file.data.length > MAX_UPLOAD_BYTES) {
          errors.push(`${file.filename}: file exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`)
          continue
        }
        let dest: string
        try {
          dest = writeUploadExclusive(this.paths.uploadsDir, file.filename, file.data)
        } catch (error) {
          errors.push(`${file.filename}: ${error instanceof Error ? error.message : String(error)}`)
          continue
        }
        saved.push(dest)
      }
      const imported: CatalogEntry[] = []
      for (const filePath of saved) {
        try {
          imported.push(this.importOneUnlocked(filePath))
        } catch (error) {
          errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
          if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { force: true })
          }
        }
      }
      if (imported.length === 0 && ignored > 0 && errors.length === 0) {
        errors.push(WOFF_INSTALL_ERROR)
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return { entries: imported, errors, ignored }
    })
  }

  async openWith(filePath: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const resolved = path.resolve(filePath)
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return this.openFolderUnlocked(resolved)
      }
      const entry = this.importOneUnlocked(resolved)
      await syncWatchers(this.paths)
      if (entry.status === 'installed') {
        emitCatalog(this.paths)
        emitNotice({
          kind: 'info',
          message: `${displayFamily(entry)} is already installed.`,
          entryId: entry.id,
        })
        return entry
      }
      if (entry.status === 'deactivated') {
        const activated = await this.activateEntry(entry.id)
        emitCatalog(this.paths)
        emitNotice({
          kind: 'installed',
          message: `Activated ${displayFamily(activated)}`,
          entryId: activated.id,
        })
        return activated
      }
      if (entry.status === 'outdated') {
        return this.reinstallEntry(entry.id)
      }
      const installed = await this.installEntry(entry.id)
      emitNotice({
        kind: 'installed',
        message: `Installed ${displayFamily(installed)}`,
        entryId: installed.id,
      })
      return installed
    })
  }

  async install(
    id: string,
    familyName?: string,
    options?: { replace?: boolean },
  ): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.installEntry(id, familyName, options)
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entry
    })
  }

  async installMany(
    ids: string[],
    familyName?: string,
    options?: { replace?: boolean },
  ): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const catalog = loadCatalog(this.paths)
      const toInstall = ids
        .map((id) => findById(catalog, id))
        .filter((entry): entry is CatalogEntry => Boolean(entry) && eligibleForInstall(entry))
      assertSingleInstallableFormat(toInstall)
      const entries: CatalogEntry[] = []
      const errors: string[] = []
      for (const entry of toInstall) {
        try {
          entries.push(await this.installEntry(entry.id, familyName, options))
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }
      if (entries.length === 0 && errors.length) {
        throw new Error(errors.join('\n'))
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entries
    })
  }

  async uninstall(id: string, options?: { deleteSource?: boolean }): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.uninstallEntry(id, options)
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entry
    })
  }

  async uninstallMany(ids: string[], options?: { deleteSource?: boolean }): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      for (const id of ids) {
        entries.push(await this.uninstallEntry(id, options))
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entries
    })
  }

  async deactivate(id: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.deactivateEntry(id)
      emitCatalog(this.paths)
      return entry
    })
  }

  async deactivateMany(ids: string[]): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      const errors: string[] = []
      for (const id of ids) {
        const catalog = loadCatalog(this.paths)
        const entry = findById(catalog, id)
        if (!entry || !eligibleForDeactivate(entry)) continue
        try {
          entries.push(await this.deactivateEntry(id))
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }
      emitCatalog(this.paths)
      if (entries.length === 0 && errors.length) {
        throw new Error(errors.join('\n'))
      }
      return entries
    })
  }

  async activate(id: string, options?: { replace?: boolean }): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.activateEntry(id, options)
      emitCatalog(this.paths)
      return entry
    })
  }

  async activateMany(ids: string[], options?: { replace?: boolean }): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const catalog = loadCatalog(this.paths)
      const toActivate = ids
        .map((id) => findById(catalog, id))
        .filter((entry): entry is CatalogEntry => Boolean(entry))
      assertSingleInstallableFormat(toActivate)
      const entries: CatalogEntry[] = []
      for (const id of ids) {
        entries.push(await this.activateEntry(id, options))
      }
      emitCatalog(this.paths)
      return entries
    })
  }

  async reinstall(id: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.reinstallEntry(id)
      emitCatalog(this.paths)
      return entry
    })
  }

  async reinstallMany(ids: string[]): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      const errors: string[] = []
      for (const id of ids) {
        const catalog = loadCatalog(this.paths)
        const entry = findById(catalog, id)
        if (!entry) {
          errors.push('Font is not in the library.')
          continue
        }
        if (!eligibleForReinstall(entry) && entry.status !== 'installed') {
          continue
        }
        try {
          entries.push(await this.reinstallEntry(id))
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }
      await this.clearCachesAfterInstall()
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      if (entries.length === 0 && errors.length) {
        throw new Error(errors.join('\n'))
      }
      const first = entries[0]
      if (first) {
        emitNotice({
          kind: 'reinstalled',
          message: `Reinstalled ${entries.length} ${entries.length === 1 ? 'font' : 'fonts'}`,
          entryId: first.id,
        })
      }
      return entries
    })
  }

  async forget(id: string, options: { deleteFiles?: boolean } = {}): Promise<void> {
    return runCatalogTask(async () => {
      await this.forgetEntry(id, options)
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
    })
  }

  async forgetMany(
    ids: string[],
    options: { deleteFiles?: boolean } = {},
  ): Promise<{ removed: number }> {
    return runCatalogTask(async () => {
      for (const id of ids) {
        await this.forgetEntry(id, options)
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return { removed: ids.length }
    })
  }

  async clearUserFontCache(): Promise<{ mac: boolean; cleared: boolean }> {
    const result = await getFontNative().clearUserFontCache()
    emitNotice({
      kind: 'info',
      message: result.mac
        ? 'Removed the user font cache.'
        : 'Font cache clearing is available on macOS.',
    })
    return result
  }

  async clearOfficeFontCache(): Promise<{ mac: boolean; cleared: boolean }> {
    if (!loadSettings(this.paths).clearOfficeFontCache) {
      throw new Error('Microsoft Office cache clearing is turned off in Settings.')
    }
    const result = await getFontNative().clearOfficeFontCache()
    emitNotice({
      kind: 'info',
      message: result.mac
        ? result.cleared
          ? 'Removed the Microsoft Office font cache.'
          : 'No Microsoft Office font cache was found.'
        : 'Microsoft Office cache clearing is available on macOS.',
    })
    return result
  }

  async clearAdobeFontCache(): Promise<{ mac: boolean; cleared: boolean }> {
    if (!loadSettings(this.paths).clearAdobeFontCache) {
      throw new Error('Adobe font cache clearing is turned off in Settings.')
    }
    const result = await getFontNative().clearAdobeFontCache()
    emitNotice({
      kind: 'info',
      message: result.mac
        ? result.cleared
          ? 'Removed Adobe font caches. Relaunch open Adobe apps to see updated fonts.'
          : 'No Adobe font cache was found.'
        : 'Adobe font cache clearing is available on macOS.',
    })
    return result
  }

  async forgetMissingSources(): Promise<{ removed: number }> {
    return runCatalogTask(async () => {
      const catalog = loadCatalog(this.paths)
      const ids = catalog.entries
        .filter(
          (entry) =>
            entry.status === 'source-missing' &&
            !entry.installedPath &&
            !entry.disabledPath,
        )
        .map((entry) => entry.id)
      for (const id of ids) {
        await this.forgetEntry(id)
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return { removed: ids.length }
    })
  }

  async uninstallSystem(filePath: string): Promise<void> {
    return runCatalogTask(async () => {
      const resolved = path.resolve(filePath)
      if (!allowedFontPath(resolved, this.paths)) {
        throw new Error('That font is outside the font folders Font Buttler can manage.')
      }
      const catalog = loadCatalog(this.paths)
      const managed = catalog.entries.find(
        (entry) =>
          entry.installedPath && path.resolve(entry.installedPath) === resolved,
      )
      if (managed) {
        await this.uninstallEntry(managed.id)
        emitCatalog(this.paths)
        return
      }
      if (!fs.existsSync(resolved)) {
        throw new Error('Font file is already gone.')
      }
      if (isProtectedSystem(resolved, this.paths)) {
        throw new Error('Protected system fonts cannot be removed.')
      }
      try {
        fs.accessSync(resolved, fs.constants.W_OK)
      } catch {
        throw new Error('Protected system fonts cannot be removed.')
      }
      await getFontNative().unregisterFont(resolved)
      fs.rmSync(resolved, { force: true })
      emitEvent({ type: 'system', faces: scanSystemFonts(this.paths) })
    })
  }

  async deactivateSystem(filePath: string): Promise<void> {
    return runCatalogTask(async () => {
      const resolved = path.resolve(filePath)
      if (!allowedFontPath(resolved, this.paths)) {
        throw new Error('That font is outside the font folders Font Buttler can manage.')
      }
      const catalog = loadCatalog(this.paths)
      const managed = catalog.entries.find(
        (entry) =>
          entry.installedPath && path.resolve(entry.installedPath) === resolved,
      )
      if (managed) {
        await this.deactivateEntry(managed.id)
        emitCatalog(this.paths)
        return
      }
      if (!fs.existsSync(resolved)) {
        throw new Error('Font file is already gone.')
      }
      if (isProtectedSystem(resolved, this.paths)) {
        throw new Error('Protected system fonts cannot be deactivated.')
      }
      try {
        fs.accessSync(resolved, fs.constants.W_OK)
      } catch {
        throw new Error('Protected system fonts cannot be deactivated.')
      }
      await getFontNative().unregisterFont(resolved)
      fs.mkdirSync(this.paths.disabledDir, { recursive: true })
      const dest = uniquePathFromOriginal(this.paths.disabledDir, resolved)
      fs.renameSync(resolved, dest)
      let parsed
      try {
        parsed = parseFontFile(dest)
      } catch {
        fs.renameSync(dest, resolved)
        throw new Error('Could not read that computer font after deactivating it.')
      }
      const stat = readFileStat(dest)
      const entry: CatalogEntry = {
        id: newId(),
        sourcePath: resolved,
        sourceMtimeMs: stat.mtimeMs,
        sourceSize: stat.size,
        sourcePresent: false,
        status: 'deactivated',
        disabledPath: dest,
        faces: parsed.faces,
        format: parsed.format,
        addedAt: now(),
        updatedAt: now(),
      }
      const next = loadCatalog(this.paths)
      upsertEntry(next, entry)
      saveCatalog(this.paths, next)
      emitCatalog(this.paths)
      emitEvent({ type: 'system', faces: scanSystemFonts(this.paths) })
    })
  }

  async reveal(id: string, which: 'source' | 'installed'): Promise<string> {
    const entry = findById(loadCatalog(this.paths), id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    const target =
      which === 'installed'
        ? entry.installedPath || entry.disabledPath
        : entry.sourcePath
    if (!target) {
      throw new Error('There is no file to show.')
    }
    await revealInFileManager(target)
    return target
  }

  async revealPath(filePath: string): Promise<string> {
    const resolved = path.resolve(filePath)
    const watchFolders = loadSettings(this.paths).watchFolders
    if (
      !allowedFontPath(resolved, this.paths) &&
      !isUnderAnyRoot(resolved, watchFolders)
    ) {
      throw new Error('That path is outside the font folders Font Buttler can reveal.')
    }
    if (!fs.existsSync(resolved)) {
      throw new Error('That file is no longer on disk.')
    }
    await revealInFileManager(resolved)
    return resolved
  }

  fontBytesForEntry(id: string): { buffer: Buffer; mime: string; filename: string } {
    const entry = findById(loadCatalog(this.paths), id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    const filePath = [entry.installedPath, entry.disabledPath, entry.sourcePath].find(
      (candidate) => candidate && fs.existsSync(candidate),
    )
    if (!filePath) {
      throw new Error('No font file is available to preview.')
    }
    return {
      buffer: fs.readFileSync(filePath),
      mime: mimeForFont(filePath),
      filename: path.basename(filePath),
    }
  }

  fontBytesForPath(filePath: string): { buffer: Buffer; mime: string; filename: string } {
    const resolved = path.resolve(filePath)
    if (!allowedFontPath(resolved, this.paths)) {
      throw new Error('That font path is not readable.')
    }
    if (!fs.existsSync(resolved)) {
      throw new Error('Font file is missing.')
    }
    return {
      buffer: fs.readFileSync(resolved),
      mime: mimeForFont(resolved),
      filename: path.basename(resolved),
    }
  }

  namePreview(id: string, familyName: string): { fullName: string; postscriptName: string } {
    const entry = findById(loadCatalog(this.paths), id)
    const style = entry?.faces[0]?.styleName || 'Regular'
    return {
      fullName: `${familyName} ${style}`.trim(),
      postscriptName: postscriptPreview(familyName, style),
    }
  }

  private async resolveFormatConflicts(
    entry: CatalogEntry,
    catalog: CatalogEntry[],
    replace?: boolean,
  ): Promise<CatalogEntry[]> {
    const conflicts = installedFormatConflicts(entry, catalog)
    if (conflicts.length === 0) return []
    if (!replace) {
      throw new Error(formatConflictMessage(entry, conflicts[0]))
    }
    return conflicts
  }

  private async snapshotAndRemoveConflicts(conflicts: CatalogEntry[]): Promise<
    Array<{ entry: CatalogEntry; file: string }>
  > {
    const snapshots: Array<{ entry: CatalogEntry; file: string }> = []
    const rollbackDir = path.join(this.paths.dataRoot, 'rollback')
    fs.mkdirSync(rollbackDir, { recursive: true })
    for (const other of conflicts) {
      const current = findById(loadCatalog(this.paths), other.id)
      if (!current) continue
      const installed = current.installedPath
      if (installed && fs.existsSync(installed)) {
        const snapshot = path.join(rollbackDir, `${crypto.randomUUID()}${path.extname(installed) || '.ttf'}`)
        fs.copyFileSync(installed, snapshot)
        snapshots.push({ entry: { ...current }, file: snapshot })
      }
      await this.uninstallEntry(current.id)
    }
    return snapshots
  }

  private async restoreConflictSnapshots(
    snapshots: Array<{ entry: CatalogEntry; file: string }>,
  ): Promise<void> {
    for (const snapshot of snapshots) {
      if (!fs.existsSync(snapshot.file)) continue
      const dest = snapshot.entry.installedPath
      if (dest) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(snapshot.file, dest)
        try {
          await getFontNative().registerFont(dest)
          await getFontNative().setFontEnabled(dest, true)
        } catch {
          // Restoring the previous format is best-effort.
        }
      }
      const catalog = loadCatalog(this.paths)
      upsertEntry(catalog, snapshot.entry)
      saveCatalog(this.paths, catalog)
      fs.rmSync(snapshot.file, { force: true })
    }
  }

  private async installEntry(
    id: string,
    familyName?: string,
    options?: { replace?: boolean },
  ): Promise<CatalogEntry> {
    let catalog = loadCatalog(this.paths)
    let entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    const renameTo = familyName?.trim()
    const installAs = Boolean(renameTo && renameTo !== displayFamily(entry))
    if (installAs && renameTo) {
      return this.installRenamedCopy(entry, renameTo, options)
    }
    if (!sourceFileExists(entry.sourcePath)) {
      applySourcePresence(entry)
      saveCatalog(this.paths, catalog)
      throw new Error('The source file is missing.')
    }
    const staged = stageFontFile(entry.sourcePath, path.join(this.paths.dataRoot, 'staging'))
    let conflictSnapshots: Array<{ entry: CatalogEntry; file: string }> = []
    try {
      entry.format = staged.parsed.format
      entry.faces = staged.parsed.faces
      const conflicts = await this.resolveFormatConflicts(entry, catalog.entries, options?.replace)
      catalog = loadCatalog(this.paths)
      entry = findById(catalog, id)
      if (!entry) {
        throw new Error('Font is not in the library.')
      }
      if (
        entry.status === 'installed' &&
        entry.installedPath &&
        fs.existsSync(entry.installedPath) &&
        conflicts.length === 0
      ) {
        const current = readFileStat(entry.sourcePath)
        if (
          current.mtimeMs === entry.installedSnapshotMtimeMs &&
          current.size === entry.installedSnapshotSize
        ) {
          entry.sourcePresent = isExternalSource(entry)
          return entry
        }
      }
      if (conflicts.length) {
        conflictSnapshots = await this.snapshotAndRemoveConflicts(conflicts)
        catalog = loadCatalog(this.paths)
        entry = findById(catalog, id)
        if (!entry) {
          throw new Error('Font is not in the library.')
        }
      }
      const dest = destinationForInstall(this.paths, entry, entry.sourcePath)
      const previousInstalled =
        entry.installedPath && path.resolve(entry.installedPath) !== dest
          ? entry.installedPath
          : undefined
      await commitInstalledFile({
        dest,
        stagedPath: staged.stagedPath,
        rollbackDir: path.join(this.paths.dataRoot, 'rollback'),
        native: getFontNative(),
      })
      if (previousInstalled && fs.existsSync(previousInstalled)) {
        await getFontNative().unregisterFont(previousInstalled)
        fs.rmSync(previousInstalled, { force: true })
      }
      catalog = loadCatalog(this.paths)
      entry = findById(catalog, id)
      if (!entry) {
        throw new Error('Font is not in the library.')
      }
      if (!sourceFileExists(entry.sourcePath)) {
        entry.sourcePath = dest
      }
      applyInstalledMetadata(entry, dest, staged, {
        externalSource: isExternalSource(entry),
      })
      touchEntry(entry)
      saveCatalog(this.paths, catalog)
      return entry
    } catch (error) {
      await this.restoreConflictSnapshots(conflictSnapshots)
      throw error
    } finally {
      removeStagedFile(staged.stagedPath)
      for (const snapshot of conflictSnapshots) {
        if (fs.existsSync(snapshot.file)) {
          fs.rmSync(snapshot.file, { force: true })
        }
      }
    }
  }

  private async installRenamedCopy(
    sourceEntry: CatalogEntry,
    familyName: string,
    options?: { replace?: boolean },
  ): Promise<CatalogEntry> {
    const temp = await renameFamilyCopy(sourceEntry.sourcePath, familyName)
    try {
      const parsed = parseFontFile(temp)
      const catalog = loadCatalog(this.paths)
      const draft: CatalogEntry = {
        id: newId(),
        sourcePath: temp,
        sourceMtimeMs: 0,
        sourceSize: 0,
        sourcePresent: false,
        status: 'uninstalled',
        faces: parsed.faces,
        format: parsed.format,
        addedAt: now(),
        updatedAt: now(),
      }
      const conflicts = await this.resolveFormatConflicts(draft, catalog.entries, options?.replace)
      const conflictSnapshots = conflicts.length ? await this.snapshotAndRemoveConflicts(conflicts) : []
      try {
        const dest = destinationForInstall(this.paths, draft, temp, { reuseInstalled: false })
        await commitInstalledFile({
          dest,
          stagedPath: temp,
          rollbackDir: path.join(this.paths.dataRoot, 'rollback'),
          native: getFontNative(),
        })
        bindEntryToInstalledFile(draft, dest)
        draft.faces = parsed.faces
        draft.format = parsed.format
        const next = loadCatalog(this.paths)
        upsertEntry(next, draft)
        saveCatalog(this.paths, next)
        return draft
      } catch (error) {
        await this.restoreConflictSnapshots(conflictSnapshots)
        throw error
      } finally {
        for (const snapshot of conflictSnapshots) {
          if (fs.existsSync(snapshot.file)) {
            fs.rmSync(snapshot.file, { force: true })
          }
        }
      }
    } finally {
      if (fs.existsSync(temp)) {
        fs.rmSync(temp, { force: true })
      }
    }
  }

  private detachRenamedInstallSources(): void {
    const catalog = loadCatalog(this.paths)
    const originals: string[] = []
    let changed = false
    for (const entry of catalog.entries) {
      if (!entry.customFamilyName) continue
      if (!entry.installedPath || !fs.existsSync(entry.installedPath)) {
        if (sourceFileExists(entry.sourcePath)) {
          try {
            const parsed = parseFontFile(entry.sourcePath)
            entry.faces = parsed.faces
            entry.format = parsed.format
          } catch {
            // Keep stored names if the original file cannot be parsed.
          }
        }
        delete entry.customFamilyName
        touchEntry(entry)
        changed = true
        continue
      }
      const original = entry.sourcePath
      const installed = path.resolve(entry.installedPath)
      if (isExternalSource(entry) && sourceFileExists(original) && path.resolve(original) !== installed) {
        originals.push(original)
      }
      bindEntryToInstalledFile(entry, installed)
      delete entry.customFamilyName
      touchEntry(entry)
      changed = true
    }
    if (changed) {
      saveCatalog(this.paths, catalog)
    }
    for (const original of originals) {
      this.importOneUnlocked(original)
    }
  }

  private async uninstallEntry(
    id: string,
    options?: { deleteSource?: boolean },
  ): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    const sourcePath = entry.sourcePath
    const hasSource = isExternalSource(entry) && sourceFileExists(sourcePath)
    const deleteSource = Boolean(options?.deleteSource && hasSource)
    await removeInstalledCopy(entry)
    if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
      fs.rmSync(entry.disabledPath, { force: true })
    }
    entry.disabledPath = undefined
    entry.installedPath = undefined
    if (deleteSource) {
      await deleteSourceFile(sourcePath, this.paths)
      removeEntryById(catalog, id)
      saveCatalog(this.paths, catalog)
      entry.sourcePresent = false
      entry.status = 'uninstalled'
      return entry
    }
    if (hasSource) {
      entry.sourcePresent = true
      entry.status = 'uninstalled'
      touchEntry(entry)
      saveCatalog(this.paths, catalog)
      return entry
    }
    removeEntryById(catalog, id)
    saveCatalog(this.paths, catalog)
    entry.sourcePresent = false
    entry.status = 'uninstalled'
    return entry
  }

  private async deactivateEntry(id: string): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (!entry.installedPath || !fs.existsSync(entry.installedPath)) {
      throw new Error('This font is not installed.')
    }
    const installedPath = entry.installedPath
    const result = await getFontNative().setFontEnabled(installedPath, false)
    if (!result.ok) {
      throw new Error(result.error || 'Could not deactivate the font.')
    }
    const latest = loadCatalog(this.paths)
    const current = findById(latest, id)
    if (!current) {
      throw new Error('Font is not in the library.')
    }
    current.disabledPath = undefined
    current.status = 'deactivated'
    touchEntry(current)
    saveCatalog(this.paths, latest)
    return current
  }

  private async activateEntry(id: string, options?: { replace?: boolean }): Promise<CatalogEntry> {
    let catalog = loadCatalog(this.paths)
    let entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    const conflicts = await this.resolveFormatConflicts(entry, catalog.entries, options?.replace)
    const conflictSnapshots = conflicts.length ? await this.snapshotAndRemoveConflicts(conflicts) : []
    catalog = loadCatalog(this.paths)
    entry = findById(catalog, id)
    if (!entry) {
      await this.restoreConflictSnapshots(conflictSnapshots)
      throw new Error('Font is not in the library.')
    }
    try {
      if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
        const restoreToComputer =
          isComputerOrigin(entry.sourcePath, this.paths) &&
          !fs.existsSync(entry.sourcePath)
        let dest = restoreToComputer
          ? path.resolve(entry.sourcePath)
          : destinationForInstall(this.paths, entry, entry.disabledPath)
        if (restoreToComputer && fs.existsSync(dest) && !sameFile(dest, entry.disabledPath)) {
          dest = uniqueSiblingPath(dest)
        }
        if (path.resolve(entry.disabledPath) !== dest) {
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.renameSync(entry.disabledPath, dest)
        }
        await getFontNative().registerFont(dest)
        const enabled = await getFontNative().setFontEnabled(dest, true)
        if (!enabled.ok) {
          if (restoreToComputer && dest !== entry.disabledPath && fs.existsSync(dest)) {
            fs.renameSync(dest, entry.disabledPath)
          }
          throw new Error(enabled.error || 'Could not activate the font.')
        }
        catalog = loadCatalog(this.paths)
        entry = findById(catalog, id)
        if (!entry) {
          throw new Error('Font is not in the library.')
        }
        entry.installedPath = dest
        entry.disabledPath = undefined
        if (restoreToComputer) {
          entry.sourcePath = dest
        }
        entry.status = 'installed'
        entry.sourcePresent = isExternalSource(entry)
        touchEntry(entry)
        saveCatalog(this.paths, catalog)
        return entry
      }
      if (entry.installedPath && fs.existsSync(entry.installedPath)) {
        const enabled = await getFontNative().setFontEnabled(entry.installedPath, true)
        if (!enabled.ok) {
          throw new Error(enabled.error || 'Could not activate the font.')
        }
        catalog = loadCatalog(this.paths)
        entry = findById(catalog, id)
        if (!entry) {
          throw new Error('Font is not in the library.')
        }
        entry.status = 'installed'
        touchEntry(entry)
        saveCatalog(this.paths, catalog)
        return entry
      }
      return this.installEntry(id, undefined, options)
    } catch (error) {
      await this.restoreConflictSnapshots(conflictSnapshots)
      throw error
    } finally {
      for (const snapshot of conflictSnapshots) {
        if (fs.existsSync(snapshot.file)) {
          fs.rmSync(snapshot.file, { force: true })
        }
      }
    }
  }

  private async reinstallEntry(id: string): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (entry.status === 'deactivated' && entry.installedPath && fs.existsSync(entry.installedPath)) {
      return this.activateEntry(id)
    }
    await this.clearCachesAfterInstall()
    const updated = await this.installEntry(id, entry.customFamilyName)
    emitNotice({
      kind: 'reinstalled',
      message: `Reinstalled ${displayFamily(updated)}`,
      entryId: updated.id,
    })
    return updated
  }

  private async forgetEntry(
    id: string,
    options: { deleteFiles?: boolean } = {},
  ): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (entry.status !== 'source-missing' && entry.status !== 'uninstalled') {
      throw new Error('Only uninstalled fonts can be removed from the list.')
    }
    if (
      (entry.installedPath && fs.existsSync(entry.installedPath)) ||
      (entry.disabledPath && fs.existsSync(entry.disabledPath))
    ) {
      throw new Error('Only uninstalled fonts can be removed from the list.')
    }
    if (options.deleteFiles && entry.status === 'uninstalled') {
      await deleteSourceFile(entry.sourcePath, this.paths)
    }
    await removeInstalledCopy(entry)
    if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
      fs.rmSync(entry.disabledPath, { force: true })
    }
    entry.disabledPath = undefined
    removeEntryById(catalog, id)
    saveCatalog(this.paths, catalog)
    return entry
  }

  private async openFolderUnlocked(folderPath: string): Promise<CatalogEntry> {
    const expanded = expandImportPaths([folderPath])
    const errors = [...expanded.errors]
    const imported: CatalogEntry[] = []
    for (const filePath of expanded.files) {
      try {
        imported.push(this.importOneUnlocked(filePath))
      } catch (error) {
        errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (imported.length === 0) {
      if (expanded.skippedWeb > 0 && errors.length === 0) {
        throw new Error(WOFF_INSTALL_ERROR)
      }
      throw new Error(errors[0] ?? 'No font files in that folder.')
    }
    const pending = imported.filter(
      (entry) => entry.status !== 'installed' && entry.status !== 'source-missing',
    )
    for (const entry of pending) {
      if (entry.status === 'deactivated') {
        await this.activateEntry(entry.id)
        continue
      }
      if (entry.status === 'outdated') {
        await this.clearCachesAfterInstall()
      }
      await this.installEntry(entry.id, entry.customFamilyName)
    }
    await syncWatchers(this.paths)
    emitCatalog(this.paths)
    const first = imported[0]
    if (pending.length === 0) {
      emitNotice({
        kind: 'info',
        message:
          imported.length === 1
            ? `${displayFamily(first)} is already installed.`
            : `${imported.length} fonts are already installed.`,
        entryId: first.id,
      })
    } else {
      emitNotice({
        kind: 'installed',
        message:
          expanded.skippedWeb > 0
            ? `${imported.length} ${imported.length === 1 ? 'font' : 'fonts'} installed and ${expanded.skippedWeb} ${
                expanded.skippedWeb === 1 ? 'font' : 'fonts'
              } ignored`
            : imported.length === 1
              ? `Installed ${displayFamily(first)}`
              : `Installed ${imported.length} fonts from folder`,
        entryId: first.id,
      })
    }
    if (errors.length) {
      emitNotice({
        kind: 'error',
        message: errors.join('\n'),
      })
    }
    return first
  }

  private importOneUnlocked(filePath: string): CatalogEntry {
    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error('Not a file.')
    }
    assertNotWebFont(resolved)
    if (!isFontFile(resolved)) {
      throw new Error('Not a font file.')
    }
    const parsed = parseFontFile(resolved)
    if (parsed.faces.length === 0) {
      throw new Error('Could not read any faces in that font.')
    }
    const catalog = loadCatalog(this.paths)
    const existing =
      findByInstalledPath(catalog, resolved) ??
      findBySourcePath(catalog, resolved) ??
      findByFaceIdentity(catalog, parsed.faces, parsed.format)
    const stat = readFileStat(resolved)
    const inUserFonts = isUnderAnyRoot(resolved, [this.paths.userFontsDir, this.paths.installDir])
    if (existing) {
      if (!inUserFonts) {
        this.rebindSourcePath(existing, resolved)
      } else if (!existing.installedPath) {
        existing.installedPath = resolved
        existing.status = 'installed'
      }
      existing.faces = parsed.faces
      existing.format = parsed.format
      if (!inUserFonts || isExternalSource(existing)) {
        existing.sourceMtimeMs = stat.mtimeMs
        existing.sourceSize = stat.size
      }
      existing.sourcePresent = isExternalSource(existing) && sourceFileExists(existing.sourcePath)
      if (existing.status === 'source-missing') {
        existing.status = resolveStatusWhenSourceFound(existing)
      }
      if (
        existing.status === 'installed' &&
        isExternalSource(existing) &&
        (stat.mtimeMs !== existing.installedSnapshotMtimeMs ||
          stat.size !== existing.installedSnapshotSize)
      ) {
        existing.status = 'outdated'
      }
      touchEntry(existing)
      saveCatalog(this.paths, catalog)
      return existing
    }
    const entry: CatalogEntry = {
      id: newId(),
      sourcePath: resolved,
      sourceMtimeMs: stat.mtimeMs,
      sourceSize: stat.size,
      sourcePresent: !inUserFonts,
      status: inUserFonts ? 'installed' : 'uninstalled',
      installedPath: inUserFonts ? resolved : undefined,
      faces: parsed.faces,
      format: parsed.format,
      addedAt: now(),
      updatedAt: now(),
    }
    upsertEntry(catalog, entry)
    saveCatalog(this.paths, catalog)
    return entry
  }

  private rebindSourcePath(entry: CatalogEntry, nextPath: string): void {
    const previous = entry.sourcePath
    if (previous === nextPath) {
      return
    }
    entry.sourcePath = nextPath
    if (!previous || previous === nextPath) {
      return
    }
    const uploadsRoot = path.resolve(this.paths.uploadsDir)
    const resolvedPrevious = path.resolve(previous)
    if (resolvedPrevious === nextPath || !resolvedPrevious.startsWith(`${uploadsRoot}${path.sep}`)) {
      return
    }
    if (fs.existsSync(resolvedPrevious)) {
      fs.rmSync(resolvedPrevious, { force: true })
    }
  }

  private async refreshSourceStatuses(): Promise<void> {
    return runCatalogTask(() => this.refreshSourceStatusesUnlocked())
  }

  private refreshSourceStatusesUnlocked(): void {
    const catalog = loadCatalog(this.paths)
    let changed = false
    for (const entry of catalog.entries) {
      if (applySourcePresence(entry)) {
        touchEntry(entry)
        changed = true
      }
      if (!entry.sourcePresent || !isExternalSource(entry)) {
        continue
      }
      const stat = readFileStat(entry.sourcePath)
      entry.sourceMtimeMs = stat.mtimeMs
      entry.sourceSize = stat.size
      try {
        const parsed = parseFontFile(entry.sourcePath)
        if (JSON.stringify(entry.faces) !== JSON.stringify(parsed.faces)) {
          entry.faces = parsed.faces
          entry.format = parsed.format
          changed = true
        }
      } catch {
        // Keep stored names if the file can no longer be parsed.
      }
      if (
        entry.status === 'installed' &&
        (stat.mtimeMs !== entry.installedSnapshotMtimeMs ||
          stat.size !== entry.installedSnapshotSize)
      ) {
        entry.status = 'outdated'
        touchEntry(entry)
        changed = true
      }
    }
    if (changed) {
      saveCatalog(this.paths, catalog)
    }
  }

  private queueAutoReinstall(id: string): void {
    if (!loadSettings(this.paths).autoReinstallOnUpdate) {
      return
    }
    this.autoReinstallPending.add(id)
    if (this.autoReinstallTimer) {
      clearTimeout(this.autoReinstallTimer)
    }
    this.autoReinstallTimer = setTimeout(() => {
      this.autoReinstallTimer = null
      const ids = [...this.autoReinstallPending]
      this.autoReinstallPending.clear()
      void this.reinstallOutdatedIds(ids)
    }, 400)
  }

  private async reinstallCurrentlyOutdated(): Promise<void> {
    if (!loadSettings(this.paths).autoReinstallOnUpdate) {
      return
    }
    const ids = loadCatalog(this.paths)
      .entries.filter((entry) => entry.status === 'outdated')
      .map((entry) => entry.id)
    await this.reinstallOutdatedIds(ids)
  }

  private async reinstallOutdatedIds(ids: string[]): Promise<void> {
    const current = ids.filter((id) => findById(loadCatalog(this.paths), id)?.status === 'outdated')
    if (current.length === 0) {
      return
    }
    try {
      if (current.length === 1) {
        await this.reinstall(current[0]!)
      } else {
        await this.reinstallMany(current)
      }
    } catch (error) {
      emitNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not reinstall updated fonts.',
      })
    }
  }

  private async clearCachesAfterInstall(): Promise<void> {
    try {
      const settings = loadSettings(this.paths)
      if (settings.skipCacheClearOnReinstall) {
        return
      }
      await getFontNative().clearFontCaches({
        office: settings.clearOfficeFontCache,
        adobe: settings.clearAdobeFontCache,
      })
    } catch {
      // Cache clearing is best-effort; a locked cache should not fail the install.
    }
  }

  private resolveWatchFolders(folders: string[]): string[] {
    const resolved: string[] = []
    const seen = new Set<string>()
    for (const folder of folders) {
      if (typeof folder !== 'string' || !folder.trim()) continue
      const next = path.resolve(folder.trim())
      if (seen.has(next)) continue
      if (!fs.existsSync(next) || !fs.statSync(next).isDirectory()) {
        throw new Error(`${folder} does not exist.`)
      }
      if (isUnderAnyRoot(next, [this.paths.userFontsDir]) || next === path.resolve(this.paths.userFontsDir)) {
        throw new Error('The user fonts folder is already shown on the Fonts tab.')
      }
      seen.add(next)
      resolved.push(next)
    }
    return resolved
  }

  private async refreshInboxWatcher(
    folders: string[],
    options: { importExisting: boolean },
  ): Promise<void> {
    await syncInboxWatcher(folders, (filePaths) => {
      void this.importInboxFiles(filePaths)
    })
    if (options.importExisting && folders.length) {
      const known = new Set(
        this.listCatalog().map((entry) => path.resolve(entry.sourcePath)),
      )
      const discovered = [
        ...new Set(folders.flatMap((folder) => listInboxFontFiles(folder))),
      ].filter((filePath) => !known.has(filePath))
      if (discovered.length) {
        await this.importInboxFiles(discovered)
      }
    }
  }

  private async importInboxFiles(filePaths: string[]): Promise<void> {
    const beforeIds = new Set(this.listCatalog().map((entry) => entry.id))
    const result = await this.importPaths(filePaths)
    const added = result.entries.filter((entry) => !beforeIds.has(entry.id))
    const installed: CatalogEntry[] = []
    if (loadSettings(this.paths).installWatchFolderFonts) {
      for (const entry of added) {
        if (entry.status === 'installed' || entry.status === 'source-missing') continue
        try {
          installed.push(await this.install(entry.id))
        } catch (error) {
          emitNotice({
            kind: 'error',
            message:
              error instanceof Error
                ? error.message
                : `Could not install ${displayFamily(entry)}`,
            entryId: entry.id,
          })
        }
      }
    }
    const first = installed[0] ?? added[0]
    if (first) {
      const count = installed.length > 0 ? installed.length : added.length
      const didInstall = installed.length > 0
      emitNotice({
        kind: didInstall ? 'installed' : 'info',
        message:
          count === 1
            ? `${didInstall ? 'Installed' : 'Added'} ${displayFamily(first)} from a watch folder`
            : `${didInstall ? 'Installed' : 'Added'} ${count} fonts from a watch folder`,
        entryId: first.id,
      })
    }
    if (result.errors.length) {
      emitNotice({
        kind: 'error',
        message: result.errors.join('\n'),
      })
    }
  }

  private async restoreDisabledCopies(): Promise<void> {
    const catalog = loadCatalog(this.paths)
    let changed = false
    for (const entry of catalog.entries) {
      if (!entry.disabledPath || !fs.existsSync(entry.disabledPath)) {
        continue
      }
      if (isComputerOrigin(entry.sourcePath, this.paths)) {
        if (entry.status !== 'deactivated' || entry.sourcePresent !== false) {
          entry.status = 'deactivated'
          entry.sourcePresent = false
          changed = true
        }
        continue
      }
      const dest = destinationForInstall(this.paths, entry, entry.disabledPath, {
        reuseInstalled: false,
      })
      if (path.resolve(entry.disabledPath) !== dest) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.renameSync(entry.disabledPath, dest)
      }
      await getFontNative().registerFont(dest)
      await getFontNative().setFontEnabled(dest, false)
      entry.installedPath = dest
      entry.disabledPath = undefined
      entry.status = 'deactivated'
      entry.sourcePresent = isExternalSource(entry)
      touchEntry(entry)
      changed = true
    }
    if (changed) {
      saveCatalog(this.paths, catalog)
    }
  }

  private async adoptUserFonts(): Promise<void> {
    const files = listFontFilesInTree(this.paths.userFontsDir)
    const catalog = loadCatalog(this.paths)
    const enabled = await getFontNative().fontActivationStates(files)
    let changed = false

    for (const filePath of files) {
      const resolved = path.resolve(filePath)
      const existing =
        findByInstalledPath(catalog, resolved) ??
        findBySourcePath(catalog, resolved) ??
        (() => {
          try {
            const parsed = parseFontFile(resolved)
            return findByFaceIdentity(catalog, parsed.faces, parsed.format)
          } catch {
            return undefined
          }
        })()
      const isOn = enabled[resolved] ?? enabled[filePath] ?? true
      if (existing) {
        if (!existing.installedPath || !fs.existsSync(existing.installedPath)) {
          existing.installedPath = resolved
          existing.disabledPath = undefined
          existing.status = isOn ? 'installed' : 'deactivated'
          existing.sourcePresent = isExternalSource(existing)
          touchEntry(existing)
          changed = true
        } else if (path.resolve(existing.installedPath) === resolved) {
          if (isOn && existing.status === 'deactivated') {
            existing.status = 'installed'
            touchEntry(existing)
            changed = true
          } else if (!isOn && (existing.status === 'installed' || existing.status === 'outdated')) {
            existing.status = 'deactivated'
            touchEntry(existing)
            changed = true
          }
        }
        continue
      }
      try {
        const parsed = parseFontFile(resolved)
        if (parsed.faces.length === 0) {
          continue
        }
        const stat = readFileStat(resolved)
        upsertEntry(catalog, {
          id: newId(),
          sourcePath: resolved,
          sourceMtimeMs: stat.mtimeMs,
          sourceSize: stat.size,
          sourcePresent: false,
          status: isOn ? 'installed' : 'deactivated',
          installedPath: resolved,
          faces: parsed.faces,
          format: parsed.format,
          addedAt: now(),
          updatedAt: now(),
        })
        changed = true
      } catch {
        // Skip unreadable or corrupt user fonts.
      }
    }

    for (const entry of [...catalog.entries]) {
      if (
        !entry.installedPath ||
        !isUnderAnyRoot(entry.installedPath, [this.paths.userFontsDir]) ||
        fs.existsSync(entry.installedPath)
      ) {
        continue
      }
      if (isExternalSource(entry) && sourceFileExists(entry.sourcePath)) {
        entry.installedPath = undefined
        entry.sourcePresent = true
        entry.status = 'uninstalled'
        touchEntry(entry)
      } else {
        removeEntryById(catalog, entry.id)
      }
      changed = true
    }

    if (changed) {
      saveCatalog(this.paths, catalog)
    }
  }

  private async refreshUserFontsWatcher(): Promise<void> {
    await syncUserFontsWatcher(this.paths.userFontsDir, () => {
      void runCatalogTask(async () => {
        await this.adoptUserFonts()
        await syncWatchers(this.paths)
        emitCatalog(this.paths)
      })
    })
  }

  private async seedIfEmpty(): Promise<void> {
    if (isMac() && process.env.FONT_BUTLER_DEMO !== '1' && process.env.FONTCASE_DEMO !== '1') {
      return
    }
    const catalog = loadCatalog(this.paths)
    if (catalog.entries.length > 0) {
      return
    }
    const seedDir = this.paths.seedDir
    if (!fs.existsSync(seedDir)) {
      return
    }
    const files = fs
      .readdirSync(seedDir)
      .map((name) => path.join(seedDir, name))
      .filter((filePath) => fs.statSync(filePath).isFile() && isFontFile(filePath))
    if (files.length === 0) {
      return
    }
    const imported = await this.importPaths(files)
    const variable = imported.entries.find((entry) =>
      entry.faces.some((face) => face.isVariable),
    )
    const installTarget = variable ?? imported.entries[0]
    if (installTarget) {
      await this.install(installTarget.id)
    }
    const leftover = imported.entries.find((entry) => entry.id !== installTarget?.id)
    if (leftover) {
      const latest = loadCatalog(this.paths)
      const row = findById(latest, leftover.id)
      if (row) {
        row.status = 'uninstalled'
        saveCatalog(this.paths, latest)
      }
    }
    const outdatedDemo = loadCatalog(this.paths).entries.find(
      (entry) => entry.status === 'installed',
    )
    if (
      outdatedDemo &&
      (process.platform !== 'darwin' || process.env.FONT_BUTLER_DEMO === '1' || process.env.FONTCASE_DEMO === '1')
    ) {
      const latest = loadCatalog(this.paths)
      const row = findById(latest, outdatedDemo.id)
      if (row) {
        row.installedSnapshotMtimeMs = (row.sourceMtimeMs ?? 1) - 1
        row.status = 'outdated'
        saveCatalog(this.paths, latest)
      }
    }
  }
}

function isProtectedSystem(filePath: string, paths: AppPaths): boolean {
  return isUnderAnyRoot(filePath, [paths.systemFontsDir, '/usr/share/fonts'])
}

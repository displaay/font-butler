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
import {
  clearFontCaches,
  clearOfficeFontCache as removeOfficeFontCache,
  clearUserFontCache as removeUserFontCache,
  locateOfficeFontCache,
  fontActivationStates,
  registerFont,
  setFontEnabled,
  unregisterFont,
} from './caches.ts'
import { MAX_UPLOAD_BYTES } from './constants.ts'
import { emitEvent } from './events.ts'
import { assertNotWebFont, isWebFontFile, WOFF_INSTALL_ERROR } from './formats.ts'
import { isFontFile, mimeForFont, parseFontFile, readFileStat } from './parse.ts'
import { isUnderAnyRoot } from './containment.ts'
import { ensureDirs, getPaths, isMac, type AppPaths } from './paths.ts'
import { postscriptPreview, renameFamilyCopy } from './rename.ts'
import { moveToTrash, revealInFileManager } from './reveal.ts'
import { loadSettings, saveSettings } from './settings.ts'
import { allowedFontPath, scanSystemFonts } from './system.ts'
import type { AppSettings, CatalogEntry, Notice, OfficeFontCacheInfo, SortMode, SystemFace, ThemeMode, ViewLayout } from './types.ts'
import {
  expandImportPaths,
  listFontFilesInTree,
  listInboxFontFiles,
  syncInboxWatcher,
  syncUserFontsWatcher,
  syncWatchers,
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
    return path.resolve(entry.installedPath)
  }
  fs.mkdirSync(paths.installDir, { recursive: true })
  const dest = path.join(paths.installDir, path.basename(resolvedFrom))
  if (!fs.existsSync(dest) || sameFile(dest, resolvedFrom)) {
    return dest
  }
  const ext = path.extname(dest) || '.ttf'
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
    await unregisterFont(entry.installedPath)
    if (fs.existsSync(entry.installedPath)) {
      fs.rmSync(entry.installedPath, { force: true })
    }
  }
  entry.installedPath = undefined
}

async function removeDistinctInstalledCopy(entry: CatalogEntry): Promise<void> {
  if (!isExternalSource(entry)) {
    return
  }
  await removeInstalledCopy(entry)
}

function isProtectedSource(filePath: string, paths: AppPaths): boolean {
  return isUnderAnyRoot(filePath, [
    paths.systemFontsDir,
    paths.computerFontsDir,
    paths.supplementalFontsDir,
  ])
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

function copyIntoInstallDir(
  paths: AppPaths,
  entry: CatalogEntry,
  fromPath: string,
  options: { reuseInstalled?: boolean } = {},
): string {
  const dest = destinationForInstall(paths, entry, fromPath, options)
  if (path.resolve(fromPath) !== dest && !sameFile(fromPath, dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(fromPath, dest)
  }
  return dest
}

export class FontButlerService {
  readonly paths: AppPaths

  constructor(paths: AppPaths = getPaths()) {
    this.paths = paths
    ensureDirs(paths)
  }

  async init(): Promise<void> {
    ensureDirs(this.paths)
    await this.restoreDisabledCopies()
    await this.adoptUserFonts()
    await this.seedIfEmpty()
    await this.refreshSourceStatuses()
    await syncWatchers(this.paths)
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
    theme?: ThemeMode
    menuBarIcon?: boolean
    openAtLogin?: boolean
    clearOfficeFontCache?: boolean
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
    if ('watchFolders' in patch) {
      next.watchFolders = this.resolveWatchFolders(patch.watchFolders ?? [])
    }
    saveSettings(this.paths, next)
    emitEvent({ type: 'settings', settings: next })
    if ('watchFolders' in patch) {
      await this.refreshInboxWatcher(next.watchFolders, { importExisting: true })
    }
    return next
  }

  officeFontCacheInfo(): OfficeFontCacheInfo {
    return locateOfficeFontCache()
  }

  getApiToken(): string {
    return getOrCreateApiToken(this.paths.apiTokenPath)
  }

  listSystem(): SystemFace[] {
    const faces = scanSystemFonts(this.paths)
    emitEvent({ type: 'system', faces })
    return faces
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
        const safe = path.basename(file.filename).replace(/[^\w.-]+/g, '_')
        const dest = path.join(this.paths.uploadsDir, `${Date.now()}-${safe}`)
        fs.writeFileSync(dest, file.data)
        saved.push(dest)
      }
      const imported: CatalogEntry[] = []
      for (const filePath of saved) {
        try {
          imported.push(this.importOneUnlocked(filePath))
        } catch (error) {
          errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
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

  async install(id: string, familyName?: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.installEntry(id, familyName)
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entry
    })
  }

  async installMany(ids: string[], familyName?: string): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      for (const id of ids) {
        entries.push(await this.installEntry(id, familyName))
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entries
    })
  }

  async uninstall(id: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.uninstallEntry(id)
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entry
    })
  }

  async uninstallMany(ids: string[]): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      for (const id of ids) {
        entries.push(await this.uninstallEntry(id))
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
      for (const id of ids) {
        entries.push(await this.deactivateEntry(id))
      }
      emitCatalog(this.paths)
      return entries
    })
  }

  async activate(id: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.activateEntry(id)
      emitCatalog(this.paths)
      return entry
    })
  }

  async activateMany(ids: string[]): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      for (const id of ids) {
        entries.push(await this.activateEntry(id))
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
      await this.clearCachesAfterInstall()
      const entries: CatalogEntry[] = []
      for (const id of ids) {
        const catalog = loadCatalog(this.paths)
        const entry = findById(catalog, id)
        if (!entry) {
          throw new Error('Font is not in the library.')
        }
        await removeDistinctInstalledCopy(entry)
        entries.push(await this.installEntry(id, entry.customFamilyName))
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
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
    const result = await removeUserFontCache()
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
    const result = await removeOfficeFontCache()
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
      await unregisterFont(resolved)
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
      await unregisterFont(resolved)
      fs.mkdirSync(this.paths.disabledDir, { recursive: true })
      const dest = path.join(this.paths.disabledDir, path.basename(resolved))
      fs.renameSync(resolved, dest)
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
    if (!allowedFontPath(resolved, this.paths)) {
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

  private async installEntry(id: string, familyName?: string): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (!sourceFileExists(entry.sourcePath)) {
      applySourcePresence(entry)
      saveCatalog(this.paths, catalog)
      throw new Error('The source file is missing.')
    }
    if (
      !familyName &&
      entry.status === 'installed' &&
      entry.installedPath &&
      fs.existsSync(entry.installedPath)
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
    let sourceForInstall = entry.sourcePath
    let temp: string | undefined
    if (familyName && familyName.trim()) {
      entry.customFamilyName = familyName.trim()
      temp = await renameFamilyCopy(entry.sourcePath, entry.customFamilyName)
      sourceForInstall = temp
      try {
        entry.faces = parseFontFile(temp).faces
      } catch {
        // Keep original parsed faces if the renamed copy cannot be re-parsed.
      }
    }
    const dest = copyIntoInstallDir(this.paths, entry, sourceForInstall, {
      reuseInstalled: !temp,
    })
    if (temp && fs.existsSync(temp) && path.resolve(temp) !== dest) {
      fs.rmSync(temp, { force: true })
    }
    if (entry.installedPath && path.resolve(entry.installedPath) !== dest) {
      await removeInstalledCopy(entry)
    }
    await registerFont(dest)
    await setFontEnabled(dest, true)
    if (!sourceFileExists(entry.sourcePath)) {
      entry.sourcePath = dest
    }
    const stat = readFileStat(entry.sourcePath)
    entry.installedPath = dest
    entry.disabledPath = undefined
    entry.sourceMtimeMs = stat.mtimeMs
    entry.sourceSize = stat.size
    entry.sourcePresent = isExternalSource(entry)
    entry.installedSnapshotMtimeMs = stat.mtimeMs
    entry.installedSnapshotSize = stat.size
    entry.status = 'installed'
    touchEntry(entry)
    saveCatalog(this.paths, catalog)
    return entry
  }

  private async uninstallEntry(id: string): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    const keepSource = isExternalSource(entry) && sourceFileExists(entry.sourcePath)
    await removeInstalledCopy(entry)
    if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
      fs.rmSync(entry.disabledPath, { force: true })
    }
    entry.disabledPath = undefined
    entry.installedPath = undefined
    if (keepSource) {
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
    await setFontEnabled(entry.installedPath, false)
    entry.disabledPath = undefined
    entry.status = 'deactivated'
    touchEntry(entry)
    saveCatalog(this.paths, catalog)
    return entry
  }

  private async activateEntry(id: string): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
      const dest = destinationForInstall(this.paths, entry, entry.disabledPath)
      if (path.resolve(entry.disabledPath) !== dest) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.renameSync(entry.disabledPath, dest)
      }
      await registerFont(dest)
      await setFontEnabled(dest, true)
      entry.installedPath = dest
      entry.disabledPath = undefined
      entry.status = 'installed'
      touchEntry(entry)
      saveCatalog(this.paths, catalog)
      return entry
    }
    if (entry.installedPath && fs.existsSync(entry.installedPath)) {
      await setFontEnabled(entry.installedPath, true)
      entry.status = 'installed'
      touchEntry(entry)
      saveCatalog(this.paths, catalog)
      return entry
    }
    return this.installEntry(id)
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
    await removeDistinctInstalledCopy(entry)
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
        await removeDistinctInstalledCopy(entry)
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
      findByFaceIdentity(catalog, parsed.faces)
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

  private async clearCachesAfterInstall(): Promise<void> {
    await clearFontCaches({ office: loadSettings(this.paths).clearOfficeFontCache })
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
    const firstAdded = added[0]
    if (firstAdded) {
      emitNotice({
        kind: 'info',
        message:
          added.length === 1
            ? `Added ${displayFamily(firstAdded)} from a watch folder`
            : `Added ${added.length} fonts from a watch folder`,
        entryId: firstAdded.id,
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
      const dest = destinationForInstall(this.paths, entry, entry.disabledPath, {
        reuseInstalled: false,
      })
      if (path.resolve(entry.disabledPath) !== dest) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.renameSync(entry.disabledPath, dest)
      }
      await registerFont(dest)
      await setFontEnabled(dest, false)
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
    const enabled = await fontActivationStates(files)
    let changed = false

    for (const filePath of files) {
      const resolved = path.resolve(filePath)
      const existing =
        findByInstalledPath(catalog, resolved) ??
        findBySourcePath(catalog, resolved) ??
        (() => {
          try {
            return findByFaceIdentity(catalog, parseFontFile(resolved).faces)
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

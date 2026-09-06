import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  applySourcePresence,
  findAllByFaceIdentity,
  findById,
  findByInstalledPath,
  findBySourcePath,
  isExternalSource,
  loadCatalog,
  removeEntryById,
  runCatalogTask,
  saveCatalog,
  sourceFileExists,
  upsertEntry,
} from './catalog.ts'
import { getOrCreateApiToken } from './auth.ts'
import { locateAdobeFontCache, locateOfficeFontCache } from './caches.ts'
import {
  adobeInvestigation,
  copyAt,
  dropCopy,
  entryHasParkedBytes,
  findUnmanagedConflicts,
  inspectDestination,
  isDefaultDestinationId,
  listDestinations,
  plannedManagedPath,
  recordedDestinationIds,
  removeManagedCopy,
  targetsForDefaultDestination,
  upsertCopy,
  verifyManagedCopy,
  writeManagedCopy,
} from './destinations.ts'
import { MAX_UPLOAD_BYTES } from './constants.ts'
import {
  duplicateNotifyKey,
  loadDuplicates,
  pruneStaleDuplicates,
  removeDuplicateWarning,
  upsertDuplicateWarning,
} from './duplicates.ts'
import { emitEvent } from './events.ts'
import {
  IDENTITY_MUTEX_MESSAGE,
  identityMutexMessage,
  occupiedDestinations,
  occupiesDestination,
  occupyingSiblings,
  occupyingSiblingsForIncoming,
} from './identity.ts'
import {
  assertNotWebFont,
  assertSingleInstallableFormat,
  formatConflictMessage,
  installedFormatConflicts,
  isWebFontFile,
  isWebFontFormat,
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
import { ensureFontActivation, getFontNative } from './native.ts'
import { fingerprintFile, tryFingerprintFile } from './fingerprint.ts'
import { assertExpectedSourceFingerprint } from './comparison.ts'
import { reconcileMutationJournals, withMutationJournal } from './journal.ts'
import {
  applyFolderPatch,
  createWatchFolder,
  folderForPath,
  inspectFolderAvailability,
  isExcluded,
  mostSpecificOwner,
  syncWatchFolderPaths,
} from './folders.ts'
import {
  createOperation,
  findOperationByIdempotency,
  finishOperation,
  loadOperations,
  markUndone,
  operationCounts,
  pruneOperations,
  upsertOperation,
} from './operations.ts'
import {
  isFontFile,
  isPreviewableFontFile,
  mimeForFont,
  parseFontBuffer,
  parseFontFile,
  readFileStat,
} from './parse.ts'
import { isUnderAnyRoot } from './containment.ts'
import {
  buildImportPlan,
  catalogRevision,
  classifyImportFile,
  isWatchIdentityDuplicate,
  loadPlan,
  rememberedDecisionKey,
  savePlan,
} from './planner.ts'
import {
  addManualOwner,
  addProjectOwner,
  createProject,
  hasActivationDemand,
  loadProjects,
  pinConflict,
  pinnedFingerprints,
  projectActivationState,
  removeManualOwner,
  removeProject,
  removeProjectOwner,
  setMemberUnsatisfied,
  upsertProject,
} from './projects.ts'
import { inspectFolderRelink as previewFolderRelink, inspectRelinkCandidate } from './relink.ts'
import {
  evictUnreferencedRevisions,
  loadRevisionIndex,
  readRevisionBytes,
  revisionFilePath,
  revisionUsageBytes,
  storeRevision,
} from './revisions.ts'
import { ensureDirs, getPaths, isMac, type AppPaths } from './paths.ts'
import {
  applyEntryFacts,
  canAutomateUpdates,
  isCleanupEligible,
  setUpdateHold,
} from './state.ts'
import { postscriptPreview, renameFamilyCopy } from './rename.ts'
import { moveToTrash, revealInFileManager } from './reveal.ts'
import { loadSettings, saveSettings } from './settings.ts'
import { allowedFontPath, scanSystemFonts } from './system.ts'
import type {
  AdobeFontCacheInfo,
  AppSettings,
  BatchActionResult,
  CatalogEntry,
  ComparisonCapture,
  DefaultDestinationId,
  DestinationId,
  DuplicateWarning,
  FolderPolicyPreset,
  InstallOptions,
  FolderRelinkPreview,
  ImportPlan,
  ImportPlanChoice,
  Notice,
  OfficeFontCacheInfo,
  Operation,
  OperationItem,
  OperationTrigger,
  ProjectSet,
  RelinkPreview,
  RepairItemResult,
  SortMode,
  SystemFace,
  ThemeMode,
  UpdatePolicy,
  ViewLayout,
  WatchFolder,
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

function emitDuplicates(paths: AppPaths): DuplicateWarning[] {
  const duplicates = pruneStaleDuplicates(paths)
  emitEvent({ type: 'duplicates', duplicates })
  return duplicates
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
  private rememberedDecisions = new Map<string, ImportPlanChoice>()

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
    const recovered = await reconcileMutationJournals(this.paths, getFontNative())
    if (recovered.length) {
      emitCatalog(this.paths)
      emitEvent({ type: 'operations', operations: loadOperations(this.paths) })
    }
    await this.restoreDisabledCopies()
    await this.adoptUserFonts()
    await this.detachRenamedInstallSources()
    await this.seedIfEmpty()
    await this.refreshSourceStatuses()
    await this.reinstallCurrentlyOutdated()
    await syncWatchers(this.paths)
    await reconcileWatchedSources(this.paths)
    await this.refreshUserFontsWatcher()
    await this.refreshInboxWatcher(this.watchingFolderRoots(), { importExisting: true })
  }

  listCatalog(): CatalogEntry[] {
    return loadCatalog(this.paths).entries
  }

  listDuplicates(): DuplicateWarning[] {
    return pruneStaleDuplicates(this.paths)
  }

  async switchTo(id: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const catalog = loadCatalog(this.paths)
      const entry = findById(catalog, id)
      if (!entry) throw new Error('Font is not in the library.')
      const sibling = occupyingSiblings(catalog.entries, entry, this.paths)[0]
      const switched = await this.switchToEntry(id)
      const item = this.operationItem(switched, 'succeeded')
      item.relatedEntryId = sibling?.id
      this.commitManualOperation('switch', [item], displayFamily(switched))
      emitCatalog(this.paths)
      emitDuplicates(this.paths)
      return switched
    })
  }

  async resolveDuplicate(
    id: string,
    choice: ImportPlanChoice,
    options: { familyName?: string } = {},
  ): Promise<{ entries: CatalogEntry[]; duplicates: DuplicateWarning[] }> {
    return runCatalogTask(async () => {
      const warning = loadDuplicates(this.paths).find((item) => item.id === id)
      if (!warning) throw new Error('That duplicate warning is no longer available.')
      if (!fs.existsSync(warning.path)) {
        removeDuplicateWarning(this.paths, id)
        emitDuplicates(this.paths)
        throw new Error('That watched file is no longer available.')
      }
      const entries: CatalogEntry[] = []
      if (choice === 'skip') {
        removeDuplicateWarning(this.paths, id)
      } else if (choice === 'replace') {
        const targetId = warning.activeEntryId ?? warning.conflictingEntryIds[0]
        if (!targetId) throw new Error('There is no active copy to replace.')
        const catalog = loadCatalog(this.paths)
        const latest = findById(catalog, targetId)
        if (!latest) throw new Error('The library copy is no longer available.')
        if (path.resolve(latest.sourcePath) !== path.resolve(warning.path)) {
          latest.sourcePath = warning.path
          const stat = readFileStat(warning.path)
          latest.sourceMtimeMs = stat.mtimeMs
          latest.sourceSize = stat.size
          latest.sourceFingerprint = tryFingerprintFile(warning.path)
          applyEntryFacts(latest)
          touchEntry(latest)
          saveCatalog(this.paths, catalog)
        }
        entries.push(await this.installEntry(targetId))
        removeDuplicateWarning(this.paths, id)
      } else if (choice === 'add-inactive') {
        entries.push(this.importOneUnlocked(warning.path, { forceNew: true }))
        removeDuplicateWarning(this.paths, id)
      } else if (choice === 'switch') {
        const imported = this.importOneUnlocked(warning.path, { forceNew: true })
        const occupying = occupyingSiblings(loadCatalog(this.paths).entries, imported, this.paths)[0]
        const switched = await this.switchToEntry(imported.id)
        entries.push(switched)
        const item = this.operationItem(switched, 'succeeded')
        item.relatedEntryId = occupying?.id
        this.commitManualOperation('switch', [item], displayFamily(imported))
        removeDuplicateWarning(this.paths, id)
      } else if (choice === 'install-as') {
        const familyName = options.familyName?.trim()
        if (!familyName) {
          throw new Error('Choose a family name to Install as…')
        }
        const imported = this.importOneUnlocked(warning.path, { forceNew: true })
        entries.push(await this.installEntry(imported.id, familyName))
        removeDuplicateWarning(this.paths, id)
      } else {
        throw new Error('Choose Replace active, Add inactive copy, Install as…, Skip, or Switch.')
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      const duplicates = emitDuplicates(this.paths)
      return { entries, duplicates }
    })
  }

  getSettings(): AppSettings {
    return loadSettings(this.paths)
  }

  async updateSettings(patch: {
    watchFolders?: string[]
    folders?: WatchFolder[]
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
    revisionBudgetBytes?: number
    activityRetentionDays?: number
    activityMaxOperations?: number
    specimen?: AppSettings['specimen']
    defaultDestination?: DefaultDestinationId
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
      const roots = this.resolveWatchFolders(patch.watchFolders ?? [])
      const existing = new Map(next.folders.map((folder) => [path.resolve(folder.root), folder]))
      next.folders = roots.map(
        (root) =>
          existing.get(root) ??
          createWatchFolder(root, {
            installNew: next.installWatchFolderFonts,
            autoUpdate: next.autoReinstallOnUpdate,
            watching: true,
          }),
      )
      next.watchFolders = roots
    }
    const folderPatch = patch.folders
    if (folderPatch) {
      next.folders = folderPatch.map((folder) =>
        createWatchFolder(folder.root, {
          id: folder.id,
          policy: folder.policy,
          installNew: folder.installNew,
          autoUpdate: folder.autoUpdate,
          paused: folder.paused,
          watching: folder.watching,
          exclusions: folder.exclusions,
          destinationId: folder.destinationId,
        }),
      )
      next.watchFolders = next.folders.map((folder) => folder.root)
    }
    if (typeof patch.revisionBudgetBytes === 'number') {
      next.revisionBudgetBytes = patch.revisionBudgetBytes
    }
    if (typeof patch.activityRetentionDays === 'number') {
      next.activityRetentionDays = patch.activityRetentionDays
    }
    if (typeof patch.activityMaxOperations === 'number') {
      next.activityMaxOperations = patch.activityMaxOperations
    }
    if (patch.specimen) {
      next.specimen = patch.specimen
    }
    if (isDefaultDestinationId(patch.defaultDestination)) {
      next.defaultDestination = patch.defaultDestination
    }
    syncWatchFolderPaths(next)
    saveSettings(this.paths, next)
    emitEvent({ type: 'settings', settings: next })
    if ('watchFolders' in patch || folderPatch) {
      await this.refreshInboxWatcher(this.watchingFolderRoots(next), { importExisting: true })
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

  listDestinations() {
    return {
      destinations: listDestinations(this.paths),
      investigation: adobeInvestigation(this.paths),
    }
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
      if (entry.previewOnly) {
        emitCatalog(this.paths)
        emitNotice({
          kind: 'info',
          message: `${displayFamily(entry)} is a web font and can be previewed only.`,
          entryId: entry.id,
        })
        return entry
      }
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
        const siblings = occupyingSiblings(loadCatalog(this.paths).entries, entry, this.paths)
        const activated = siblings.length
          ? await this.switchToEntry(entry.id)
          : await this.activateEntry(entry.id)
        emitCatalog(this.paths)
        emitNotice({
          kind: 'installed',
          message: siblings.length
            ? `Switched to ${displayFamily(activated)}`
            : `Activated ${displayFamily(activated)}`,
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

  async captureComparison(id: string): Promise<ComparisonCapture> {
    const entry = findById(loadCatalog(this.paths), id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (!sourceFileExists(entry.sourcePath)) {
      throw new Error('The source file is missing.')
    }
    const sourceFingerprint = fingerprintFile(entry.sourcePath)
    storeRevision(this.paths, entry.sourcePath, { faces: entry.faces, format: entry.format })
    let installedFingerprint: string | null = null
    if (entry.installedPath && fs.existsSync(entry.installedPath)) {
      installedFingerprint = fingerprintFile(entry.installedPath)
      storeRevision(this.paths, entry.installedPath, { faces: entry.faces, format: entry.format })
    }
    return { id: entry.id, installedFingerprint, sourceFingerprint }
  }

  async install(
    id: string,
    familyName?: string,
    options?: InstallOptions,
  ): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.installEntry(id, familyName, options)
      const catalog = loadCatalog(this.paths)
      const latest = findById(catalog, entry.id)
      if (latest) {
        addManualOwner(latest)
        touchEntry(latest)
        saveCatalog(this.paths, catalog)
      }
      this.commitManualOperation(
        options?.replace ? 'install-update' : 'install',
        [this.operationItem(entry, 'succeeded')],
        displayFamily(entry),
      )
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entry
    })
  }

  async installMany(
    ids: string[],
    familyName?: string,
    options?: InstallOptions,
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
          const installed = await this.installEntry(entry.id, familyName, options)
          const catalog = loadCatalog(this.paths)
          const latest = findById(catalog, installed.id)
          if (latest) {
            addManualOwner(latest)
            touchEntry(latest)
            saveCatalog(this.paths, catalog)
          }
          entries.push(latest ?? installed)
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }
      if (entries.length === 0 && errors.length) {
        throw new Error(errors.join('\n'))
      }
      this.commitManualOperation(
        options?.replace ? 'install-update' : 'install',
        entries.map((entry) => this.operationItem(entry, 'succeeded')),
        entries[0] ? displayFamily(entries[0]) : undefined,
      )
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entries
    })
  }

  async uninstall(id: string, options?: { deleteSource?: boolean }): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const previousRevision = this.retainInstalledRevision(id)
      const entry = await this.uninstallEntry(id, options)
      const item = this.operationItem(entry, 'succeeded')
      item.previousRevision = previousRevision
      this.commitManualOperation(
        'uninstall',
        [item],
        displayFamily(entry),
        !options?.deleteSource,
      )
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entry
    })
  }

  async uninstallMany(ids: string[], options?: { deleteSource?: boolean }): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      const previousRevisions = new Map<string, string | undefined>()
      for (const id of ids) {
        previousRevisions.set(id, this.retainInstalledRevision(id))
        entries.push(await this.uninstallEntry(id, options))
      }
      this.commitManualOperation(
        'uninstall',
        entries.map((entry) => {
          const item = this.operationItem(entry, 'succeeded')
          item.previousRevision = previousRevisions.get(entry.id)
          return item
        }),
        entries[0] ? displayFamily(entries[0]) : undefined,
        !options?.deleteSource,
      )
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entries
    })
  }

  async deactivate(id: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.deactivateEntry(id, { removeManualOwner: true })
      this.commitManualOperation('deactivate', [this.operationItem(entry, 'succeeded')], displayFamily(entry))
      emitCatalog(this.paths)
      return entry
    })
  }

  async deactivateMany(ids: string[]): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      const items: OperationItem[] = []
      const errors: string[] = []
      for (const id of ids) {
        const catalog = loadCatalog(this.paths)
        const entry = findById(catalog, id)
        if (!entry || !eligibleForDeactivate(entry)) continue
        try {
          const next = await this.deactivateEntry(id, { removeManualOwner: true })
          entries.push(next)
          items.push(this.operationItem(next, 'succeeded'))
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          errors.push(reason)
          items.push(this.operationItem(entry, 'failed', reason))
        }
      }
      this.commitManualOperation('deactivate', items, entries[0] ? displayFamily(entries[0]) : undefined)
      emitCatalog(this.paths)
      if (entries.length === 0 && errors.length) {
        throw new Error(errors.join('\n'))
      }
      return entries
    })
  }

  async activate(id: string, options?: { replace?: boolean; switch?: boolean }): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const current = findById(loadCatalog(this.paths), id)
      const relatedId = current
        ? occupyingSiblings(loadCatalog(this.paths).entries, current, this.paths)[0]?.id
        : undefined
      const entry = options?.switch
        ? await this.switchToEntry(id)
        : await this.activateEntry(id, { ...options, owner: 'manual' })
      const item = this.operationItem(entry, 'succeeded')
      if (options?.switch) item.relatedEntryId = relatedId
      this.commitManualOperation(
        options?.switch ? 'switch' : 'activate',
        [item],
        displayFamily(entry),
      )
      emitCatalog(this.paths)
      return entry
    })
  }

  async activateMany(ids: string[], options?: { replace?: boolean; switch?: boolean }): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const catalog = loadCatalog(this.paths)
      const toActivate = ids
        .map((id) => findById(catalog, id))
        .filter((entry): entry is CatalogEntry => Boolean(entry))
      assertSingleInstallableFormat(toActivate)
      const entries: CatalogEntry[] = []
      const items: OperationItem[] = []
      for (const id of ids) {
        const current = findById(loadCatalog(this.paths), id)
        const relatedId = current
          ? occupyingSiblings(loadCatalog(this.paths).entries, current, this.paths)[0]?.id
          : undefined
        const next = options?.switch
          ? await this.switchToEntry(id)
          : await this.activateEntry(id, { ...options, owner: 'manual' })
        const item = this.operationItem(next, 'succeeded')
        if (options?.switch) item.relatedEntryId = relatedId
        entries.push(next)
        items.push(item)
      }
      this.commitManualOperation(
        options?.switch ? 'switch' : 'activate',
        items,
        entries[0] ? displayFamily(entries[0]) : undefined,
      )
      emitCatalog(this.paths)
      return entries
    })
  }

  async reinstall(id: string, options?: InstallOptions): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.reinstallEntry(id, options)
      this.commitManualOperation('reinstall', [this.operationItem(entry, 'succeeded')], displayFamily(entry))
      emitCatalog(this.paths)
      return entry
    })
  }

  async reinstallMany(ids: string[], options?: InstallOptions): Promise<CatalogEntry[]> {
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
          entries.push(await this.reinstallEntry(id, options))
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
      this.commitManualOperation(
        'reinstall',
        entries.map((entry) => this.operationItem(entry, 'succeeded')),
        first ? displayFamily(first) : undefined,
      )
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
        .filter((entry) => isCleanupEligible(entry))
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

  inspectRelink(id: string, candidatePath: string): RelinkPreview {
    const entry = findById(loadCatalog(this.paths), id)
    if (!entry) throw new Error('Font is not in the library.')
    return inspectRelinkCandidate(entry, candidatePath)
  }

  async applyRelink(id: string, candidatePath: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const catalog = loadCatalog(this.paths)
      const entry = findById(catalog, id)
      if (!entry) throw new Error('Font is not in the library.')
      const preview = inspectRelinkCandidate(entry, candidatePath)
      if (preview.match === 'mismatch' || preview.match === 'missing' || preview.match === 'ambiguous') {
        throw new Error(preview.reason || 'That file cannot be used as this source.')
      }
      const previous = entry.sourcePath
      entry.sourcePath = preview.proposedPath
      const stat = readFileStat(preview.proposedPath)
      entry.sourceMtimeMs = stat.mtimeMs
      entry.sourceSize = stat.size
      entry.sourceFingerprint = tryFingerprintFile(preview.proposedPath)
      applyEntryFacts(entry)
      if (preview.bytesDiffer && (entry.status === 'installed' || entry.status === 'deactivated')) {
        if (entry.status === 'installed') entry.status = 'outdated'
        setUpdateHold(entry, 'relink-review')
      }
      touchEntry(entry)
      saveCatalog(this.paths, catalog)
      const operation = finishOperation(
        createOperation({ trigger: 'relink', action: 'relink-source', familyName: displayFamily(entry) }),
        [
          {
            id: newId(),
            entryId: entry.id,
            label: displayFamily(entry),
            outcome: 'succeeded',
            previousRevision: previous,
          },
        ],
      )
      operation.undoable = true
      upsertOperation(this.paths, operation)
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      emitEvent({ type: 'operations', operations: loadOperations(this.paths) })
      return entry
    })
  }

  inspectFolderRelink(oldRoot: string, newRoot: string, search = false): FolderRelinkPreview {
    return previewFolderRelink(loadCatalog(this.paths).entries, oldRoot, newRoot, { search })
  }

  async applyFolderRelink(
    oldRoot: string,
    newRoot: string,
    selections: Record<string, string | undefined> = {},
  ): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const preview = previewFolderRelink(loadCatalog(this.paths).entries, oldRoot, newRoot, {
        search: true,
      })
      const updated: CatalogEntry[] = []
      const items: OperationItem[] = []
      for (const row of preview.rows) {
        const chosen = selections[row.entryId] ?? row.selected
        const explicitSelection = selections[row.entryId]
        if (
          !chosen ||
          ((row.status === 'ambiguous' || row.status === 'not-found') && !explicitSelection)
        ) {
          if (row.status === 'ambiguous') {
            items.push({
              id: newId(),
              entryId: row.entryId,
              label: row.relativePath,
              outcome: 'skipped',
              reason: 'Choose one of the matching files.',
            })
          }
          continue
        }
        if (!fs.existsSync(chosen)) {
          items.push({
            id: newId(),
            entryId: row.entryId,
            label: row.relativePath,
            outcome: 'failed',
            reason: 'The chosen file disappeared before it could be linked.',
          })
          continue
        }
        const catalog = loadCatalog(this.paths)
        const entry = findById(catalog, row.entryId)
        if (!entry) continue
        const inspect = inspectRelinkCandidate(entry, chosen)
        if (inspect.match === 'mismatch') {
          items.push({
            id: newId(),
            entryId: entry.id,
            label: row.relativePath,
            outcome: 'failed',
            reason: inspect.reason,
          })
          continue
        }
        entry.sourcePath = path.resolve(chosen)
        const stat = readFileStat(entry.sourcePath)
        entry.sourceMtimeMs = stat.mtimeMs
        entry.sourceSize = stat.size
        entry.sourceFingerprint = tryFingerprintFile(entry.sourcePath)
        applyEntryFacts(entry)
        if (inspect.bytesDiffer && entry.status === 'installed') {
          entry.status = 'outdated'
          setUpdateHold(entry, 'relink-review')
        }
        touchEntry(entry)
        saveCatalog(this.paths, catalog)
        updated.push(entry)
        items.push({
          id: newId(),
          entryId: entry.id,
          label: displayFamily(entry),
          outcome: 'succeeded',
        })
      }
      const operation = finishOperation(
        createOperation({ trigger: 'relink', action: 'relink-folder' }),
        items,
      )
      upsertOperation(this.paths, operation)
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      emitEvent({ type: 'operations', operations: loadOperations(this.paths) })
      return updated
    })
  }

  inspectFolderDiscovery(root: string, exclusions: string[] = []): ImportPlan {
    const folder = createWatchFolder(root, { exclusions, watching: false })
    const files = listInboxFontFiles(root).filter((filePath) => !isExcluded(folder, filePath))
    return buildImportPlan(files, loadCatalog(this.paths), { trigger: 'watch', paths: this.paths })
  }

  async configureFolder(input: {
    root: string
    policy?: FolderPolicyPreset
    installNew?: boolean
    autoUpdate?: boolean
    exclusions?: string[]
    id?: string
    destinationId?: DefaultDestinationId
  }): Promise<{ folder: WatchFolder; discovery: ImportPlan }> {
    const settings = loadSettings(this.paths)
    const root = this.resolveWatchFolders([input.root])[0]!
    const existing = settings.folders.find(
      (folder) => folder.id === input.id || path.resolve(folder.root) === root,
    )
    const folder = applyFolderPatch(
      existing ??
        createWatchFolder(root, {
          policy: input.policy ?? 'library',
          installNew: input.installNew,
          autoUpdate: input.autoUpdate,
          exclusions: input.exclusions,
          watching: false,
          destinationId: input.destinationId,
        }),
      {
        root,
        policy: input.policy,
        installNew: input.installNew,
        autoUpdate: input.autoUpdate,
        exclusions: input.exclusions,
        watching: existing?.watching ?? false,
        destinationId: input.destinationId,
      },
    )
    settings.folders = existing
      ? settings.folders.map((item) => (item.id === folder.id ? folder : item))
      : [...settings.folders, folder]
    syncWatchFolderPaths(settings)
    saveSettings(this.paths, settings)
    emitEvent({ type: 'settings', settings })
    return { folder, discovery: this.inspectFolderDiscovery(folder.root, folder.exclusions) }
  }

  async startWatching(folderId: string): Promise<WatchFolder> {
    const settings = loadSettings(this.paths)
    const folder = settings.folders.find((item) => item.id === folderId)
    if (!folder) throw new Error('That watch folder is not configured.')
    folder.watching = true
    folder.paused = false
    folder.availability = inspectFolderAvailability(folder.root)
    syncWatchFolderPaths(settings)
    saveSettings(this.paths, settings)
    emitEvent({ type: 'settings', settings })
    await this.refreshInboxWatcher(this.watchingFolderRoots(settings), { importExisting: true })
    return folder
  }

  async pauseFolder(folderId: string): Promise<WatchFolder> {
    return this.patchFolder(folderId, { paused: true })
  }

  async resumeFolder(folderId: string): Promise<WatchFolder> {
    const folder = await this.patchFolder(folderId, { paused: false, watching: true })
    await this.refreshInboxWatcher(this.watchingFolderRoots(), { importExisting: true })
    await this.reinstallCurrentlyOutdated()
    return folder
  }

  private async patchFolder(
    folderId: string,
    patch: Parameters<typeof applyFolderPatch>[1],
  ): Promise<WatchFolder> {
    const settings = loadSettings(this.paths)
    const current = settings.folders.find((item) => item.id === folderId)
    if (!current) throw new Error('That watch folder is not configured.')
    const folder = applyFolderPatch(current, patch)
    settings.folders = settings.folders.map((item) => (item.id === folderId ? folder : item))
    syncWatchFolderPaths(settings)
    saveSettings(this.paths, settings)
    emitEvent({ type: 'settings', settings })
    return folder
  }

  async setUpdatePolicy(id: string, policy: UpdatePolicy): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const catalog = loadCatalog(this.paths)
      const entry = findById(catalog, id)
      if (!entry) throw new Error('Font is not in the library.')
      entry.updatePolicy = policy
      if (policy === 'automatic' || policy === 'inherit') {
        entry.updateHold = null
      }
      touchEntry(entry)
      saveCatalog(this.paths, catalog)
      emitCatalog(this.paths)
      return entry
    })
  }

  async resumeUpdates(id: string): Promise<CatalogEntry> {
    return this.setUpdatePolicy(id, 'inherit')
  }

  planImport(filePaths: string[], trigger: OperationTrigger = 'import'): ImportPlan {
    const expanded = expandImportPaths(filePaths)
    return savePlan(
      this.paths,
      buildImportPlan(expanded.files, loadCatalog(this.paths), { trigger, paths: this.paths }),
    )
  }

  async applyPlan(
    planId: string,
    choices: Record<string, ImportPlanChoice> = {},
    options: { idempotencyKey?: string; familyName?: string } = {},
  ): Promise<BatchActionResult> {
    const existing = findOperationByIdempotency(this.paths, options.idempotencyKey)
    if (existing) {
      return this.batchFromOperation(existing)
    }
    const plan = loadPlan(this.paths, planId)
    if (!plan) throw new Error('That import plan is no longer available.')
    const catalog = loadCatalog(this.paths)
    if (plan.expectedCatalogRevision !== catalogRevision(catalog)) {
      throw new Error('The library changed. Review the import again.')
    }
    return runCatalogTask(async () => {
      const operation = createOperation({
        trigger: plan.trigger,
        action: 'apply-plan',
        idempotencyKey: options.idempotencyKey,
      })
      const items: OperationItem[] = []
      const entries: CatalogEntry[] = []
      const failedIds: string[] = []
      for (const item of plan.items) {
        const remembered = this.rememberedDecisions.get(rememberedDecisionKey(item))
        const choice = choices[item.id] ?? remembered ?? item.defaultChoice
        const previousInstalledFingerprint = item.entryId
          ? findById(loadCatalog(this.paths), item.entryId)?.installedFingerprint
          : undefined
        if (
          item.classification === 'alt-format' ||
          item.classification === 'collection-overlap' ||
          item.classification === 'revision'
        ) {
          this.rememberedDecisions.set(rememberedDecisionKey(item), choice)
        }
        if (choice === 'skip') {
          items.push({
            id: item.id,
            entryId: item.entryId,
            label: item.familyName || path.basename(item.path),
            outcome: 'skipped',
          })
          continue
        }
        try {
          if (item.classification === 'unsupported') {
            throw new Error(item.reason || 'Unsupported font.')
          }
          if (choice === 'relink' && item.entryId) {
            entries.push(await this.applyRelink(item.entryId, item.path))
          } else if (choice === 'add-inactive') {
            entries.push(this.importOneUnlocked(item.path, { forceNew: true }))
          } else if (choice === 'switch') {
            const imported = this.importOneUnlocked(item.path, { forceNew: true })
            entries.push(await this.switchToEntry(imported.id))
          } else if (
            choice === 'keep' &&
            (item.classification === 'revision' ||
              item.classification === 'alt-format' ||
              item.classification === 'collection-overlap')
          ) {
            // Keep the current installation while still recording the incoming source in the catalog.
            entries.push(this.importOneUnlocked(item.path, item.parallelCopy ? { forceNew: true } : undefined))
          } else if (choice === 'replace' && item.entryId) {
            const catalog = loadCatalog(this.paths)
            const latest = findById(catalog, item.entryId)
            if (latest && path.resolve(latest.sourcePath) !== path.resolve(item.path)) {
              latest.sourcePath = item.path
              const stat = readFileStat(item.path)
              latest.sourceMtimeMs = stat.mtimeMs
              latest.sourceSize = stat.size
              latest.sourceFingerprint = tryFingerprintFile(item.path)
              applyEntryFacts(latest)
              touchEntry(latest)
              saveCatalog(this.paths, catalog)
            }
            if (item.classification === 'alt-format' || item.classification === 'collection-overlap') {
              entries.push(await this.installEntry(item.entryId, undefined, { replace: true }))
            } else {
              entries.push(await this.installEntry(item.entryId))
            }
          } else if (choice === 'install-as') {
            const familyName = options.familyName?.trim()
            if (!familyName) {
              throw new Error('Choose a family name to Install as…')
            }
            const imported = this.importOneUnlocked(
              item.path,
              item.parallelCopy ? { forceNew: true } : undefined,
            )
            entries.push(await this.installEntry(imported.id, familyName))
          } else {
            const imported = this.importOneUnlocked(item.path)
            const settings = loadSettings(this.paths)
            const folder = settings.folders.find((row) => row.id === imported.ownerFolderId)
            const shouldInstall =
              !imported.previewOnly &&
              (plan.trigger === 'import'
                ? settings.installAfterUpload
                : Boolean(folder?.installNew || (!folder && settings.installWatchFolderFonts)))
            if (shouldInstall && imported.status !== 'installed') {
              entries.push(await this.installEntry(imported.id))
            } else {
              entries.push(imported)
            }
          }
          items.push({
            id: item.id,
            entryId: entries.at(-1)?.id,
            label: item.familyName || path.basename(item.path),
            outcome: 'succeeded',
            previousRevision:
              entries.at(-1)?.id === item.entryId ? previousInstalledFingerprint : undefined,
          })
        } catch (error) {
          failedIds.push(item.entryId || item.id)
          items.push({
            id: item.id,
            entryId: item.entryId,
            label: item.familyName || path.basename(item.path),
            outcome: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }
      finishOperation(operation, items)
      upsertOperation(this.paths, operation)
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      emitEvent({ type: 'operations', operations: loadOperations(this.paths) })
      const counts = operationCounts(operation)
      return {
        operationId: operation.id,
        ...counts,
        errors: items.filter((row) => row.reason).map((row) => row.reason!),
        entries,
        failedIds,
      }
    })
  }

  listActivity(): Operation[] {
    const settings = loadSettings(this.paths)
    pruneOperations(this.paths, {
      maxAgeMs: settings.activityRetentionDays * 24 * 60 * 60 * 1000,
      maxCount: settings.activityMaxOperations,
    })
    return loadOperations(this.paths)
  }

  listRevisions(id: string): Array<{ fingerprint: string; current: boolean; previous: boolean }> {
    const entry = findById(loadCatalog(this.paths), id)
    if (!entry) throw new Error('Font is not in the library.')
    const rows = []
    if (entry.installedFingerprint) {
      rows.push({
        fingerprint: entry.installedFingerprint,
        current: true,
        previous: entry.previousRevisionId === entry.installedFingerprint,
      })
    }
    if (entry.previousRevisionId && entry.previousRevisionId !== entry.installedFingerprint) {
      rows.push({ fingerprint: entry.previousRevisionId, current: false, previous: true })
    }
    return rows
  }

  async restoreRevision(id: string, fingerprint?: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const catalog = loadCatalog(this.paths)
      const entry = findById(catalog, id)
      if (!entry) throw new Error('Font is not in the library.')
      const target = fingerprint || entry.previousRevisionId
      if (!target) throw new Error('There is no retained version to restore.')
      const bytes = readRevisionBytes(this.paths, target)
      if (!bytes) throw new Error('The retained version is no longer available.')
      const revisionFormat =
        loadRevisionIndex(this.paths).revisions.find((item) => item.fingerprint === target)?.format ||
        entry.format ||
        path.extname(entry.sourcePath).slice(1) ||
        'ttf'
      const previousFingerprint =
        entry.installedFingerprint ||
        (entry.installedPath && fs.existsSync(entry.installedPath)
          ? tryFingerprintFile(entry.installedPath)
          : undefined)
      const dest = entry.installedPath || destinationForInstall(this.paths, entry, entry.sourcePath)
      if (entry.installedPath && fs.existsSync(entry.installedPath)) {
        storeRevision(this.paths, entry.installedPath, { faces: entry.faces, format: entry.format })
      }
      const staging = path.join(this.paths.dataRoot, 'staging', `${newId()}.bin`)
      fs.mkdirSync(path.dirname(staging), { recursive: true })
      fs.writeFileSync(staging, bytes)
      const staged = {
        stagedPath: staging,
        parsed: parseFontBuffer(bytes, revisionFormat),
        stat: readFileStat(staging),
      }
      const wasDeactivated = entry.status === 'deactivated'
      await commitInstalledFile({
        dest,
        stagedPath: staging,
        rollbackDir: path.join(this.paths.dataRoot, 'rollback'),
        native: getFontNative(),
      })
      applyInstalledMetadata(entry, dest, staged, {
        externalSource: isExternalSource(entry),
        fingerprint: target,
      })
      if (previousFingerprint && previousFingerprint !== target) {
        entry.previousRevisionId = previousFingerprint
      }
      if (wasDeactivated) {
        await ensureFontActivation(getFontNative(), dest, false)
        entry.status = 'deactivated'
      }
      setUpdateHold(entry, 'restore')
      applyEntryFacts(entry)
      if (
        entry.sourceFingerprint &&
        entry.installedFingerprint &&
        entry.sourceFingerprint !== entry.installedFingerprint &&
        entry.status === 'installed'
      ) {
        entry.status = 'outdated'
      }
      touchEntry(entry)
      saveCatalog(this.paths, catalog)
      const operation = finishOperation(
        createOperation({ trigger: 'restore', action: 'restore-revision', familyName: displayFamily(entry) }),
        [{
          id: newId(),
          entryId: entry.id,
          label: displayFamily(entry),
          outcome: 'succeeded',
          previousRevision: previousFingerprint,
        }],
      )
      upsertOperation(this.paths, operation)
      emitCatalog(this.paths)
      emitEvent({ type: 'operations', operations: loadOperations(this.paths) })
      return entry
    })
  }

  async undoOperation(id: string): Promise<BatchActionResult> {
    const operation = loadOperations(this.paths).find((item) => item.id === id)
    if (!operation) throw new Error('That activity item was not found.')
    if (operation.undone) {
      return this.batchFromOperation(operation)
    }
    if (!operation.undoable) {
      throw new Error('That action cannot be undone.')
    }
    const items: OperationItem[] = []
    const entries: CatalogEntry[] = []
    for (const item of operation.items) {
      if (item.outcome !== 'succeeded' || !item.entryId) continue
      const entry = findById(loadCatalog(this.paths), item.entryId)
      if (!entry) {
        items.push({ ...item, outcome: 'failed', reason: 'The font is no longer in the library.' })
        continue
      }
      try {
        if (operation.action === 'relink-source' && item.previousRevision) {
          entry.sourcePath = item.previousRevision
          applyEntryFacts(entry)
          saveCatalog(this.paths, (() => {
            const catalog = loadCatalog(this.paths)
            upsertEntry(catalog, entry)
            return catalog
          })())
          entries.push(entry)
        } else if (operation.action === 'restore-revision') {
          entries.push(
            item.previousRevision
              ? await this.restoreRevision(entry.id, item.previousRevision)
              : await this.uninstallAndHold(entry.id),
          )
        } else if (operation.action === 'reinstall' || operation.action === 'install-update') {
          if (item.previousRevision) {
            entries.push(await this.restoreRevision(entry.id, item.previousRevision))
          } else {
            entries.push(await this.uninstallAndHold(entry.id))
          }
        } else if (operation.action === 'apply-plan' || operation.action === 'install') {
          entries.push(
            item.previousRevision
              ? await this.restoreRevision(entry.id, item.previousRevision)
              : await this.uninstallAndHold(entry.id),
          )
        } else if (operation.action === 'deactivate') {
          entries.push(await this.activateEntry(entry.id, { owner: 'manual' }))
        } else if (operation.action === 'activate') {
          entries.push(await this.deactivateEntry(entry.id, { removeManualOwner: true }))
        } else if (operation.action === 'switch') {
          if (item.relatedEntryId) {
            entries.push(await this.switchToEntry(item.relatedEntryId))
          } else {
            entries.push(await this.deactivateEntry(entry.id, { removeManualOwner: true }))
          }
        } else if (operation.action === 'uninstall' && item.previousRevision) {
          entries.push(await this.restoreRevision(entry.id, item.previousRevision))
        }
        items.push({ ...item, outcome: 'succeeded' })
      } catch (error) {
        items.push({
          ...item,
          outcome: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
    markUndone(this.paths, id)
    emitCatalog(this.paths)
    const undo = finishOperation(
      createOperation({ trigger: 'undo', action: 'undo', idempotencyKey: `undo:${id}` }),
      items,
    )
    upsertOperation(this.paths, undo)
    emitEvent({ type: 'operations', operations: loadOperations(this.paths) })
    return { operationId: undo.id, ...operationCounts(undo), errors: [], entries, failedIds: [] }
  }

  async repair(
    ids: string[] = [],
    options: { caches?: boolean } = {},
  ): Promise<{ fonts: RepairItemResult[]; caches: RepairItemResult[] }> {
    const catalog = loadCatalog(this.paths)
    const targets = ids.length
      ? ids.map((id) => findById(catalog, id)).filter((entry): entry is CatalogEntry => Boolean(entry))
      : catalog.entries
    const fonts: RepairItemResult[] = []
    for (const entry of targets as CatalogEntry[]) {
      if (!entry || entry.previewOnly) continue
      if (entry.installedPath && fs.existsSync(entry.installedPath)) {
        try {
          await ensureFontActivation(
            getFontNative(),
            entry.installedPath,
            entry.status !== 'deactivated',
          )
          fonts.push({ target: displayFamily(entry), kind: 'font', outcome: 'succeeded' })
        } catch (error) {
          fonts.push({
            target: displayFamily(entry),
            kind: 'font',
            outcome: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      } else if (entry.previousRevisionId && readRevisionBytes(this.paths, entry.previousRevisionId)) {
        try {
          await this.restoreRevision(entry.id, entry.previousRevisionId)
          fonts.push({ target: displayFamily(entry), kind: 'font', outcome: 'succeeded' })
        } catch (error) {
          fonts.push({
            target: displayFamily(entry),
            kind: 'font',
            outcome: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      } else if (!entry.installedPath) {
        fonts.push({ target: displayFamily(entry), kind: 'font', outcome: 'not-found' })
      } else {
        fonts.push({ target: displayFamily(entry), kind: 'font', outcome: 'not-found', reason: 'Installed copy is missing.' })
      }
      const adobe = copyAt(entry, 'adobe-shared')
      if (adobe) {
        const dest = inspectDestination(this.paths, 'adobe-shared')
        adobe.verification = dest.supported
          ? verifyManagedCopy(this.paths, 'adobe-shared', adobe.path, adobe.fingerprint)
          : 'unavailable'
        fonts.push({
          target: `${displayFamily(entry)} · Adobe testing folder`,
          kind: 'font',
          outcome: dest.supported
            ? adobe.verification === 'file-present'
              ? 'succeeded'
              : 'not-found'
            : 'unavailable',
          reason: dest.supported ? adobe.verification === 'file-present' ? undefined : 'Adobe testing copy is missing.' : dest.reason,
        })
        saveCatalog(this.paths, catalog)
      }
    }
    const caches: RepairItemResult[] = []
    if (options.caches) {
      const ats = await getFontNative().clearUserFontCache()
      caches.push({
        target: 'ATS',
        kind: 'ats',
        outcome: ats.mac ? (ats.cleared ? 'succeeded' : 'not-found') : 'unavailable',
      })
      const office = await getFontNative().clearOfficeFontCache()
      caches.push({
        target: 'Office',
        kind: 'office',
        outcome: office.mac ? (office.cleared ? 'succeeded' : 'not-found') : 'unavailable',
      })
      const adobe = await getFontNative().clearAdobeFontCache()
      caches.push({
        target: 'Adobe',
        kind: 'adobe',
        outcome: adobe.mac ? (adobe.cleared ? 'succeeded' : 'not-found') : 'unavailable',
      })
    }
    this.commitManualOperation(
      'repair',
      [...fonts, ...caches].map((item) => ({
        id: crypto.randomUUID(),
        label: item.target,
        outcome:
          item.outcome === 'succeeded' ? 'succeeded' : item.outcome === 'failed' ? 'failed' : 'skipped',
        reason: item.reason ?? (item.outcome === 'succeeded' ? undefined : item.outcome),
      })),
    )
    return { fonts, caches }
  }

  listProjects(): ProjectSet[] {
    return loadProjects(this.paths)
  }

  async createProject(name: string, memberIds: string[] = []): Promise<ProjectSet> {
    const project = upsertProject(this.paths, createProject(name, memberIds))
    emitEvent({ type: 'projects', projects: loadProjects(this.paths) })
    return project
  }

  async updateProject(
    id: string,
    patch: { name?: string; memberIds?: string[]; pin?: { assetId: string; fingerprint?: string } },
  ): Promise<ProjectSet> {
    const projects = loadProjects(this.paths)
    const project = projects.find((item) => item.id === id)
    if (!project) throw new Error('That project was not found.')
    if (patch.name !== undefined) project.name = patch.name.trim() || 'Untitled project'
    if (patch.memberIds) {
      project.members = patch.memberIds.map((assetId) => {
        return project.members.find((member) => member.assetId === assetId) ?? { assetId }
      })
    }
    if (patch.pin) {
      const conflict = pinConflict(projects, patch.pin.assetId, patch.pin.fingerprint || '')
      if (conflict && conflict.id !== project.id && patch.pin.fingerprint) {
        throw new Error(`Pinned for ${conflict.name}. Deactivate that project or create a separate copy.`)
      }
      const member = project.members.find((item) => item.assetId === patch.pin!.assetId)
      if (member) member.pinFingerprint = patch.pin.fingerprint
    }
    upsertProject(this.paths, project)
    emitEvent({ type: 'projects', projects: loadProjects(this.paths) })
    return project
  }

  async deleteProject(id: string): Promise<void> {
    const project = removeProject(this.paths, id)
    if (!project) return
    const catalog = loadCatalog(this.paths)
    for (const member of project.members) {
      const entry = findById(catalog, member.assetId)
      if (!entry) continue
      removeProjectOwner(entry, id)
    }
    saveCatalog(this.paths, catalog)
    emitCatalog(this.paths)
    emitEvent({ type: 'projects', projects: loadProjects(this.paths) })
  }

  async activateProject(id: string): Promise<BatchActionResult> {
    const project = loadProjects(this.paths).find((item) => item.id === id)
    if (!project) throw new Error('That project was not found.')
    project.desiredActive = true
    upsertProject(this.paths, project)
    const items: OperationItem[] = []
    const entries: CatalogEntry[] = []
    const failedIds: string[] = []
    for (const member of project.members) {
      const entry = findById(loadCatalog(this.paths), member.assetId)
      if (!entry || entry.previewOnly) {
        items.push({
          id: newId(),
          entryId: member.assetId,
          label: entry ? displayFamily(entry) : member.assetId,
          outcome: entry?.previewOnly ? 'skipped' : 'failed',
          reason: entry ? 'Preview-only web font' : 'Missing member',
        })
        if (!entry) {
          setMemberUnsatisfied(project, member.assetId, true)
          failedIds.push(member.assetId)
        }
        continue
      }
      try {
        if (member.pinFingerprint && entry.installedFingerprint !== member.pinFingerprint) {
          await this.restoreRevision(entry.id, member.pinFingerprint)
        } else if (entry.status === 'uninstalled' || entry.status === 'source-missing') {
          await this.installEntry(entry.id)
        } else if (entry.status === 'deactivated') {
          await this.activateEntry(entry.id, { owner: 'project' })
        }
        const latest = findById(loadCatalog(this.paths), entry.id)
        if (latest) {
          addProjectOwner(latest, project.id)
          saveCatalog(this.paths, (() => {
            const catalog = loadCatalog(this.paths)
            upsertEntry(catalog, latest)
            return catalog
          })())
          entries.push(latest)
          setMemberUnsatisfied(project, member.assetId, false)
        }
        items.push({ id: newId(), entryId: entry.id, label: displayFamily(entry), outcome: 'succeeded' })
      } catch (error) {
        setMemberUnsatisfied(project, member.assetId, true)
        failedIds.push(entry.id)
        items.push({
          id: newId(),
          entryId: entry.id,
          label: displayFamily(entry),
          outcome: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
    upsertProject(this.paths, project)
    const operation = finishOperation(
      createOperation({ trigger: 'project', action: 'activate-project', familyName: project.name }),
      items,
    )
    upsertOperation(this.paths, operation)
    emitCatalog(this.paths)
    emitEvent({ type: 'projects', projects: loadProjects(this.paths) })
    emitEvent({ type: 'operations', operations: loadOperations(this.paths) })
    return { operationId: operation.id, ...operationCounts(operation), errors: [], entries, failedIds }
  }

  async deactivateProject(id: string): Promise<void> {
    const project = loadProjects(this.paths).find((item) => item.id === id)
    if (!project) throw new Error('That project was not found.')
    project.desiredActive = false
    const catalog = loadCatalog(this.paths)
    const toRelease: string[] = []
    for (const member of project.members) {
      const entry = findById(catalog, member.assetId)
      if (!entry) continue
      removeProjectOwner(entry, id)
      if (!hasActivationDemand(entry) && (entry.status === 'installed' || entry.status === 'outdated')) {
        toRelease.push(entry.id)
      }
    }
    saveCatalog(this.paths, catalog)
    upsertProject(this.paths, project)
    for (const entryId of toRelease) {
      await this.deactivate(entryId)
    }
    emitCatalog(this.paths)
    emitEvent({ type: 'projects', projects: loadProjects(this.paths) })
  }

  previewMeta(id: string, which: 'source' | 'installed' | 'revision' = 'installed', fingerprint?: string) {
    const entry = findById(loadCatalog(this.paths), id)
    if (!entry) throw new Error('Font is not in the library.')
    const filePath =
      which === 'revision' && fingerprint
        ? revisionFilePath(this.paths, fingerprint)
        : which === 'source'
          ? entry.sourcePath
          : entry.installedPath || entry.disabledPath || entry.sourcePath
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('No font file is available to preview.')
    }
    const parsed = parseFontFile(filePath)
    return {
      ...parsed,
      entryId: id,
      which,
      fingerprint: tryFingerprintFile(filePath),
    }
  }

  fontBytesForRevision(
    id: string,
    which: 'source' | 'installed' | 'revision' = 'installed',
    fingerprint?: string,
  ): { buffer: Buffer; mime: string; filename: string } {
    const entry = findById(loadCatalog(this.paths), id)
    if (!entry) throw new Error('Font is not in the library.')
    if (which === 'revision' && fingerprint) {
      const bytes = readRevisionBytes(this.paths, fingerprint)
      if (!bytes) throw new Error('That revision is no longer available.')
      return {
        buffer: bytes,
        mime: mimeForFont(entry.sourcePath),
        filename: `${fingerprint}${path.extname(entry.sourcePath) || '.ttf'}`,
      }
    }
    if (which === 'source' && entry.sourcePath && fs.existsSync(entry.sourcePath)) {
      return {
        buffer: fs.readFileSync(entry.sourcePath),
        mime: mimeForFont(entry.sourcePath),
        filename: path.basename(entry.sourcePath),
      }
    }
    return this.fontBytesForEntry(id)
  }

  revisionStorage() {
    const settings = loadSettings(this.paths)
    const pins = pinnedFingerprints(loadProjects(this.paths))
    const required = new Set(
      loadCatalog(this.paths)
        .entries.map((entry) => entry.previousRevisionId)
        .filter((value): value is string => Boolean(value)),
    )
    const evict = evictUnreferencedRevisions(this.paths, {
      budgetBytes: settings.revisionBudgetBytes,
      pinned: pins,
      required,
    })
    return {
      usedBytes: revisionUsageBytes(this.paths),
      budgetBytes: settings.revisionBudgetBytes,
      postponed: evict.postponed,
      evicted: evict.evicted,
    }
  }

  projectState(id: string) {
    const project = loadProjects(this.paths).find((item) => item.id === id)
    if (!project) throw new Error('That project was not found.')
    return projectActivationState(project, loadCatalog(this.paths).entries)
  }

  private batchFromOperation(operation: Operation): BatchActionResult {
    const counts = operationCounts(operation)
    return {
      operationId: operation.id,
      ...counts,
      errors: operation.items.filter((item) => item.reason).map((item) => item.reason!),
      entries: operation.items
        .map((item) => (item.entryId ? findById(loadCatalog(this.paths), item.entryId) : undefined))
        .filter((entry): entry is CatalogEntry => Boolean(entry)),
      failedIds: operation.items
        .filter((item) => item.outcome === 'failed' && item.entryId)
        .map((item) => item.entryId!),
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
          await ensureFontActivation(getFontNative(), dest, true)
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
    options?: InstallOptions,
  ): Promise<CatalogEntry> {
    let catalog = loadCatalog(this.paths)
    let entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (entry.previewOnly || isWebFontFormat(entry.format) || isWebFontFile(entry.sourcePath)) {
      throw new Error(WOFF_INSTALL_ERROR)
    }
    this.assertPinnedInstall(entry)
    if (!sourceFileExists(entry.sourcePath)) {
      applySourcePresence(entry)
      saveCatalog(this.paths, catalog)
      throw new Error('The source file is missing.')
    }
    assertExpectedSourceFingerprint(tryFingerprintFile(entry.sourcePath), options?.expectedSourceFingerprint)
    const renameTo = familyName?.trim()
    const installAs = Boolean(renameTo && renameTo !== displayFamily(entry))
    if (installAs && renameTo) {
      return this.installRenamedCopy(entry, renameTo, options)
    }
    const staged = stageFontFile(entry.sourcePath, path.join(this.paths.dataRoot, 'staging'))
    const targets = this.installTargets(entry, options)
    if (!options?.switch) {
      const siblings = occupyingSiblings(catalog.entries, entry, this.paths, targets)
      if (siblings[0]) {
        throw new Error(identityMutexMessage(siblings[0]))
      }
    }
    const installMacos = targets.includes('macos')
    let conflictSnapshots: Array<{ entry: CatalogEntry; file: string }> = []
    try {
      entry.format = staged.parsed.format
      entry.faces = staged.parsed.faces
      const conflicts = installMacos
        ? await this.resolveFormatConflicts(entry, catalog.entries, options?.replace)
        : []
      catalog = loadCatalog(this.paths)
      entry = findById(catalog, id)
      if (!entry) {
        throw new Error('Font is not in the library.')
      }
      entry.format = staged.parsed.format
      entry.faces = staged.parsed.faces
      if (
        installMacos &&
        entry.status === 'installed' &&
        entry.installedPath &&
        fs.existsSync(entry.installedPath) &&
        conflicts.length === 0 &&
        !targets.includes('adobe-shared')
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
      return await withMutationJournal(
        this.paths,
        {
          kind: options?.replace ? 'replace' : 'install',
          entries: [entry],
        },
        async () => {
      if (conflicts.length) {
        conflictSnapshots = await this.snapshotAndRemoveConflicts(conflicts)
        catalog = loadCatalog(this.paths)
        entry = findById(catalog, id)
        if (!entry) {
          throw new Error('Font is not in the library.')
        }
        entry.format = staged.parsed.format
        entry.faces = staged.parsed.faces
      }
      if (installMacos) {
        const dest = destinationForInstall(this.paths, entry, entry.sourcePath)
        const previousInstalled =
          entry.installedPath && path.resolve(entry.installedPath) !== dest
            ? entry.installedPath
            : undefined
        let retainedFingerprint: string | undefined
        if (entry.installedPath && fs.existsSync(entry.installedPath)) {
          const retained = storeRevision(this.paths, entry.installedPath, {
            faces: entry.faces,
            format: entry.format,
          })
          retainedFingerprint = retained?.fingerprint
        }
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
        if (retainedFingerprint) {
          entry.previousRevisionId = retainedFingerprint
        }
        if (!sourceFileExists(entry.sourcePath)) {
          entry.sourcePath = dest
        }
        const leftoverVault = entry.disabledPath
        const fingerprint = tryFingerprintFile(dest) ?? tryFingerprintFile(staged.stagedPath)
        applyInstalledMetadata(entry, dest, staged, {
          externalSource: isExternalSource(entry),
          fingerprint,
        })
        upsertCopy(entry, {
          destinationId: 'macos',
          path: dest,
          fingerprint,
          verification: 'file-present',
        })
        if (
          leftoverVault &&
          fs.existsSync(leftoverVault) &&
          path.resolve(leftoverVault) !== path.resolve(dest)
        ) {
          fs.rmSync(leftoverVault, { force: true })
        }
      }
      if (targets.includes('adobe-shared')) {
        try {
          this.placeAdobeCopy(entry, staged.stagedPath, staged.parsed.format, staged.parsed.faces)
        } catch (error) {
          if (!installMacos) throw error
          const existing = copyAt(entry, 'adobe-shared')
          if (existing) existing.verification = 'unavailable'
        }
      }
      if (!installMacos) {
        entry.faces = staged.parsed.faces
        entry.format = staged.parsed.format
        entry.status = 'installed'
        const fingerprint = tryFingerprintFile(staged.stagedPath)
        if (fingerprint) entry.installedFingerprint = fingerprint
        if (isExternalSource(entry)) {
          entry.sourceMtimeMs = staged.stat.mtimeMs
          entry.sourceSize = staged.stat.size
          entry.sourcePresent = true
          if (fingerprint) entry.sourceFingerprint = fingerprint
        }
      }
      if (entry.updateHold === 'relink-review') {
        entry.updateHold = null
      }
      applyEntryFacts(entry)
      touchEntry(entry)
      saveCatalog(this.paths, catalog)
      return entry
        },
      )
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
      this.assertNoOccupyingSibling(draft, catalog.entries)
      const conflicts = await this.resolveFormatConflicts(draft, catalog.entries, options?.replace)
      const conflictSnapshots = conflicts.length ? await this.snapshotAndRemoveConflicts(conflicts) : []
      try {
        return await withMutationJournal(
          this.paths,
          { kind: options?.replace ? 'replace' : 'install', entries: [sourceEntry] },
          async () => {
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
          },
        )
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

  private defaultDestinationFor(entry: CatalogEntry): DefaultDestinationId {
    const settings = loadSettings(this.paths)
    const folder = settings.folders.find((item) => item.id === entry.ownerFolderId)
    if (folder?.destinationId && folder.destinationId !== 'macos') {
      return folder.destinationId
    }
    return isDefaultDestinationId(settings.defaultDestination) ? settings.defaultDestination : 'macos'
  }

  private installTargets(entry: CatalogEntry, options?: InstallOptions): DestinationId[] {
    if (options?.destinationIds?.length) {
      return [...new Set(options.destinationIds)]
    }
    if (options?.destinationId) return [options.destinationId]
    const existing = (entry.installations ?? [])
      .map((item) => item.destinationId)
      .filter((item, index, all) => all.indexOf(item) === index)
    if (existing.length) return existing
    return targetsForDefaultDestination(this.defaultDestinationFor(entry))
  }

  private placeAdobeCopy(
    entry: CatalogEntry,
    stagedPath: string,
    format: string,
    faces: CatalogEntry['faces'],
  ): void {
    const capability = inspectDestination(this.paths, 'adobe-shared')
    if (!capability.supported) {
      throw new Error(capability.remedy || capability.reason || 'The Adobe testing folder is not available.')
    }
    const managed = (entry.installations ?? [])
      .filter((item) => item.destinationId === 'adobe-shared')
      .map((item) => item.path)
    const conflicts = findUnmanagedConflicts(this.paths, 'adobe-shared', faces, managed)
    if (conflicts[0]) {
      throw new Error(conflicts[0].reason)
    }
    const dest =
      copyAt(entry, 'adobe-shared')?.path ??
      plannedManagedPath(this.paths, 'adobe-shared', entry.sourcePath, format)
    const leftoverParked = copyAt(entry, 'adobe-shared')?.parkedPath
    const written = writeManagedCopy({
      paths: this.paths,
      destinationId: 'adobe-shared',
      stagedPath,
      dest,
      rollbackDir: path.join(this.paths.dataRoot, 'rollback'),
    })
    upsertCopy(entry, {
      destinationId: 'adobe-shared',
      path: written,
      fingerprint: tryFingerprintFile(written),
      verification: 'file-present',
    })
    if (
      leftoverParked &&
      fs.existsSync(leftoverParked) &&
      path.resolve(leftoverParked) !== path.resolve(written)
    ) {
      fs.rmSync(leftoverParked, { force: true })
    }
  }

  private removeAdobeCopy(entry: CatalogEntry): void {
    const existing = copyAt(entry, 'adobe-shared')
    if (!existing) return
    try {
      removeManagedCopy(this.paths, 'adobe-shared', existing.path)
    } catch {
      // The destination may already be gone; keep the catalog recoverable.
    }
    dropCopy(entry, 'adobe-shared')
  }

  async removeDestinationCopy(id: string, destinationId: DestinationId): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const catalog = loadCatalog(this.paths)
      const entry = findById(catalog, id)
      if (!entry) throw new Error('Font is not in the library.')
      if (destinationId === 'macos') {
        await removeInstalledCopy(entry)
        dropCopy(entry, 'macos')
        if (!copyAt(entry, 'adobe-shared')) {
          entry.status = sourceFileExists(entry.sourcePath) && isExternalSource(entry) ? 'uninstalled' : entry.status
        }
      } else {
        this.removeAdobeCopy(entry)
      }
      applyEntryFacts(entry)
      touchEntry(entry)
      if (findById(catalog, entry.id)) {
        saveCatalog(this.paths, catalog)
      }
      this.commitManualOperation(
        'uninstall',
        [this.operationItem(entry, 'succeeded')],
        displayFamily(entry),
        false,
      )
      emitCatalog(this.paths)
      return entry
    })
  }

  private async uninstallAndHold(id: string): Promise<CatalogEntry> {
    const entry = await this.uninstallEntry(id)
    setUpdateHold(entry, 'undo-install')
    const catalog = loadCatalog(this.paths)
    if (findById(catalog, entry.id)) {
      upsertEntry(catalog, entry)
      saveCatalog(this.paths, catalog)
    }
    return entry
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
    this.assertPinnedInstall(entry)
    const sourcePath = entry.sourcePath
    const hasSource = isExternalSource(entry) && sourceFileExists(sourcePath)
    const deleteSource = Boolean(options?.deleteSource && hasSource)
    await removeInstalledCopy(entry)
    this.removeAdobeCopy(entry)
    entry.installations = []
    entry.destinationId = undefined
    removeManualOwner(entry)
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

  private isLiveDestPath(filePath: string): boolean {
    if (isUnderAnyRoot(filePath, [this.paths.disabledDir])) return false
    return isUnderAnyRoot(filePath, [
      this.paths.installDir,
      this.paths.userFontsDir,
      this.paths.adobeFontsDir,
    ])
  }

  private assertNoOccupyingSibling(
    entry: CatalogEntry,
    catalog: CatalogEntry[],
    dests?: DestinationId[],
  ): void {
    const siblings = occupyingSiblings(catalog, entry, this.paths, dests)
    if (siblings[0]) {
      throw new Error(identityMutexMessage(siblings[0]))
    }
  }

  private async parkManagedCopies(entry: CatalogEntry): Promise<void> {
    fs.mkdirSync(this.paths.disabledDir, { recursive: true })
    const macosLive =
      entry.installedPath &&
      fs.existsSync(entry.installedPath) &&
      this.isLiveDestPath(entry.installedPath)
        ? path.resolve(entry.installedPath)
        : undefined
    if (macosLive) {
      await ensureFontActivation(getFontNative(), macosLive, false)
      await getFontNative().unregisterFont(macosLive)
      const vault = uniquePathFromOriginal(this.paths.disabledDir, macosLive)
      if (path.resolve(macosLive) !== vault) {
        fs.mkdirSync(path.dirname(vault), { recursive: true })
        fs.renameSync(macosLive, vault)
      }
      const macos = copyAt(entry, 'macos')
      entry.disabledPath = vault
      entry.installedPath = macosLive
      upsertCopy(entry, {
        destinationId: 'macos',
        path: macosLive,
        parkedPath: vault,
        fingerprint: macos?.fingerprint ?? entry.installedFingerprint,
        verification: 'unavailable',
      })
    }
    const adobe = copyAt(entry, 'adobe-shared')
    if (
      adobe?.path &&
      !adobe.parkedPath &&
      fs.existsSync(adobe.path) &&
      this.isLiveDestPath(adobe.path)
    ) {
      const original = path.resolve(adobe.path)
      const vault = uniquePathFromOriginal(this.paths.disabledDir, original)
      if (original !== vault) {
        fs.mkdirSync(path.dirname(vault), { recursive: true })
        fs.renameSync(original, vault)
      }
      upsertCopy(entry, {
        destinationId: 'adobe-shared',
        path: original,
        parkedPath: vault,
        fingerprint: adobe.fingerprint,
        verification: 'unavailable',
      })
    }
    entry.status = 'deactivated'
    applyEntryFacts(entry)
  }

  private async unparkManagedCopies(
    entry: CatalogEntry,
    dests?: DestinationId[],
  ): Promise<void> {
    const targets = dests?.length ? dests : (['macos', 'adobe-shared'] as DestinationId[])
    if (targets.includes('macos') && entry.disabledPath && fs.existsSync(entry.disabledPath)) {
      const restoreToComputer =
        isComputerOrigin(entry.sourcePath, this.paths) && !fs.existsSync(entry.sourcePath)
      let dest = restoreToComputer
        ? path.resolve(entry.sourcePath)
        : entry.installedPath && !isUnderAnyRoot(entry.installedPath, [this.paths.disabledDir])
          ? path.resolve(entry.installedPath)
          : destinationForInstall(this.paths, entry, entry.disabledPath, { reuseInstalled: false })
      if (restoreToComputer && fs.existsSync(dest) && !sameFile(dest, entry.disabledPath)) {
        dest = uniqueSiblingPath(dest)
      }
      if (path.resolve(entry.disabledPath) !== dest) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        if (fs.existsSync(dest) && !sameFile(dest, entry.disabledPath)) {
          throw new Error(IDENTITY_MUTEX_MESSAGE)
        }
        fs.renameSync(entry.disabledPath, dest)
      }
      try {
        await ensureFontActivation(getFontNative(), dest, true)
      } catch (error) {
        if (restoreToComputer && dest !== entry.disabledPath && fs.existsSync(dest)) {
          fs.renameSync(dest, entry.disabledPath)
        }
        throw error
      }
      entry.installedPath = dest
      entry.disabledPath = undefined
      if (restoreToComputer) {
        entry.sourcePath = dest
      }
      upsertCopy(entry, {
        destinationId: 'macos',
        path: dest,
        fingerprint: entry.installedFingerprint,
        verification: 'file-present',
      })
    }
    if (targets.includes('adobe-shared')) {
      const adobe = copyAt(entry, 'adobe-shared')
      if (adobe?.parkedPath && fs.existsSync(adobe.parkedPath)) {
        const dest = adobe.path
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        if (path.resolve(adobe.parkedPath) !== path.resolve(dest)) {
          if (fs.existsSync(dest) && !sameFile(dest, adobe.parkedPath)) {
            throw new Error(IDENTITY_MUTEX_MESSAGE)
          }
          fs.renameSync(adobe.parkedPath, dest)
        }
        upsertCopy(entry, {
          destinationId: 'adobe-shared',
          path: dest,
          fingerprint: adobe.fingerprint,
          verification: 'file-present',
        })
      }
    }
    if (occupiedDestinations(entry, this.paths).length > 0) {
      entry.status = 'installed'
      entry.sourcePresent = isExternalSource(entry)
    }
  }

  private async switchToEntry(id: string): Promise<CatalogEntry> {
    let catalog = loadCatalog(this.paths)
    let entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    const siblings = occupyingSiblings(catalog.entries, entry, this.paths)
    if (siblings.length === 0) {
      return this.activateEntry(id, { owner: 'manual', switch: true })
    }
    const destSet = [
      ...new Set(siblings.flatMap((sibling) => occupiedDestinations(sibling, this.paths))),
    ]
    return withMutationJournal(
      this.paths,
      { kind: 'switch', entries: [entry, ...siblings] },
      async () => {
    const parkedIds: string[] = []
    try {
      for (const sibling of siblings) {
        catalog = loadCatalog(this.paths)
        const latest = findById(catalog, sibling.id)
        if (!latest) continue
        await this.parkManagedCopies(latest)
        touchEntry(latest)
        saveCatalog(this.paths, catalog)
        parkedIds.push(latest.id)
      }
      await this.clearCachesAfterInstall()
      catalog = loadCatalog(this.paths)
      entry = findById(catalog, id)
      if (!entry) {
        throw new Error('Font is not in the library.')
      }
      const incomingDests = recordedDestinationIds(entry)
      const macosParked = Boolean(entry.disabledPath && fs.existsSync(entry.disabledPath))
      const adobeParked = Boolean(
        copyAt(entry, 'adobe-shared')?.parkedPath &&
          fs.existsSync(copyAt(entry, 'adobe-shared')!.parkedPath!),
      )
      let installed: CatalogEntry
      if (macosParked || adobeParked) {
        await this.unparkManagedCopies(entry, incomingDests)
        const missing = incomingDests.filter((dest) => !occupiesDestination(entry, dest, this.paths))
        if (missing.length && sourceFileExists(entry.sourcePath)) {
          installed = await this.installEntry(id, undefined, {
            switch: true,
            destinationIds: missing,
          })
        } else {
          applyEntryFacts(entry)
          touchEntry(entry)
          saveCatalog(this.paths, catalog)
          installed = entry
        }
      } else {
        installed = await this.installEntry(id, undefined, {
          switch: true,
          destinationIds: incomingDests,
        })
      }
      catalog = loadCatalog(this.paths)
      const leftover = occupyingSiblings(catalog.entries, installed, this.paths)
      if (leftover[0]) {
        throw new Error(identityMutexMessage(leftover[0]))
      }
      return findById(catalog, installed.id) ?? installed
    } catch (error) {
      const partial = findById(loadCatalog(this.paths), id)
      if (partial && occupiedDestinations(partial, this.paths).length) {
        try {
          const catalog = loadCatalog(this.paths)
          const current = findById(catalog, id)
          if (current) {
            await this.parkManagedCopies(current)
            touchEntry(current)
            saveCatalog(this.paths, catalog)
          }
        } catch {
          // Incoming copy must leave live dests before restoring the previous active sibling.
        }
      }
      for (const parkedId of parkedIds) {
        const catalog = loadCatalog(this.paths)
        const current = findById(catalog, parkedId)
        if (!current) continue
        try {
          await this.unparkManagedCopies(current, destSet)
          current.status = 'installed'
          touchEntry(current)
          saveCatalog(this.paths, catalog)
        } catch {
          // Restore is best-effort; the original error is more useful.
        }
      }
      throw error
    }
      },
    )
  }

  private async deactivateEntry(
    id: string,
    options: { removeManualOwner?: boolean } = {},
  ): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    const live =
      occupiedDestinations(entry, this.paths).length > 0 ||
      Boolean(entry.installedPath && fs.existsSync(entry.installedPath) && this.isLiveDestPath(entry.installedPath)) ||
      Boolean(
        copyAt(entry, 'adobe-shared')?.path &&
          fs.existsSync(copyAt(entry, 'adobe-shared')!.path) &&
          this.isLiveDestPath(copyAt(entry, 'adobe-shared')!.path),
      )
    if (!live) {
      throw new Error('This font is not installed.')
    }
    return withMutationJournal(this.paths, { kind: 'park', entries: [entry] }, async () => {
    await this.parkManagedCopies(entry)
    if (options.removeManualOwner) {
      entry.activationOwners = (entry.activationOwners ?? []).filter(
        (owner) => owner.kind !== 'manual',
      )
    }
    touchEntry(entry)
    saveCatalog(this.paths, catalog)
    return entry
    })
  }

  private async activateEntry(
    id: string,
    options: { replace?: boolean; owner?: 'manual' | 'project'; switch?: boolean } = {},
  ): Promise<CatalogEntry> {
    let catalog = loadCatalog(this.paths)
    let entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (!options.switch) {
      this.assertNoOccupyingSibling(entry, catalog.entries)
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
      const parked =
        Boolean(entry.disabledPath && fs.existsSync(entry.disabledPath)) ||
        Boolean(copyAt(entry, 'adobe-shared')?.parkedPath && fs.existsSync(copyAt(entry, 'adobe-shared')!.parkedPath))
      if (parked) {
        await this.unparkManagedCopies(entry)
        if (options.owner === 'manual') {
          addManualOwner(entry)
        }
        entry.status = 'installed'
        entry.sourcePresent = isExternalSource(entry)
        touchEntry(entry)
        saveCatalog(this.paths, catalog)
        return entry
      }
      if (entry.installedPath && fs.existsSync(entry.installedPath) && this.isLiveDestPath(entry.installedPath)) {
        await ensureFontActivation(getFontNative(), entry.installedPath, true)
        catalog = loadCatalog(this.paths)
        entry = findById(catalog, id)
        if (!entry) {
          throw new Error('Font is not in the library.')
        }
        if (options.owner === 'manual') {
          addManualOwner(entry)
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

  private async reinstallEntry(id: string, options?: InstallOptions): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (entry.status === 'deactivated') {
      return this.activateEntry(id, { owner: 'manual' })
    }
    await this.clearCachesAfterInstall()
    const updated = await this.installEntry(id, entry.customFamilyName, options)
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
    this.removeAdobeCopy(entry)
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
      (entry) =>
        !entry.previewOnly &&
        entry.status !== 'installed' &&
        entry.status !== 'source-missing',
    )
    for (const entry of pending) {
      if (entry.status === 'deactivated') {
        const siblings = occupyingSiblings(loadCatalog(this.paths).entries, entry, this.paths)
        if (siblings.length) {
          await this.switchToEntry(entry.id)
        } else {
          await this.activateEntry(entry.id)
        }
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

  private importOneUnlocked(
    filePath: string,
    options: { forceNew?: boolean } = {},
  ): CatalogEntry {
    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error('Not a file.')
    }
    const previewOnly = isWebFontFile(resolved)
    if (!previewOnly) {
      assertNotWebFont(resolved)
    }
    if (!isFontFile(resolved) && !isPreviewableFontFile(resolved)) {
      throw new Error('Not a font file.')
    }
    const parsed = parseFontFile(resolved)
    if (parsed.faces.length === 0) {
      throw new Error('Could not read any faces in that font.')
    }
    if (isWebFontFormat(parsed.format)) {
      // Parsed content wins over a misleading extension.
    }
    const catalog = loadCatalog(this.paths)
    const fingerprint = tryFingerprintFile(resolved)
    const samePath =
      findByInstalledPath(catalog, resolved) ?? findBySourcePath(catalog, resolved)
    const sameBytes = fingerprint
      ? catalog.entries.find(
          (item) => item.sourceFingerprint === fingerprint || item.installedFingerprint === fingerprint,
        )
      : undefined
    const existing = options.forceNew ? samePath : (samePath ?? sameBytes)
    const stat = readFileStat(resolved)
    const inUserFonts = isUnderAnyRoot(resolved, [this.paths.userFontsDir, this.paths.installDir])
    const settings = loadSettings(this.paths)
    const owner = mostSpecificOwner(settings.folders, resolved)
    if (existing) {
      if (samePath && inUserFonts && !existing.installedPath) {
        existing.installedPath = resolved
        existing.status = 'installed'
      }
      existing.faces = parsed.faces
      existing.format = parsed.format
      if (fingerprint) existing.sourceFingerprint = existing.sourceFingerprint ?? fingerprint
      if (!inUserFonts || isExternalSource(existing)) {
        existing.sourceMtimeMs = stat.mtimeMs
        existing.sourceSize = stat.size
      }
      if (
        samePath &&
        existing.status === 'installed' &&
        isExternalSource(existing) &&
        fingerprint &&
        existing.installedFingerprint &&
        fingerprint !== existing.installedFingerprint
      ) {
        existing.status = 'outdated'
      } else if (
        samePath &&
        existing.status === 'installed' &&
        isExternalSource(existing) &&
        (stat.mtimeMs !== existing.installedSnapshotMtimeMs ||
          stat.size !== existing.installedSnapshotSize)
      ) {
        existing.status = 'outdated'
      }
      applyEntryFacts(existing)
      touchEntry(existing)
      saveCatalog(this.paths, catalog)
      return existing
    }
    const web = previewOnly || isWebFontFormat(parsed.format)
    const entry: CatalogEntry = {
      id: newId(),
      sourcePath: resolved,
      sourceMtimeMs: stat.mtimeMs,
      sourceSize: stat.size,
      sourcePresent: !inUserFonts,
      sourceFingerprint: fingerprint,
      installedFingerprint: inUserFonts ? fingerprint : undefined,
      ownerFolderId: owner?.id ?? null,
      previewOnly: web,
      status: web ? 'uninstalled' : inUserFonts ? 'installed' : 'uninstalled',
      installedPath: web ? undefined : inUserFonts ? resolved : undefined,
      faces: parsed.faces,
      format: parsed.format,
      addedAt: now(),
      updatedAt: now(),
    }
    applyEntryFacts(entry)
    upsertEntry(catalog, entry)
    saveCatalog(this.paths, catalog)
    return entry
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
      const fingerprint = tryFingerprintFile(entry.sourcePath)
      if (fingerprint) {
        entry.sourceFingerprint = fingerprint
      }
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
      const bytesDiffer = fingerprint && entry.installedFingerprint
        ? fingerprint !== entry.installedFingerprint
        : stat.mtimeMs !== entry.installedSnapshotMtimeMs ||
          stat.size !== entry.installedSnapshotSize
      if (entry.status === 'installed' && bytesDiffer && !entry.updateHold) {
        entry.status = 'outdated'
        touchEntry(entry)
        changed = true
      }
    }
    if (changed) {
      saveCatalog(this.paths, catalog)
    }
  }

  private activeProjectPin(id: string): { project: ProjectSet; fingerprint: string } | undefined {
    for (const project of loadProjects(this.paths)) {
      if (!project.desiredActive) continue
      const member = project.members.find((item) => item.assetId === id)
      if (member?.pinFingerprint) {
        return { project, fingerprint: member.pinFingerprint }
      }
    }
    return undefined
  }

  private assertPinnedInstall(entry: CatalogEntry): void {
    const pin = this.activeProjectPin(entry.id)
    if (!pin || !entry.installedFingerprint) return
    throw new Error(`Pinned for ${pin.project.name}. Deactivate that project before installing an update.`)
  }

  private queueAutoReinstall(id: string): void {
    const settings = loadSettings(this.paths)
    const entry = findById(loadCatalog(this.paths), id)
    if (!entry) return
    const folder = settings.folders.find((item) => item.id === entry.ownerFolderId)
    if (this.activeProjectPin(id) || !canAutomateUpdates(entry, folder, settings.autoReinstallOnUpdate)) {
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
    const settings = loadSettings(this.paths)
    const ids = loadCatalog(this.paths)
      .entries.filter((entry) => {
        const folder = settings.folders.find((item) => item.id === entry.ownerFolderId)
        return (
          entry.status === 'outdated' &&
          !this.activeProjectPin(entry.id) &&
          canAutomateUpdates(entry, folder, settings.autoReinstallOnUpdate)
        )
      })
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

  private watchingFolderRoots(settings = loadSettings(this.paths)): string[] {
    return settings.folders.filter((folder) => folder.watching).map((folder) => folder.root)
  }

  private async refreshInboxWatcher(
    folders: string[],
    options: { importExisting: boolean },
  ): Promise<void> {
    await syncInboxWatcher(folders, (filePaths) => {
      void this.importInboxFiles(filePaths)
    })
    if (options.importExisting && folders.length) {
      const settings = loadSettings(this.paths)
      const known = new Set(
        this.listCatalog().map((entry) => path.resolve(entry.sourcePath)),
      )
      const discovered = [
        ...new Set(
          settings.folders
            .filter((folder) => folder.watching && !folder.paused)
            .flatMap((folder) =>
              listInboxFontFiles(folder.root).filter((filePath) => !isExcluded(folder, filePath)),
            ),
        ),
      ].filter((filePath) => !known.has(filePath))
      if (discovered.length) {
        await this.importInboxFiles(discovered)
      }
    }
  }

  private async importInboxFiles(filePaths: string[]): Promise<void> {
    const settings = loadSettings(this.paths)
    const allowed = filePaths.filter((filePath) => {
      const folder = folderForPath(settings.folders, filePath)
      if (!folder) return true
      if (!folder.watching) return false
      return true
    })
    const catalog = loadCatalog(this.paths)
    const auto: string[] = []
    let notified = 0
    for (const filePath of allowed) {
      const item = classifyImportFile(filePath, catalog, { paths: this.paths })
      if (isWatchIdentityDuplicate(item)) {
        const occupying = occupyingSiblingsForIncoming(
          catalog.entries,
          item.faces ?? [],
          item.format,
          this.paths,
        )
        const { notify } = upsertDuplicateWarning(this.paths, {
          path: item.path,
          fingerprint: item.fingerprint,
          familyName: item.familyName,
          format: item.format,
          incomingVersion: item.incomingVersion,
          conflictingEntryIds: [
            ...new Set([
              ...occupying.map((entry) => entry.id),
              ...(item.siblingEntryIds ?? []),
              ...(item.entryId ? [item.entryId] : []),
            ]),
          ],
          activeEntryId: occupying[0]?.id ?? item.entryId,
          folderId: folderForPath(settings.folders, filePath)?.id,
          notifyKey: duplicateNotifyKey(
            item.path,
            item.fingerprint,
            occupying.map((entry) => entry.installedFingerprint ?? entry.sourceFingerprint ?? '').filter(Boolean),
          ),
        })
        if (notify) notified += 1
        continue
      }
      auto.push(filePath)
    }
    emitDuplicates(this.paths)
    if (notified > 0) {
      emitNotice({
        kind: 'info',
        message:
          notified === 1
            ? 'A watch-folder duplicate needs review before anything is installed.'
            : `${notified} watch-folder duplicates need review before anything is installed.`,
      })
    }
    if (auto.length === 0) {
      return
    }
    const beforeIds = new Set(this.listCatalog().map((entry) => entry.id))
    const result = await this.importPaths(auto)
    const added = result.entries.filter((entry) => !beforeIds.has(entry.id))
    const installed: CatalogEntry[] = []
    for (const entry of added) {
      if (entry.previewOnly || entry.status === 'installed' || entry.status === 'source-missing') {
        continue
      }
      const folder = settings.folders.find((item) => item.id === entry.ownerFolderId)
      if (folder && (folder.paused || isExcluded(folder, entry.sourcePath))) {
        continue
      }
      const installNew = folder ? folder.installNew : settings.installWatchFolderFonts
      if (!installNew) continue
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
      if (entry.status !== 'deactivated') {
        entry.status = 'deactivated'
        changed = true
      }
      if (isComputerOrigin(entry.sourcePath, this.paths) && entry.sourcePresent !== false) {
        entry.sourcePresent = false
        changed = true
      }
    }
    if (changed) {
      saveCatalog(this.paths, catalog)
    }
  }

  private async adoptUserFonts(): Promise<void> {
    const files = listFontFilesInTree(this.paths.userFontsDir)
    const catalog = loadCatalog(this.paths)
    const activation = await getFontNative().fontActivationStates(files)
    let changed = false

    for (const filePath of files) {
      const resolved = path.resolve(filePath)
      const existing =
        findByInstalledPath(catalog, resolved) ??
        findBySourcePath(catalog, resolved) ??
        (() => {
          try {
            const parsed = parseFontFile(resolved)
            const occupying = occupyingSiblingsForIncoming(
              catalog.entries,
              parsed.faces,
              parsed.format,
              this.paths,
            )
            const owner = occupying.find(
              (entry) => entry.installedPath && path.resolve(entry.installedPath) === resolved,
            )
            if (owner) return owner
            return findAllByFaceIdentity(catalog, parsed.faces, parsed.format).find(
              (entry) => !entryHasParkedBytes(entry),
            )
          } catch {
            return undefined
          }
        })()
      const queriedOn = activation.ok
        ? (activation.states[resolved] ?? activation.states[filePath])
        : undefined
      const isOn = queriedOn ?? (existing ? existing.status !== 'deactivated' : true)
      if (existing) {
        if (entryHasParkedBytes(existing)) {
          continue
        }
        if (!existing.installedPath || !fs.existsSync(existing.installedPath)) {
          existing.installedPath = resolved
          existing.disabledPath = undefined
          existing.status = isOn ? 'installed' : 'deactivated'
          existing.sourcePresent = isExternalSource(existing)
          touchEntry(existing)
          changed = true
        } else if (path.resolve(existing.installedPath) === resolved) {
          if (queriedOn !== undefined && isOn && existing.status === 'deactivated') {
            existing.status = 'installed'
            touchEntry(existing)
            changed = true
          } else if (
            queriedOn !== undefined &&
            !isOn &&
            (existing.status === 'installed' || existing.status === 'outdated')
          ) {
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
      if (entryHasParkedBytes(entry)) {
        continue
      }
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

  private operationItem(
    entry: CatalogEntry,
    outcome: OperationItem['outcome'],
    reason?: string,
  ): OperationItem {
    return {
      id: crypto.randomUUID(),
      entryId: entry.id,
      label: displayFamily(entry),
      outcome,
      reason,
      previousRevision: entry.previousRevisionId,
    }
  }

  private retainInstalledRevision(id: string): string | undefined {
    const entry = findById(loadCatalog(this.paths), id)
    if (!entry) return undefined
    if (entry.installedFingerprint && readRevisionBytes(this.paths, entry.installedFingerprint)) {
      return entry.installedFingerprint
    }
    if (!entry.installedPath || !fs.existsSync(entry.installedPath)) return undefined
    return storeRevision(this.paths, entry.installedPath, {
      faces: entry.faces,
      format: entry.format,
    })?.fingerprint
  }

  private commitManualOperation(
    action: string,
    items: OperationItem[],
    familyName?: string,
    undoable = true,
  ) {
    if (items.length === 0) return
    const operation = finishOperation(
      createOperation({ trigger: 'manual', action, familyName }),
      items,
    )
    if (!undoable) operation.undoable = false
    upsertOperation(this.paths, operation)
    emitEvent({ type: 'operations', operations: loadOperations(this.paths) })
  }
}

function isProtectedSystem(filePath: string, paths: AppPaths): boolean {
  return isUnderAnyRoot(filePath, [paths.systemFontsDir, '/usr/share/fonts'])
}

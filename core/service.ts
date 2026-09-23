import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  applySourcePresence,
  findById,
  findByInstalledPath,
  findBySourcePath,
  isExternalSource,
  loadCatalog,
  occupantsAtPath,
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
  createAdobeTestingFolder as createAdobeTestingFolderFn,
  dropCopy,
  entryHasParkedBytes,
  inspectDestination,
  installDestinationRoots,
  isDefaultDestinationId,
  listDestinations,
  recordedDestinationIds,
  upsertCopy,
  verifyManagedCopy,
} from './destinations.ts'
import { MAX_UPLOAD_BATCH_BYTES, MAX_UPLOAD_BYTES } from './constants.ts'
import { familyProgressReporter } from './batch-progress.ts'
import {
  duplicateNotifyKey,
  loadDuplicates,
  pruneStaleDuplicates,
  removeDuplicateWarning,
  upsertDuplicateWarning,
} from './duplicates.ts'
import { emitEvent } from './events.ts'
import { unregisterSessionFonts } from './session-fonts.ts'
import {
  deleteTestInstallFiles,
  resolveTestInstallFileInDirs,
  scanTestInstallDirs,
  startTestInstallWatches,
  testInstallDirs,
  type TestInstallFont,
} from './test-install.ts'
import {
  IDENTITY_MUTEX_MESSAGE,
  identityMutexMessage,
  matchesIncomingIdentity,
  occupiedDestinations,
  occupiesDestination,
  occupyingSiblings,
  occupyingSiblingsForIncoming,
} from './identity.ts'
import {
  assertSingleInstallableFormat,
  formatConflictMessage,
  installedFormatConflicts,
  WOFF_INSTALL_ERROR,
} from './formats.ts'
import {
  commitInstalledFile,
  removeStagedFile,
  uniquePathFromOriginal,
  uniqueSiblingPath,
} from './install.ts'
import { yieldEventLoop } from './event-loop.ts'
import { ensureFontActivation, getFontNative } from './native.ts'
import {
  analysisFromPlanItem,
  analyzeFontFile,
  rememberFontAnalysis,
  type FontAnalysis,
} from './font-analysis.ts'
import { fingerprintFile, tryFingerprintFile } from './fingerprint.ts'
import {
  reconcileMutationJournals,
  recordMutationDestination,
  withMutationJournal,
} from './journal.ts'
import {
  applyFolderPatch,
  createWatchFolder,
  inspectFolderAvailability,
  isExcluded,
  syncWatchFolderPaths,
} from './folders.ts'
import {
  createOperation,
  findOperationByIdempotency,
  finishOperation,
  clearOperations,
  loadOperations,
  markAllOperationsRead,
  markOperationsUnread,
  markUndone,
  operationCounts,
  pruneOperations,
  upsertOperation,
} from './operations.ts'
import {
  glyphNameForCodePoint,
  isFontFile,
  isPreviewableFontFile,
  mimeForFont,
  parseFontBuffer,
  applyParsedFont,
  existingFontPath,
  fillEntryPreviewSample,
  parseFontFile,
  previewUsesInstalledBytes,
  readFileStat,
} from './parse.ts'
import { isUnderAnyRoot } from './containment.ts'
import {
  buildImportPlan,
  catalogRevision,
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
  removeProject,
  removeProjectOwner,
  setMemberUnsatisfied,
  upsertProject,
} from './projects.ts'
import { inspectFolderRelink as previewFolderRelink, inspectRelinkCandidate } from './relink.ts'
import {
  evictUnreferencedRevisions,
  isRevisionFingerprint,
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
  eligibleForDeactivate,
  eligibleForInstall,
  eligibleForReinstall,
  isCleanupEligible,
  setUpdateHold,
} from './state.ts'
import { postscriptPreview } from './rename.ts'
import { revealInFileManager } from './reveal.ts'
import { loadSettings, saveSettings } from './settings.ts'
import { isAppIconStyle } from '../shared/appIcon.ts'
import { parseLatinPreview } from '../shared/latinPreview.ts'
import { normalizeSavedFilters } from './saved-filters.ts'
import { allowedFontPath, scanSystemFonts } from './system.ts'
import type {
  AdobeFontCacheInfo,
  AppSettings,
  BatchActionResult,
  BatchProgressAction,
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

function existingManagedFontPath(
  entry: CatalogEntry,
  which: 'source' | 'installed' = 'installed',
  catalog: CatalogEntry[] = [],
): string | undefined {
  const candidates = which === 'source'
    ? [entry.sourcePath]
    : (() => {
        const parked = [
          entry.disabledPath,
          ...(entry.installations ?? []).map((copy) => copy.parkedPath),
        ]
        const live = [
          entry.installedPath,
          entry.installations?.find((copy) => copy.destinationId === 'macos')?.path,
          entry.installations?.find((copy) => copy.destinationId === 'adobe-shared')?.path,
        ]
        const fallback = [entry.sourcePath]
        return parkedBytesPath(entry)
          ? [...parked, ...live, ...fallback]
          : [...live, ...parked, ...fallback]
      })()
  const seen = new Set<string>()
  return candidates.find((candidate) => {
    if (!candidate) return false
    const resolved = path.resolve(candidate)
    if (seen.has(resolved)) return false
    seen.add(resolved)
    try {
      if (!fs.statSync(resolved).isFile()) return false
    } catch {
      return false
    }
    if (catalog.length && livePathOccupiedByOther(catalog, resolved, entry.id)) return false
    return true
  })
}

function uniqueResolvedFiles(filePaths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const filePath of filePaths) {
    const resolved = path.resolve(filePath)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    out.push(resolved)
  }
  return out
}

const REMEMBERED_DECISIONS_LIMIT = 256
const APPLY_PLAN_EMIT_EVERY = 16

async function yieldDuringBulkImport(_index?: number): Promise<void> {
  await yieldEventLoop()
}

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
import {
  bindEntryToInstalledFile,
  deleteSourceFile,
  displayEntry,
  displayEntryLabel,
  displayFamily,
  emitCatalog,
  catalogEvent,
  emitDuplicates,
  emitNotice,
  livePathOccupiedByOther,
  newId,
  now,
  parkedBytesPath,
  removeInstalledCopy,
  touchEntry,
} from './service-helpers.ts'
import {
  destinationForInstall,
  placeAdobeCopy,
  removeAdobeCopy as removeAdobeCopyFn,
  sameFile,
} from './service-destinations.ts'
import { importInboxFiles as importInboxFilesFn, importOneUnlocked as importOneUnlockedFn } from './service-import.ts'
import {
  checkRetail as checkRetailFn,
  configureRetailSync as configureRetailSyncFn,
  dropOrphanRetailListings as dropOrphanRetailListingsFn,
  listDropRetailCollisions as listDropRetailCollisionsFn,
  optOutRetailFamilies as optOutRetailFamiliesFn,
  resolveDropRetailCollisions as resolveDropRetailCollisionsFn,
  retailStatus as retailStatusFn,
  retailWorkerToken as retailWorkerTokenFn,
  retailSyncNeedsResume as retailSyncNeedsResumeFn,
  stopRetailSync as stopRetailSyncFn,
  syncRetail as syncRetailFn,
} from './service-retail.ts'
import {
  isOrphanRetailListing,
  type RetailCollisionAction,
  type RetailFamilyCollision,
  type RetailSyncStatus,
} from '../shared/retail.ts'
import { forgetRetailFile } from './retail-sync.ts'
import {
  activateEntry as activateEntryFn,
  bakeFeatures as bakeFeaturesFn,
  deactivateEntry as deactivateEntryFn,
  installEntry as installEntryFn,
  reinstallEntry as reinstallEntryFn,
  type BakeFeaturesMode,
  type BakeFeaturesResult,
  type ServiceLifecycleHost,
  uninstallEntry as uninstallEntryFn,
} from './service-lifecycle.ts'

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

export class FontButlerService {
  readonly paths: AppPaths
  private autoReinstallTimer: ReturnType<typeof setTimeout> | null = null
  private autoReinstallPending = new Set<string>()
  private rememberedDecisions = new Map<string, ImportPlanChoice>()
  private destinationFailures: Array<{ destinationId: DestinationId; reason: string }> = []
  private replacedConflicts: OperationItem[] = []
  private testInstallPaths = new Map<string, string>()
  private stopTestInstallWatch: (() => Promise<void>) | null = null
  /**
   * Test seam: stub Displaay worker HTTP for this instance so onboarding follow-up
   * can sync without the network.
   */
  retailFetch?: Omit<NonNullable<Parameters<typeof syncRetailFn>[1]>, 'choices'>

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
    const stop = this.stopTestInstallWatch
    this.stopTestInstallWatch = null
    if (stop) void stop()
  }

  private rememberDecision(key: string, choice: ImportPlanChoice): void {
    if (this.rememberedDecisions.has(key)) this.rememberedDecisions.delete(key)
    this.rememberedDecisions.set(key, choice)
    while (this.rememberedDecisions.size > REMEMBERED_DECISIONS_LIMIT) {
      const oldest = this.rememberedDecisions.keys().next().value
      if (oldest === undefined) break
      this.rememberedDecisions.delete(oldest)
    }
  }

  private takeDestinationFailures(): Array<{ destinationId: DestinationId; reason: string }> {
    const failures = this.destinationFailures
    this.destinationFailures = []
    return failures
  }

  private withPartialDestinationResult(
    entry: CatalogEntry,
    destinationFailures: Array<{ destinationId: DestinationId; reason: string }>,
  ): CatalogEntry {
    if (destinationFailures.length === 0) return entry
    const errors = destinationFailures.map((item) => item.reason)
    return Object.assign(entry, {
      errors,
      failed: destinationFailures.length,
      succeeded: 1,
      entries: [entry],
    })
  }

  private takeReplacedConflicts(): OperationItem[] {
    const items = this.replacedConflicts
    this.replacedConflicts = []
    return items
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
    await runCatalogTask(() => this.fillMissingPreviewSamplesUnlocked())
    // A watcher cannot report changes that happened while the app was closed.
    // Hash external sources once on startup so timestamp-preserving syncs are
    // still detected; steady-state watcher updates already force a hash.
    await this.refreshSourceStatuses(true)
    await dropOrphanRetailListingsFn(this.paths)
    await this.reinstallCurrentlyOutdated()
    await syncWatchers(this.paths)
    await reconcileWatchedSources(this.paths)
    await this.refreshUserFontsWatcher()
    await this.refreshInboxWatcher(this.watchingFolderRoots(), { importExisting: true })
    this.revisionStorage()
    this.pruneActivity()
    this.resumeIncompleteRetailSync()
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
    appIcon?: AppSettings['appIcon']
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
    latinPreview?: AppSettings['latinPreview']
    defaultDestination?: DefaultDestinationId
    savedFilters?: AppSettings['savedFilters']
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
    if (isAppIconStyle(patch.appIcon)) {
      next.appIcon = patch.appIcon
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
    if (patch.latinPreview) {
      const latinPreview = parseLatinPreview(patch.latinPreview)
      if (latinPreview) next.latinPreview = latinPreview
    }
    if (isDefaultDestinationId(patch.defaultDestination)) {
      next.defaultDestination = patch.defaultDestination
    }
    if (patch.savedFilters) {
      next.savedFilters = normalizeSavedFilters(patch.savedFilters)
    }
    const completingOnboarding = current.onboardingCompleted === false && next.onboardingCompleted === true
    syncWatchFolderPaths(next)
    saveSettings(this.paths, next)
    emitEvent({ type: 'settings', settings: next })
    if ('watchFolders' in patch || folderPatch || completingOnboarding) {
      await this.refreshInboxWatcher(this.watchingFolderRoots(next), { importExisting: true })
    }
    if (completingOnboarding && next.retailSync?.enabled) {
      await this.checkRetail({ credentialsOnly: false })
    }
    if (next.autoReinstallOnUpdate && !current.autoReinstallOnUpdate) {
      await this.refreshSourceStatuses()
      await this.reinstallCurrentlyOutdated()
    }
    if (patch.revisionBudgetBytes !== undefined) {
      this.revisionStorage()
    }
    this.pruneActivity()
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

  async createAdobeTestingFolder() {
    createAdobeTestingFolderFn(this.paths)
    await this.refreshUserFontsWatcher()
    return this.listDestinations()
  }

  getApiToken(): string {
    return getOrCreateApiToken(this.paths.apiTokenPath)
  }

  listSystem(): SystemFace[] {
    const faces = scanSystemFonts(this.paths)
    emitEvent({ type: 'system', faces })
    return faces
  }

  listTestInstalls(): TestInstallFont[] {
    const fonts = scanTestInstallDirs(testInstallDirs())
    this.testInstallPaths = new Map(fonts.map((font) => [font.id, font.path]))
    return fonts
  }

  watchTestInstalls(): () => Promise<void> {
    const publish = () => {
      emitEvent({ type: 'test-installs', fonts: this.listTestInstalls() })
    }
    publish()
    const stop = startTestInstallWatches(testInstallDirs(), publish)
    this.stopTestInstallWatch = stop
    return stop
  }

  uninstallTestInstalls(filePaths: string[]): TestInstallFont[] {
    const dirs = testInstallDirs()
    const resolved = [
      ...new Set(
        filePaths
          .map((filePath) => resolveTestInstallFileInDirs(filePath, dirs))
          .filter((filePath): filePath is string => Boolean(filePath)),
      ),
    ]
    if (resolved.length === 0) {
      throw new Error('Those files are not test installs.')
    }
    unregisterSessionFonts(resolved)
    for (const dir of dirs) deleteTestInstallFiles(dir, resolved)
    const fonts = this.listTestInstalls()
    emitEvent({ type: 'test-installs', fonts })
    return fonts
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
      const catalog = loadCatalog(this.paths)
      for (let index = 0; index < expanded.files.length; index += 1) {
        const filePath = expanded.files[index]!
        try {
          imported.push(await this.importAnalyzedUnlocked(filePath, { catalog, persist: false }))
        } catch (error) {
          errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
        }
        await yieldDuringBulkImport(index)
      }
      if (imported.length > 0) saveCatalog(this.paths, catalog)
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return { entries: imported, errors, ignored: expanded.skippedWeb }
    })
  }

  async importUploads(
    files: { filename: string; data: Buffer }[],
  ): Promise<{ entries: CatalogEntry[]; errors: string[]; ignored: number }> {
    return runCatalogTask(async () => {
      const totalBytes = files.reduce((sum, file) => sum + file.data.length, 0)
      if (totalBytes > MAX_UPLOAD_BATCH_BYTES) {
        throw new Error(`Upload batch exceeds ${MAX_UPLOAD_BATCH_BYTES / (1024 * 1024)}MB limit`)
      }
      fs.mkdirSync(this.paths.uploadsDir, { recursive: true })
      const saved: string[] = []
      const errors: string[] = []
      let ignored = 0
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!
        if (file.data.length > MAX_UPLOAD_BYTES) {
          errors.push(`${file.filename}: file exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`)
          await yieldDuringBulkImport(index)
          continue
        }
        let dest: string
        try {
          dest = writeUploadExclusive(this.paths.uploadsDir, file.filename, file.data)
        } catch (error) {
          errors.push(`${file.filename}: ${error instanceof Error ? error.message : String(error)}`)
          await yieldDuringBulkImport(index)
          continue
        }
        saved.push(dest)
        await yieldDuringBulkImport(index)
      }
      const imported: CatalogEntry[] = []
      const catalog = loadCatalog(this.paths)
      for (let index = 0; index < saved.length; index += 1) {
        const filePath = saved[index]!
        try {
          imported.push(await this.importAnalyzedUnlocked(filePath, { catalog, persist: false }))
        } catch (error) {
          errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
          if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { force: true })
          }
        }
        await yieldDuringBulkImport(index)
      }
      if (imported.length > 0) saveCatalog(this.paths, catalog)
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
        const reinstalled = await this.reinstallEntry(entry.id)
        emitCatalog(this.paths)
        emitNotice({
          kind: 'reinstalled',
          message: `Reinstalled ${displayFamily(reinstalled)}`,
          entryId: reinstalled.id,
        })
        return reinstalled
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
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (!sourceFileExists(entry.sourcePath)) {
      throw new Error('The source file is missing.')
    }
    const sourceFingerprint = fingerprintFile(entry.sourcePath)
    storeRevision(this.paths, entry.sourcePath, { faces: entry.faces, format: entry.format })
    let installedFingerprint: string | null = null
    const installedPath = existingManagedFontPath(entry, 'installed', catalog.entries)
    if (installedPath) {
      installedFingerprint = fingerprintFile(installedPath)
      storeRevision(this.paths, installedPath, { faces: entry.faces, format: entry.format })
    }
    return { id: entry.id, installedFingerprint, sourceFingerprint }
  }

  async install(
    id: string,
    familyName?: string,
    options?: InstallOptions,
  ): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const before = findById(loadCatalog(this.paths), id)
      const requestedFamilyName = familyName?.trim()
      const installAs = Boolean(
        before && requestedFamilyName && requestedFamilyName !== displayFamily(before),
      )
      const previousRevision = installAs ? undefined : this.previousRevisionBeforeChange(before)
      this.destinationFailures = []
      this.replacedConflicts = []
      const entry = await this.installEntry(id, familyName, options)
      const destinationFailures = this.takeDestinationFailures()
      const replacedConflicts = this.takeReplacedConflicts()
      const catalog = loadCatalog(this.paths)
      const latest = findById(catalog, entry.id)
      if (latest) {
        addManualOwner(latest)
        touchEntry(latest)
        saveCatalog(this.paths, catalog)
      }
      const item = this.operationItem(entry, 'succeeded')
      item.previousRevision = previousRevision
      this.commitManualOperation(
        options?.replace ? 'install-update' : 'install',
        [...this.withDestinationFailures(entry, item, destinationFailures), ...replacedConflicts],
        displayFamily(entry),
      )
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return this.withPartialDestinationResult(entry, destinationFailures)
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
      const items: OperationItem[] = []
      const progress = this.familyProgress('install', ids)
      progress.start()
      for (const id of ids) {
        const entry = findById(catalog, id)
        if (!entry) {
          const reason = 'Font is not in the library.'
          errors.push(reason)
          items.push({ id: crypto.randomUUID(), entryId: id, label: id, outcome: 'failed', reason })
          await progress.mark(id)
        } else if (entry.status === 'source-missing') {
          const reason = 'The source file is missing.'
          errors.push(reason)
          items.push({ id: crypto.randomUUID(), entryId: id, label: displayEntry(entry), outcome: 'failed', reason })
          await progress.mark(id)
        } else if (!eligibleForInstall(entry)) {
          items.push({ id: crypto.randomUUID(), entryId: id, label: displayEntry(entry), outcome: 'skipped' })
          await progress.mark(id)
        }
      }
      for (const entry of toInstall) {
        try {
          const previousRevision = this.previousRevisionBeforeChange(entry)
          this.destinationFailures = []
          this.replacedConflicts = []
          const installed = await this.installEntry(entry.id, familyName, options)
          const destinationFailures = this.takeDestinationFailures()
          const replacedConflicts = this.takeReplacedConflicts()
          const catalog = loadCatalog(this.paths)
          const latest = findById(catalog, installed.id)
          if (latest) {
            addManualOwner(latest)
            touchEntry(latest)
            saveCatalog(this.paths, catalog)
          }
          const completed = latest ?? installed
          entries.push(completed)
          const item = this.operationItem(completed, 'succeeded')
          item.previousRevision = previousRevision
          items.push(...this.withDestinationFailures(completed, item, destinationFailures), ...replacedConflicts)
          for (const failure of destinationFailures) errors.push(failure.reason)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          errors.push(reason)
          items.push(this.operationItem(entry, 'failed', reason))
        }
        await progress.mark(entry.id)
      }
      const operation = this.commitManualOperation(
        options?.replace ? 'install-update' : 'install',
        items,
        entries[0] ? displayFamily(entries[0]) : undefined,
      )
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      if (operation) {
        const result = entries as CatalogEntry[] & Partial<BatchActionResult>
        Object.assign(result, {
          operationId: operation.id,
          succeeded: operationCounts(operation).succeeded,
          failed: operationCounts(operation).failed,
          skipped: operationCounts(operation).skipped,
          canceled: operationCounts(operation).canceled,
          errors,
          failedIds: items
            .filter((item) => item.outcome === 'failed' && item.entryId)
            .map((item) => item.entryId!),
        })
        if (entries.length === 0 && errors.length) {
          throw new Error(errors.join('\n'))
        }
        return result
      }
      return entries
    })
  }

  async uninstall(id: string, options?: { deleteSource?: boolean }): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const current = findById(loadCatalog(this.paths), id)
      const previousEntry = current ? structuredClone(current) : undefined
      const previousRevision = this.retainInstalledRevision(id)
      const entry = await this.uninstallEntry(id, options)
      const item = this.operationItem(entry, 'succeeded')
      item.previousRevision = previousRevision
      item.previousEntry = previousEntry
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
      const familyNames = new Map<string, string>()
      const items: OperationItem[] = []
      const errors: string[] = []
      const progress = this.familyProgress('uninstall', ids)
      progress.start()
      for (const id of ids) {
        const current = findById(loadCatalog(this.paths), id)
        if (current) familyNames.set(id, displayFamily(current))
        try {
          const previousEntry = current ? structuredClone(current) : undefined
          const previousRevision = this.retainInstalledRevision(id)
          const entry = await this.uninstallEntry(id, options)
          familyNames.set(entry.id, displayFamily(entry))
          entries.push(entry)
          const item = this.operationItem(entry, 'succeeded')
          item.previousRevision = previousRevision
          item.previousEntry = previousEntry
          items.push(item)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          errors.push(reason)
          if (current) {
            items.push(this.operationItem(current, 'failed', reason))
          } else {
            items.push({ id: crypto.randomUUID(), entryId: id, label: id, outcome: 'failed', reason })
          }
        }
        await progress.mark(id)
      }
      const operation = this.commitManualOperation(
        'uninstall',
        items,
        entries[0] ? displayFamily(entries[0]) : undefined,
        !options?.deleteSource,
        familyNames,
      )
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      if (entries.length === 0 && errors.length) {
        throw new Error(errors.join('\n'))
      }
      if (operation) {
        const result = entries as CatalogEntry[] & Partial<BatchActionResult>
        Object.assign(result, {
          operationId: operation.id,
          ...operationCounts(operation),
          errors,
          failedIds: items
            .filter((item) => item.outcome === 'failed' && item.entryId)
            .map((item) => item.entryId!),
        })
        return result
      }
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
      const progress = this.familyProgress('deactivate', ids)
      progress.start()
      for (const id of ids) {
        const catalog = loadCatalog(this.paths)
        const entry = findById(catalog, id)
        if (!entry || !eligibleForDeactivate(entry)) {
          await progress.mark(id)
          continue
        }
        try {
          const next = await this.deactivateEntry(id, { removeManualOwner: true })
          entries.push(next)
          items.push(this.operationItem(next, 'succeeded'))
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          errors.push(reason)
          items.push(this.operationItem(entry, 'failed', reason))
        }
        await progress.mark(id)
      }
      this.commitManualOperation('deactivate', items, entries[0] ? displayFamily(entries[0]) : undefined)
      emitCatalog(this.paths)
      if (entries.length === 0 && errors.length) {
        throw new Error(errors.join('\n'))
      }
      return entries
    })
  }

  async activate(id: string, options?: InstallOptions): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const current = findById(loadCatalog(this.paths), id)
      const relatedId = current
        ? occupyingSiblings(loadCatalog(this.paths).entries, current, this.paths)[0]?.id
        : undefined
      this.destinationFailures = []
      const entry = options?.switch
        ? await this.switchToEntry(id)
        : await this.activateEntry(id, { ...options, owner: 'manual' })
      const destinationFailures = this.takeDestinationFailures()
      const item = this.operationItem(entry, 'succeeded')
      if (options?.switch) item.relatedEntryId = relatedId
      this.commitManualOperation(
        options?.switch ? 'switch' : 'activate',
        this.withDestinationFailures(entry, item, destinationFailures),
        displayFamily(entry),
      )
      emitCatalog(this.paths)
      return this.withPartialDestinationResult(entry, destinationFailures)
    })
  }

  async activateMany(ids: string[], options?: InstallOptions): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const catalog = loadCatalog(this.paths)
      const toActivate = ids
        .map((id) => findById(catalog, id))
        .filter((entry): entry is CatalogEntry => Boolean(entry))
      assertSingleInstallableFormat(toActivate)
      const entries: CatalogEntry[] = []
      const items: OperationItem[] = []
      const errors: string[] = []
      const progress = this.familyProgress('activate', ids)
      progress.start()
      for (const id of ids) {
        const current = findById(loadCatalog(this.paths), id)
        try {
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
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          errors.push(reason)
          if (current) {
            items.push(this.operationItem(current, 'failed', reason))
          } else {
            items.push({ id: crypto.randomUUID(), entryId: id, label: id, outcome: 'failed', reason })
          }
        }
        await progress.mark(id)
      }
      const operation = this.commitManualOperation(
        options?.switch ? 'switch' : 'activate',
        items,
        entries[0] ? displayFamily(entries[0]) : undefined,
      )
      emitCatalog(this.paths)
      if (entries.length === 0 && errors.length) {
        throw new Error(errors.join('\n'))
      }
      if (operation) {
        const result = entries as CatalogEntry[] & Partial<BatchActionResult>
        Object.assign(result, {
          operationId: operation.id,
          ...operationCounts(operation),
          errors,
          failedIds: items
            .filter((item) => item.outcome === 'failed' && item.entryId)
            .map((item) => item.entryId!),
        })
        return result
      }
      return entries
    })
  }

  async reinstall(id: string, options?: InstallOptions): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const before = findById(loadCatalog(this.paths), id)?.installedFingerprint
      this.destinationFailures = []
      const entry = await this.reinstallEntry(id, options)
      const destinationFailures = this.takeDestinationFailures()
      this.commitManualOperation(
        'reinstall',
        this.withDestinationFailures(entry, this.operationItem(entry, 'succeeded'), destinationFailures),
        displayFamily(entry),
        before !== entry.installedFingerprint,
      )
      emitCatalog(this.paths)
      return this.withPartialDestinationResult(entry, destinationFailures)
    })
  }

  async bakeFeatures(
    id: string,
    features: string[],
    mode: BakeFeaturesMode,
    familyName?: string,
  ): Promise<BakeFeaturesResult> {
    return runCatalogTask(async () => {
      const result = await bakeFeaturesFn(this.asLifecycleHost(), id, features, mode, familyName)
      if (mode === 'new-copy') {
        const catalog = loadCatalog(this.paths)
        const latest = findById(catalog, result.entry.id)
        if (latest) {
          addManualOwner(latest)
          touchEntry(latest)
          saveCatalog(this.paths, catalog)
          result.entry = latest
        }
      }
      this.commitManualOperation(
        mode === 'new-copy' ? 'install' : 'reinstall',
        [this.operationItem(result.entry, 'succeeded')],
        displayFamily(result.entry),
      )
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return result
    })
  }

  async reinstallMany(ids: string[], options?: InstallOptions): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      const beforeRevisions = new Map<string, string | undefined>()
      const errors: string[] = []
      const items: OperationItem[] = []
      const candidates = ids
        .map((id) => findById(loadCatalog(this.paths), id))
        .filter((entry): entry is CatalogEntry =>
          Boolean(entry) && (eligibleForReinstall(entry) || entry.status === 'installed'),
        )
      const needsCacheClear = candidates.some((entry) => {
        if (this.activeProjectPin(entry.id)) return false
        if (entry.status === 'outdated') return true
        if (entry.status !== 'installed' || !isExternalSource(entry)) return false
        const sourceFingerprint = tryFingerprintFile(entry.sourcePath)
        return Boolean(sourceFingerprint && sourceFingerprint !== entry.installedFingerprint)
      })
      if (needsCacheClear) {
        await this.clearCachesAfterInstall()
      }
      const progress = this.familyProgress('reinstall', ids)
      progress.start()
      for (const id of ids) {
        const catalog = loadCatalog(this.paths)
        const entry = findById(catalog, id)
        if (!entry) {
          const reason = 'Font is not in the library.'
          errors.push(reason)
          items.push({ id: crypto.randomUUID(), entryId: id, label: id, outcome: 'failed', reason })
          await progress.mark(id)
          continue
        }
        if (entry.status === 'source-missing') {
          const reason = 'The source file is missing.'
          errors.push(reason)
          items.push({ id: crypto.randomUUID(), entryId: id, label: displayEntry(entry), outcome: 'failed', reason })
          await progress.mark(id)
          continue
        }
        if (!eligibleForReinstall(entry) && entry.status !== 'installed') {
          items.push({ id: crypto.randomUUID(), entryId: id, label: displayEntry(entry), outcome: 'skipped' })
          await progress.mark(id)
          continue
        }
        try {
          beforeRevisions.set(id, entry.installedFingerprint)
          const updated = await this.reinstallEntry(id, { ...options, skipCacheClear: true })
          entries.push(updated)
          items.push(this.operationItem(updated, 'succeeded'))
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          errors.push(reason)
          items.push(this.operationItem(entry, 'failed', reason))
        }
        await progress.mark(id)
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
      const operation = this.commitManualOperation(
        'reinstall',
        items,
        first ? displayFamily(first) : undefined,
        entries.some((entry) => beforeRevisions.get(entry.id) !== entry.installedFingerprint),
      )
      if (entries.length === 0 && errors.length) {
        throw new Error(errors.join('\n'))
      }
      if (operation) {
        const result = entries as CatalogEntry[] & Partial<BatchActionResult>
        const counts = operationCounts(operation)
        Object.assign(result, {
          operationId: operation.id,
          ...counts,
          errors,
          failedIds: items
            .filter((item) => item.outcome === 'failed' && item.entryId)
            .map((item) => item.entryId!),
        })
        return result
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
      const errors: string[] = []
      let removed = 0
      const progress = this.familyProgress('forget', ids)
      progress.start()
      for (const id of ids) {
        try {
          await this.forgetEntry(id, options)
          removed += 1
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
        await progress.mark(id)
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      if (removed === 0 && errors.length) {
        throw new Error(errors.join('\n'))
      }
      return { removed }
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
      const retailOn = Boolean(loadSettings(this.paths).retailSync?.enabled)
      const ids = catalog.entries
        .filter((entry) => isCleanupEligible(entry) || isOrphanRetailListing(entry, retailOn))
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
      await yieldEventLoop()
      await getFontNative().unregisterFont(resolved)
      await fs.promises.rm(resolved, { force: true })
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
      await yieldEventLoop()
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
        previewSample: parsed.previewSample,
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
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    const target =
      which === 'installed'
        ? existingManagedFontPath(entry, 'installed', catalog.entries)
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

  fontBytesForEntry(
    id: string,
    resolvedEntry?: CatalogEntry,
    catalogEntries?: CatalogEntry[],
  ): { buffer: Buffer; mime: string; filename: string } {
    const loaded = resolvedEntry && catalogEntries ? undefined : loadCatalog(this.paths)
    const catalog = catalogEntries ?? loaded!.entries
    const entry = resolvedEntry ?? findById(loaded!, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    const filePath = existingManagedFontPath(entry, 'installed', catalog)
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
    if (!isPreviewableFontFile(resolved) || !allowedFontPath(resolved, this.paths)) {
      throw new Error('That font path is not readable.')
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
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
      const previousSourceMtimeMs = entry.sourceMtimeMs
      const previousSourceSize = entry.sourceSize
      const previousSourcePresent = entry.sourcePresent
      const previousSourceAvailability = entry.sourceAvailability
      const previousSourceFingerprint = entry.sourceFingerprint
      const previousStatus = entry.status
      const previousUpdateHold = entry.updateHold ?? null
      const previousUpdatePolicy = entry.updatePolicy ?? null
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
            label: displayEntry(entry),
            outcome: 'succeeded',
            previousSourcePath: previous,
            expectedRevision: entry.installedFingerprint,
            expectedStatus: entry.status,
            expectedSourcePath: entry.sourcePath,
            previousSourceMtimeMs,
            previousSourceSize,
            previousSourcePresent,
            previousSourceAvailability,
            previousSourceFingerprint,
            previousStatus,
            previousUpdateHold,
            previousUpdatePolicy,
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
          label: row.relativePath,
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

  inspectFolderDiscovery(root: string, exclusions: string[] = []): Promise<ImportPlan> {
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
    return { folder, discovery: await this.inspectFolderDiscovery(folder.root, folder.exclusions) }
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

  async planImport(filePaths: string[], trigger: OperationTrigger = 'import'): Promise<ImportPlan> {
    const expanded = expandImportPaths(filePaths)
    const plan = await buildImportPlan(expanded.files, loadCatalog(this.paths), { trigger, paths: this.paths })
    plan.retailCollisions = listDropRetailCollisionsFn(
      this.paths,
      plan.items.map((item) => ({ familyName: item.familyName, path: item.path })),
    )
    return savePlan(this.paths, plan)
  }

  async applyPlan(
    planId: string,
    choices: Record<string, ImportPlanChoice> = {},
    options: { idempotencyKey?: string; familyName?: string } = {},
  ): Promise<BatchActionResult> {
    return runCatalogTask(async () => {
      const existing = findOperationByIdempotency(this.paths, options.idempotencyKey)
      if (existing) {
        return this.batchFromOperation(existing)
      }
      const plan = loadPlan(this.paths, planId)
      if (!plan) throw new Error('That import plan is no longer available.')
      let catalog = loadCatalog(this.paths)
      if (plan.expectedCatalogRevision !== catalogRevision(catalog)) {
        throw new Error('The library changed. Review the import again.')
      }
      const operation = createOperation({
        trigger: plan.trigger,
        action: 'apply-plan',
        idempotencyKey: options.idempotencyKey,
      })
      const items: OperationItem[] = []
      const entries: CatalogEntry[] = []
      const failedIds: string[] = []
      let processed = 0
      for (const item of plan.items) {
        const remembered = this.rememberedDecisions.get(rememberedDecisionKey(item))
        const choice = choices[item.id] ?? remembered ?? item.defaultChoice
        const previousInstalledFingerprint = item.entryId
          ? findById(catalog, item.entryId)?.installedFingerprint
          : undefined
        if (
          item.classification === 'alt-format' ||
          item.classification === 'collection-overlap' ||
          item.classification === 'revision'
        ) {
          this.rememberDecision(rememberedDecisionKey(item), choice)
        }
        if (choice === 'skip') {
          items.push({
            id: item.id,
            entryId: item.entryId,
            label: displayEntryLabel({
              familyName: item.familyName,
              faces: item.faces,
              format: item.format,
              filePath: item.path,
            }),
            outcome: 'skipped',
          })
          continue
        }
        try {
          let relatedEntryId: string | undefined
          if (item.classification === 'unsupported') {
            throw new Error(item.reason || 'Unsupported font.')
          }
          if (choice === 'relink' && item.entryId) {
            entries.push(await this.applyRelink(item.entryId, item.path))
            catalog = loadCatalog(this.paths)
          } else if (choice === 'add-inactive') {
            entries.push(this.importOneUnlocked(item.path, {
              forceNew: true,
              catalog,
              analysis: await this.analysisForPlanItem(item),
            }))
          } else if (choice === 'switch') {
            const imported = this.importOneUnlocked(item.path, {
              forceNew: true,
              catalog,
              analysis: await this.analysisForPlanItem(item),
            })
            relatedEntryId = occupyingSiblings(catalog.entries, imported, this.paths)[0]?.id
            entries.push(await this.switchToEntry(imported.id))
            catalog = loadCatalog(this.paths)
          } else if (
            choice === 'keep' &&
            (item.classification === 'revision' ||
              item.classification === 'alt-format' ||
              item.classification === 'collection-overlap')
          ) {
            // Keep the current installation while still recording the incoming source in the catalog.
            entries.push(this.importOneUnlocked(item.path, {
              forceNew: item.parallelCopy ? true : undefined,
              catalog,
              analysis: await this.analysisForPlanItem(item),
            }))
          } else if (choice === 'replace' && item.entryId) {
            const latest = findById(catalog, item.entryId)
            if (latest && path.resolve(latest.sourcePath) !== path.resolve(item.path)) {
              latest.sourcePath = item.path
              const analysis = await this.analysisForPlanItem(item)
              const stat = analysis
                ? { mtimeMs: analysis.mtimeMs, size: analysis.size }
                : readFileStat(item.path)
              latest.sourceMtimeMs = stat.mtimeMs
              latest.sourceSize = stat.size
              latest.sourceFingerprint = analysis?.fingerprint || tryFingerprintFile(item.path)
              applyEntryFacts(latest)
              touchEntry(latest)
              saveCatalog(this.paths, catalog)
            }
            if (item.classification === 'alt-format' || item.classification === 'collection-overlap') {
              entries.push(await this.installEntry(item.entryId, undefined, { replace: true }))
            } else {
              entries.push(await this.installEntry(item.entryId))
            }
            catalog = loadCatalog(this.paths)
          } else if (choice === 'install-as') {
            const familyName = options.familyName?.trim()
            if (!familyName) {
              throw new Error('Choose a family name to Install as…')
            }
            const imported = this.importOneUnlocked(item.path, {
              forceNew: item.parallelCopy ? true : undefined,
              catalog,
              analysis: await this.analysisForPlanItem(item),
            })
            entries.push(await this.installEntry(imported.id, familyName))
            catalog = loadCatalog(this.paths)
          } else {
            const imported = this.importOneUnlocked(item.path, {
              catalog,
              analysis: await this.analysisForPlanItem(item),
            })
            const settings = loadSettings(this.paths)
            const folder = settings.folders.find((row) => row.id === imported.ownerFolderId)
            const shouldInstall =
              !imported.previewOnly &&
              (plan.trigger === 'import'
                ? settings.installAfterUpload
                : Boolean(folder?.installNew || (!folder && settings.installWatchFolderFonts)))
            if (shouldInstall && imported.status !== 'installed') {
              const installed = await this.installEntry(imported.id)
              catalog = loadCatalog(this.paths)
              const latest = findById(catalog, installed.id)
              if (latest) {
                addManualOwner(latest)
                touchEntry(latest)
                upsertEntry(catalog, latest)
                saveCatalog(this.paths, catalog)
              }
              entries.push(latest ?? installed)
            } else {
              entries.push(imported)
            }
          }
          const appliedEntry = entries.at(-1)
          items.push({
            id: item.id,
            entryId: appliedEntry?.id,
            label: appliedEntry
              ? displayEntry(appliedEntry)
              : displayEntryLabel({
                  familyName: item.familyName,
                  faces: item.faces,
                  format: item.format,
                  filePath: item.path,
                }),
            outcome: 'succeeded',
            previousRevision:
              appliedEntry?.id === item.entryId ? previousInstalledFingerprint : undefined,
            expectedRevision: appliedEntry?.installedFingerprint,
            expectedStatus: appliedEntry?.status,
            expectedSourcePath: appliedEntry?.sourcePath,
            relatedEntryId,
          })
          await yieldEventLoop()
          processed += 1
          if (processed % APPLY_PLAN_EMIT_EVERY === 0) emitCatalog(this.paths)
        } catch (error) {
          catalog = loadCatalog(this.paths)
          failedIds.push(item.entryId || item.id)
          items.push({
            id: item.id,
            entryId: item.entryId,
            label: displayEntryLabel({
              familyName: item.familyName,
              faces: item.faces,
              format: item.format,
              filePath: item.path,
            }),
            outcome: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }
      finishOperation(operation, items)
      catalog = loadCatalog(this.paths)
      if (
        items.some((row) => {
          if (row.outcome !== 'succeeded' || !row.entryId) return false
          const applied = findById(catalog, row.entryId)
          return !applied || applied.previewOnly || applied.status === 'uninstalled' || applied.status === 'source-missing'
        })
      ) {
        operation.undoable = false
      }
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
    return loadOperations(this.paths)
  }

  private pruneActivity(): void {
    const settings = loadSettings(this.paths)
    pruneOperations(this.paths, {
      maxAgeMs: settings.activityRetentionDays * 24 * 60 * 60 * 1000,
      maxCount: settings.activityMaxOperations,
    })
  }

  markAllActivityRead(): Operation[] {
    const operations = markAllOperationsRead(this.paths)
    emitEvent({ type: 'operations', operations })
    return operations
  }

  markActivityUnread(ids: string[]): Operation[] {
    const operations = markOperationsUnread(this.paths, ids)
    emitEvent({ type: 'operations', operations })
    return operations
  }

  clearActivity(): Operation[] {
    const operations = clearOperations(this.paths)
    emitEvent({ type: 'operations', operations })
    return operations
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
      let catalog = loadCatalog(this.paths)
      let entry = findById(catalog, id)
      if (!entry) throw new Error('Font is not in the library.')
      const target = fingerprint || entry.previousRevisionId
      if (!target) throw new Error('There is no retained version to restore.')
      this.assertRevisionAllowed(id, target)
      const bytes = readRevisionBytes(this.paths, target)
      if (!bytes) throw new Error('The retained version is no longer available.')
      const revisionFormat =
        loadRevisionIndex(this.paths).revisions.find((item) => item.fingerprint === target)?.format ||
        entry.format ||
        path.extname(entry.sourcePath).slice(1) ||
        'ttf'
      // The active version may be in the disabled vault. Retain those actual
      // bytes before overwriting them so restore and Undo never destroy the
      // only copy of the current version.
      const previousFingerprint = this.retainInstalledRevision(id) ?? entry.installedFingerprint
      const wasDeactivated = entry.status === 'deactivated'
      if (!wasDeactivated) this.assertNoOccupyingSibling(entry, catalog.entries)
      const macos = copyAt(entry, 'macos')
      const adobe = copyAt(entry, 'adobe-shared')
      const hasMacosDestination = Boolean(macos || entry.installedPath || entry.disabledPath)
      const liveMacosPath = entry.installedPath || macos?.path || destinationForInstall(this.paths, entry, entry.sourcePath)
      const parkedMacosPath = entry.disabledPath || macos?.parkedPath
      const staging = path.join(this.paths.dataRoot, 'staging', `${newId()}.bin`)
      fs.mkdirSync(path.dirname(staging), { recursive: true })
      fs.writeFileSync(staging, bytes)
      const staged = {
        stagedPath: staging,
        parsed: parseFontBuffer(bytes, revisionFormat),
        stat: readFileStat(staging),
      }
      try {
        await withMutationJournal(this.paths, { kind: 'replace', entries: [entry] }, async () => {
          if (hasMacosDestination || !adobe) {
            const dest = wasDeactivated
              ? parkedMacosPath || uniquePathFromOriginal(this.paths.disabledDir, liveMacosPath)
              : liveMacosPath
            recordMutationDestination(this.paths, entry!.id, dest)
            if (wasDeactivated) {
              fs.mkdirSync(path.dirname(dest), { recursive: true })
              const tempDest = `${dest}.${process.pid}.${newId()}.tmp`
              try {
                fs.copyFileSync(staging, tempDest)
                fs.renameSync(tempDest, dest)
              } finally {
                if (fs.existsSync(tempDest)) fs.rmSync(tempDest, { force: true })
              }
            } else {
              await commitInstalledFile({
                dest,
                stagedPath: staging,
                rollbackDir: path.join(this.paths.dataRoot, 'rollback'),
                native: getFontNative(),
              })
            }
          }
          if (adobe) {
            const adobeDest = wasDeactivated && adobe.parkedPath ? adobe.parkedPath : adobe.path
            recordMutationDestination(this.paths, entry!.id, adobeDest)
            if (wasDeactivated && adobe.parkedPath) {
              const tempDest = `${adobeDest}.${process.pid}.${newId()}.tmp`
              try {
                fs.copyFileSync(staging, tempDest)
                fs.renameSync(tempDest, adobeDest)
              } finally {
                if (fs.existsSync(tempDest)) fs.rmSync(tempDest, { force: true })
              }
            } else {
              placeAdobeCopy(this.paths, entry!, staging, revisionFormat, staged.parsed.faces)
            }
          }
          catalog = loadCatalog(this.paths)
          entry = findById(catalog, id)
          if (!entry) throw new Error('Font is not in the library.')
          applyParsedFont(entry, staged.parsed)
          entry.installedFingerprint = target
          entry.installedSnapshotMtimeMs = staged.stat.mtimeMs
          entry.installedSnapshotSize = staged.stat.size
          if (hasMacosDestination || !adobe) {
            const parked = wasDeactivated
              ? parkedMacosPath || uniquePathFromOriginal(this.paths.disabledDir, liveMacosPath)
              : undefined
            entry.installedPath = liveMacosPath
            entry.disabledPath = parked
            upsertCopy(entry, {
              destinationId: 'macos',
              path: liveMacosPath,
              parkedPath: parked,
              fingerprint: target,
              verification: parked ? 'unavailable' : 'file-present',
            })
          }
          if (adobe) {
            upsertCopy(entry, {
              destinationId: 'adobe-shared',
              path: adobe.path,
              parkedPath: wasDeactivated ? adobe.parkedPath : undefined,
              fingerprint: target,
              verification: wasDeactivated && adobe.parkedPath ? 'unavailable' : 'file-present',
            })
          }
          entry.status = wasDeactivated ? 'deactivated' : 'installed'
          if (previousFingerprint && previousFingerprint !== target) {
            entry.previousRevisionId = previousFingerprint
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
        })
      } finally {
        removeStagedFile(staging)
      }
      const operation = finishOperation(
        createOperation({ trigger: 'restore', action: 'restore-revision', familyName: displayFamily(entry) }),
        [{
          id: newId(),
          entryId: entry.id,
          label: displayEntry(entry),
          outcome: 'succeeded',
          previousRevision: previousFingerprint,
          expectedRevision: target,
          expectedStatus: entry.status,
        }],
      )
      upsertOperation(this.paths, operation)
      emitCatalog(this.paths)
      emitEvent({ type: 'operations', operations: loadOperations(this.paths) })
      return entry
    })
  }

  async undoOperation(id: string): Promise<BatchActionResult> {
    return runCatalogTask(async () => {
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
      let entry = findById(loadCatalog(this.paths), item.entryId)
      if (!entry && item.previousEntry) {
        entry = this.rehydrateUninstalledEntry(item)
      }
      if (!entry) {
        items.push({ ...item, outcome: 'failed', reason: 'The font is no longer in the library.' })
        continue
      }
      try {
        const undoTargetReached =
          (operation.action === 'uninstall' &&
            Boolean(item.previousRevision) &&
            entry.installedFingerprint === item.previousRevision &&
            (entry.status === 'installed' || entry.status === 'outdated' || entry.status === 'deactivated')) ||
          ((operation.action === 'install' ||
            operation.action === 'install-update' ||
            operation.action === 'reinstall' ||
            operation.action === 'apply-plan') &&
            (item.previousRevision
              ? entry.installedFingerprint === item.previousRevision
              : entry.status === 'uninstalled' || entry.status === 'source-missing'))
        if (undoTargetReached) {
          entries.push(entry)
          items.push({ ...item, outcome: 'succeeded' })
          continue
        }
        if (
          item.expectedRevision &&
          entry.installedFingerprint !== item.expectedRevision
        ) {
          throw new Error('This font has changed since that action and can no longer be undone safely.')
        }
        if (item.expectedStatus && entry.status !== item.expectedStatus) {
          throw new Error('This font state has changed since that action and can no longer be undone safely.')
        }
        if (item.expectedSourcePath && path.resolve(entry.sourcePath) !== path.resolve(item.expectedSourcePath)) {
          throw new Error('This source link has changed since that action and can no longer be undone safely.')
        }
        if (operation.action === 'relink-source' && (item.previousSourcePath || item.previousRevision)) {
          // Older relink records stored this path in previousRevision. Preserve
          // their Undo behavior while keeping paths out of revision storage.
          entry.sourcePath = item.previousSourcePath || item.previousRevision!
          const restoredSourceExists = sourceFileExists(entry.sourcePath)
          if (
            restoredSourceExists &&
            (item.previousSourceMtimeMs === undefined ||
              item.previousSourceSize === undefined ||
              item.previousSourceFingerprint === undefined)
          ) {
            const stat = readFileStat(entry.sourcePath)
            entry.sourceMtimeMs = stat.mtimeMs
            entry.sourceSize = stat.size
            entry.sourceFingerprint = tryFingerprintFile(entry.sourcePath)
            entry.sourcePresent = true
          }
          if (item.previousSourceMtimeMs !== undefined) entry.sourceMtimeMs = item.previousSourceMtimeMs
          if (item.previousSourceSize !== undefined) entry.sourceSize = item.previousSourceSize
          if (item.previousSourcePresent !== undefined) entry.sourcePresent = item.previousSourcePresent
          if (item.previousSourceAvailability !== undefined) entry.sourceAvailability = item.previousSourceAvailability
          if (item.previousSourceFingerprint !== undefined) entry.sourceFingerprint = item.previousSourceFingerprint
          applyEntryFacts(entry)
          if (item.previousStatus) entry.status = item.previousStatus
          if (item.previousUpdateHold !== undefined) entry.updateHold = item.previousUpdateHold
          if (item.previousUpdatePolicy !== undefined) entry.updatePolicy = item.previousUpdatePolicy ?? undefined
          touchEntry(entry)
          const catalog = loadCatalog(this.paths)
          const live = findById(catalog, entry.id)
          if (live) {
            live.sourcePath = entry.sourcePath
            live.sourceMtimeMs = entry.sourceMtimeMs
            live.sourceSize = entry.sourceSize
            live.sourceFingerprint = entry.sourceFingerprint
            live.sourcePresent = entry.sourcePresent
            live.sourceAvailability = entry.sourceAvailability
            live.status = entry.status
            live.updateHold = entry.updateHold
            live.updatePolicy = entry.updatePolicy
            applyEntryFacts(live)
            touchEntry(live)
            upsertEntry(catalog, live)
            saveCatalog(this.paths, catalog)
            entries.push(live)
          } else {
            upsertEntry(catalog, entry)
            saveCatalog(this.paths, catalog)
            entries.push(entry)
          }
          await syncWatchers(this.paths)
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
        } else if (operation.action === 'apply-plan' && item.relatedEntryId) {
          entries.push(await this.switchToEntry(item.relatedEntryId))
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
          const catalog = loadCatalog(this.paths)
          const before = findById(catalog, entry.id)
          const snapshot = before ? structuredClone(before) : undefined
          this.applyUninstallUndoState(entry.id, item)
          try {
            entries.push(await this.restoreRevision(entry.id, item.previousRevision))
          } catch (error) {
            if (snapshot) {
              const rolled = loadCatalog(this.paths)
              upsertEntry(rolled, snapshot)
              saveCatalog(this.paths, rolled)
            }
            throw error
          }
        }
        else {
          throw new Error('That action does not have a safe inverse.')
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
    const failedIds = items
      .filter((item) => item.outcome === 'failed' && item.entryId)
      .map((item) => item.entryId!)
    if (failedIds.length === 0) markUndone(this.paths, id)
    emitCatalog(this.paths)
    const undo = finishOperation(
      createOperation({ trigger: 'undo', action: 'undo', idempotencyKey: `undo:${id}` }),
      items,
    )
    upsertOperation(this.paths, undo)
    emitEvent({ type: 'operations', operations: loadOperations(this.paths) })
    return {
      operationId: undo.id,
      ...operationCounts(undo),
      errors: items.flatMap((item) => (item.reason ? [item.reason] : [])),
      entries,
      failedIds,
    }
    })
  }

  async repair(
    ids: string[] = [],
    options: { caches?: boolean } = {},
  ): Promise<{ fonts: RepairItemResult[]; caches: RepairItemResult[] }> {
    return runCatalogTask(async () => {
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
          fonts.push({ target: displayEntry(entry), kind: 'font', outcome: 'succeeded' })
        } catch (error) {
          fonts.push({
            target: displayEntry(entry),
            kind: 'font',
            outcome: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      } else if (entry.previousRevisionId && readRevisionBytes(this.paths, entry.previousRevisionId)) {
        try {
          await this.restoreRevision(entry.id, entry.previousRevisionId)
          fonts.push({ target: displayEntry(entry), kind: 'font', outcome: 'succeeded' })
        } catch (error) {
          fonts.push({
            target: displayEntry(entry),
            kind: 'font',
            outcome: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      } else if (!entry.installedPath) {
        fonts.push({ target: displayEntry(entry), kind: 'font', outcome: 'not-found' })
      } else {
        fonts.push({ target: displayEntry(entry), kind: 'font', outcome: 'not-found', reason: 'Installed copy is missing.' })
      }
      const latestCatalog = loadCatalog(this.paths)
      const latest = findById(latestCatalog, entry.id)
      if (!latest) continue
      const adobe = copyAt(latest, 'adobe-shared')
      if (adobe) {
        const dest = inspectDestination(this.paths, 'adobe-shared')
        const previous = adobe.verification
        adobe.verification = dest.supported
          ? verifyManagedCopy(this.paths, 'adobe-shared', adobe.path, adobe.fingerprint)
          : 'unavailable'
        fonts.push({
          target: `${displayEntry(latest)} · Adobe folder`,
          kind: 'font',
          outcome: dest.supported
            ? adobe.verification === 'file-present'
              ? 'succeeded'
              : 'not-found'
            : 'unavailable',
          reason: dest.supported ? adobe.verification === 'file-present' ? undefined : 'Adobe testing copy is missing.' : dest.reason,
        })
        if (adobe.verification !== previous) touchEntry(latest)
        saveCatalog(this.paths, latestCatalog)
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
    emitCatalog(this.paths)
    return { fonts, caches }
    })
  }

  /** Optional Displaay retail collection. Delegated to `service-retail.ts` to keep this file navigable. */
  retailStatus(): RetailSyncStatus {
    return retailStatusFn(this.paths)
  }

  retailWorkerToken(): string {
    return retailWorkerTokenFn(this.paths)
  }

  async configureRetailSync(input: {
    enabled?: boolean
    workerBaseUrl?: string
    autoCheckMinutes?: number
    token?: string
    folderId?: string | null
    disabledGlyphsFiles?: string[]
    familyFormats?: Record<string, import('../shared/retail.ts').RetailFontFormat>
    disableAction?: import('../shared/retail.ts').RetailDisableAction
  }): Promise<RetailSyncStatus> {
    const wasEnabled = Boolean(loadSettings(this.paths).retailSync?.enabled)
    const status = await configureRetailSyncFn(this.paths, input)
    if (!wasEnabled && status.enabled && !this.onboardingWorkDeferred()) {
      return this.checkRetail({ credentialsOnly: false })
    }
    return status
  }

  async checkRetail(options: { refresh?: boolean; credentialsOnly?: boolean } = {}): Promise<RetailSyncStatus> {
    const credentialsOnly =
      options.credentialsOnly !== undefined
        ? options.credentialsOnly
        : this.onboardingWorkDeferred()
    return checkRetailFn(this.paths, {
      refresh: options.refresh,
      credentialsOnly,
      fetchManifest: this.retailFetch?.fetchManifest,
    })
  }

  private resumeIncompleteRetailSync(): void {
    if (this.onboardingWorkDeferred()) return
    if (!retailSyncNeedsResumeFn(this.paths)) return
    void this.syncRetail()
  }

  async syncRetail(choices?: Record<string, RetailCollisionAction>): Promise<RetailSyncStatus> {
    if (this.onboardingWorkDeferred()) {
      return retailStatusFn(this.paths)
    }
    return syncRetailFn(this.paths, { choices, ...this.retailFetch })
  }

  async stopRetailSync(): Promise<RetailSyncStatus> {
    return stopRetailSyncFn(this.paths)
  }

  listDropRetailCollisions(
    incoming: ReadonlyArray<string | { familyName?: string; path?: string }>,
  ): RetailFamilyCollision[] {
    return listDropRetailCollisionsFn(this.paths, incoming)
  }

  async resolveDropRetailCollisions(
    choices: Record<string, RetailCollisionAction>,
    options: {
      planId?: string
      incoming?: ReadonlyArray<string | { familyName?: string; path?: string }>
    } = {},
  ): Promise<RetailSyncStatus> {
    return resolveDropRetailCollisionsFn(this.paths, choices, options)
  }

  optOutRetailFamilies(familyNames: readonly string[]): RetailSyncStatus {
    return optOutRetailFamiliesFn(this.paths, familyNames)
  }

  listProjects(): ProjectSet[] {
    return loadProjects(this.paths)
  }

  async createProject(name: string, memberIds: string[] = []): Promise<ProjectSet> {
    return runCatalogTask(async () => {
      const project = upsertProject(this.paths, createProject(name, memberIds))
      emitEvent({ type: 'projects', projects: loadProjects(this.paths) })
      return project
    })
  }

  async updateProject(
    id: string,
    patch: { name?: string; memberIds?: string[]; pin?: { assetId: string; fingerprint?: string } },
  ): Promise<ProjectSet> {
    return runCatalogTask(async () => {
      const projects = loadProjects(this.paths)
      const project = projects.find((item) => item.id === id)
      if (!project) throw new Error('That project was not found.')
      const previousIds = new Set(project.members.map((member) => member.assetId))
      if (patch.name !== undefined) project.name = patch.name.trim() || 'Untitled project'
      if (patch.memberIds) {
        project.members = [...new Set(patch.memberIds)].map((assetId) => {
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
      const nextIds = new Set(project.members.map((member) => member.assetId))
      const catalog = loadCatalog(this.paths)
      const toRelease: string[] = []
      for (const assetId of previousIds) {
        if (nextIds.has(assetId)) continue
        const entry = findById(catalog, assetId)
        if (!entry) continue
        const wasOwned = entry.activationOwners?.some(
          (owner) => owner.kind === 'project' && owner.projectId === id,
        )
        removeProjectOwner(entry, id)
        if (wasOwned && !hasActivationDemand(entry) && (entry.status === 'installed' || entry.status === 'outdated')) {
          toRelease.push(entry.id)
        }
      }
      saveCatalog(this.paths, catalog)
      upsertProject(this.paths, project)
      for (const entryId of toRelease) {
        await this.deactivateEntry(entryId)
      }
      const addedMember = [...nextIds].some((assetId) => !previousIds.has(assetId))
      if (project.desiredActive && (addedMember || patch.pin)) {
        await this.activateProject(id)
      } else {
        emitCatalog(this.paths)
        emitEvent({ type: 'projects', projects: loadProjects(this.paths) })
      }
      return loadProjects(this.paths).find((item) => item.id === id) ?? project
    })
  }

  async deleteProject(id: string): Promise<void> {
    return runCatalogTask(async () => {
      const project = removeProject(this.paths, id)
      if (!project) return
      const catalog = loadCatalog(this.paths)
      const toRelease: string[] = []
      for (const member of project.members) {
        const entry = findById(catalog, member.assetId)
        if (!entry) continue
        const wasOwned = entry.activationOwners?.some(
          (owner) => owner.kind === 'project' && owner.projectId === id,
        )
        removeProjectOwner(entry, id)
        if (wasOwned && !hasActivationDemand(entry) && (entry.status === 'installed' || entry.status === 'outdated')) {
          toRelease.push(entry.id)
        }
      }
      saveCatalog(this.paths, catalog)
      for (const entryId of toRelease) await this.deactivateEntry(entryId)
      emitCatalog(this.paths)
      emitEvent({ type: 'projects', projects: loadProjects(this.paths) })
    })
  }

  async activateProject(id: string): Promise<BatchActionResult> {
    return runCatalogTask(async () => {
    const projects = loadProjects(this.paths)
    const project = projects.find((item) => item.id === id)
    if (!project) throw new Error('That project was not found.')
    for (const member of project.members) {
      if (!member.pinFingerprint) continue
      const conflict = pinConflict(
        projects.filter((item) => item.id !== project.id),
        member.assetId,
        member.pinFingerprint,
      )
      if (conflict) {
        throw new Error(`Pinned for ${conflict.name}. Deactivate that project or create a separate copy.`)
      }
    }
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
          label: entry ? displayEntry(entry) : member.assetId,
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
        }
        let latest = findById(loadCatalog(this.paths), entry.id)
        if (!latest) throw new Error('Font is no longer in the library.')
        if (latest.status === 'uninstalled' || latest.status === 'source-missing') {
          await this.installEntry(latest.id)
        } else if (latest.status === 'deactivated') {
          await this.activateEntry(latest.id, { owner: 'project' })
        }
        latest = findById(loadCatalog(this.paths), entry.id)
        if (member.pinFingerprint && latest?.installedFingerprint !== member.pinFingerprint) {
          throw new Error('The pinned revision could not be activated.')
        }
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
        items.push({ id: newId(), entryId: entry.id, label: displayEntry(entry), outcome: 'succeeded' })
      } catch (error) {
        setMemberUnsatisfied(project, member.assetId, true)
        failedIds.push(entry.id)
        items.push({
          id: newId(),
          entryId: entry.id,
          label: displayEntry(entry),
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
    return {
      operationId: operation.id,
      ...operationCounts(operation),
      errors: items.flatMap((item) => (item.reason ? [item.reason] : [])),
      entries,
      failedIds,
    }
    })
  }

  async deactivateProject(id: string): Promise<void> {
    return runCatalogTask(async () => {
    const project = loadProjects(this.paths).find((item) => item.id === id)
    if (!project) throw new Error('That project was not found.')
    project.desiredActive = false
    const catalog = loadCatalog(this.paths)
    const toRelease: string[] = []
    for (const member of project.members) {
      const entry = findById(catalog, member.assetId)
      if (!entry) continue
      const wasOwned = entry.activationOwners?.some(
        (owner) => owner.kind === 'project' && owner.projectId === id,
      )
      removeProjectOwner(entry, id)
      if (wasOwned && !hasActivationDemand(entry) && (entry.status === 'installed' || entry.status === 'outdated')) {
        toRelease.push(entry.id)
      }
    }
    saveCatalog(this.paths, catalog)
    upsertProject(this.paths, project)
    for (const entryId of toRelease) {
      await this.deactivateEntry(entryId)
    }
    emitCatalog(this.paths)
    emitEvent({ type: 'projects', projects: loadProjects(this.paths) })
    })
  }

  private readableTestInstallPath(id: string): string | null {
    const testPath = this.testInstallPaths.get(id)
    if (!testPath) return null
    const safe = resolveTestInstallFileInDirs(testPath, testInstallDirs())
    if (!safe) throw new Error('That font path is not readable.')
    return safe
  }

  previewMeta(id: string, which: 'source' | 'installed' | 'revision' = 'installed', fingerprint?: string) {
    const testFile = this.readableTestInstallPath(id)
    if (testFile) {
      const parsed = parseFontFile(testFile, { previewMeta: true })
      return {
        ...parsed,
        entryId: id,
        which,
        fingerprint: tryFingerprintFile(testFile),
      }
    }
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) throw new Error('Font is not in the library.')
    const filePath =
      which === 'revision' && fingerprint
        ? revisionFilePath(this.paths, fingerprint)
        : existingManagedFontPath(entry, which === 'source' ? 'source' : 'installed', catalog.entries)
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('No font file is available to preview.')
    }
    const parsed = parseFontFile(filePath, { previewMeta: true })
    return {
      ...parsed,
      entryId: id,
      which,
      fingerprint: tryFingerprintFile(filePath),
    }
  }

  previewGlyph(
    id: string,
    code: number,
    which: 'source' | 'installed' | 'revision' = 'installed',
    fingerprint?: string,
  ) {
    const testFile = this.readableTestInstallPath(id)
    if (testFile) {
      return {
        code,
        name: glyphNameForCodePoint(testFile, code),
      }
    }
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) throw new Error('Font is not in the library.')
    const filePath =
      which === 'revision' && fingerprint
        ? revisionFilePath(this.paths, fingerprint)
        : existingManagedFontPath(entry, which === 'source' ? 'source' : 'installed', catalog.entries)
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('No font file is available to preview.')
    }
    return {
      code,
      name: glyphNameForCodePoint(filePath, code),
    }
  }

  fontBytesForRevision(
    id: string,
    which: 'source' | 'installed' | 'revision' = 'installed',
    fingerprint?: string,
  ): { buffer: Buffer; mime: string; filename: string } {
    const testFile = this.readableTestInstallPath(id)
    if (testFile) {
      return {
        buffer: fs.readFileSync(testFile),
        mime: mimeForFont(testFile),
        filename: path.basename(testFile),
      }
    }
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
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
    return this.fontBytesForEntry(id, entry, catalog.entries)
  }

  revisionStorage() {
    const settings = loadSettings(this.paths)
    const pins = pinnedFingerprints(loadProjects(this.paths))
    const required = new Set(
      loadCatalog(this.paths)
        .entries.map((entry) => entry.previousRevisionId)
        .filter((value): value is string => Boolean(value)),
    )
    for (const operation of loadOperations(this.paths)) {
      if (!operation.undoable || operation.undone) continue
      for (const item of operation.items) {
        if (item.previousRevision && isRevisionFingerprint(item.previousRevision)) {
          required.add(item.previousRevision)
        }
      }
    }
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
    destinationIds?: DestinationId[],
  ): Promise<CatalogEntry[]> {
    const conflicts = installedFormatConflicts(entry, catalog).filter((other) =>
      !destinationIds?.length ||
      destinationIds.some((destination) => occupiedDestinations(other, this.paths).includes(destination)),
    )
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
      const liveBytes =
        (installed && fs.existsSync(installed) ? installed : undefined) ??
        parkedBytesPath(current)
      if (liveBytes && fs.existsSync(liveBytes)) {
        const retained = storeRevision(this.paths, liveBytes, {
          faces: current.faces,
          format: current.format,
        })
        if (retained) {
          current.previousRevisionId = retained.fingerprint
          const catalog = loadCatalog(this.paths)
          const live = findById(catalog, current.id)
          if (live) {
            live.previousRevisionId = retained.fingerprint
            touchEntry(live)
            saveCatalog(this.paths, catalog)
          }
        }
        const snapshot = path.join(rollbackDir, `${crypto.randomUUID()}${path.extname(liveBytes) || '.ttf'}`)
        fs.copyFileSync(liveBytes, snapshot)
        snapshots.push({ entry: { ...current }, file: snapshot })
      }
      const previousEntry = structuredClone(current)
      await this.uninstallEntry(current.id, { retainCatalog: true })
      const after = findById(loadCatalog(this.paths), current.id)
      this.replacedConflicts.push({
        id: crypto.randomUUID(),
        entryId: current.id,
        label: displayEntry(current),
        outcome: 'succeeded',
        previousRevision: current.previousRevisionId,
        previousEntry,
        expectedStatus: after?.status ?? 'uninstalled',
        expectedRevision: after?.installedFingerprint,
      })
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

  private asLifecycleHost(): ServiceLifecycleHost {
    return {
      paths: this.paths,
      assertPinnedInstall: (entry) => this.assertPinnedInstall(entry),
      assertNoOccupyingSibling: (entry, catalog, dests) => this.assertNoOccupyingSibling(entry, catalog, dests),
      resolveFormatConflicts: (entry, catalog, replace, destinations) =>
        this.resolveFormatConflicts(entry, catalog, replace, destinations),
      snapshotAndRemoveConflicts: (conflicts) => this.snapshotAndRemoveConflicts(conflicts),
      restoreConflictSnapshots: (snapshots) => this.restoreConflictSnapshots(snapshots),
      parkManagedCopies: (entry) => this.parkManagedCopies(entry),
      unparkManagedCopies: (entry, dests) => this.unparkManagedCopies(entry, dests),
      clearCachesAfterInstall: () => this.clearCachesAfterInstall(),
      isLiveDestPath: (filePath) => this.isLiveDestPath(filePath),
      recordDestinationFailure: (destinationId, reason) => {
        this.destinationFailures.push({ destinationId, reason })
      },
    }
  }

  private async installEntry(
    id: string,
    familyName?: string,
    options?: InstallOptions,
  ): Promise<CatalogEntry> {
    return installEntryFn(this.asLifecycleHost(), id, familyName, options)
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
            applyParsedFont(entry, parsed)
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

  private removeAdobeCopy(entry: CatalogEntry): void {
    removeAdobeCopyFn(this.paths, entry)
  }

  async removeDestinationCopy(id: string, destinationId: DestinationId): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const catalog = loadCatalog(this.paths)
      const entry = findById(catalog, id)
      if (!entry) throw new Error('Font is not in the library.')
      if (destinationId === 'macos') {
        await removeInstalledCopy(entry, catalog.entries)
        dropCopy(entry, 'macos')
        if (!copyAt(entry, 'adobe-shared')) {
          entry.status = sourceFileExists(entry.sourcePath) && isExternalSource(entry) ? 'uninstalled' : entry.status
        }
      } else {
        this.removeAdobeCopy(entry)
      }
      applyEntryFacts(entry)
      if (!copyAt(entry, 'macos') && !copyAt(entry, 'adobe-shared') && !entry.disabledPath) {
        entry.status = sourceFileExists(entry.sourcePath) && isExternalSource(entry)
          ? 'uninstalled'
          : 'source-missing'
      }
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
    options?: { deleteSource?: boolean; retainCatalog?: boolean },
  ): Promise<CatalogEntry> {
    return uninstallEntryFn(this.asLifecycleHost(), id, options)
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
      // Place B on B's recorded dests only; do not inherit A's occupancy.
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
    return deactivateEntryFn(this.asLifecycleHost(), id, options)
  }

  private async activateEntry(
    id: string,
    options: InstallOptions & { owner?: 'manual' | 'project' } = {},
  ): Promise<CatalogEntry> {
    return activateEntryFn(this.asLifecycleHost(), id, options)
  }

  private async reinstallEntry(
    id: string,
    options?: InstallOptions & { skipCacheClear?: boolean },
  ): Promise<CatalogEntry> {
    return reinstallEntryFn(this.asLifecycleHost(), id, options)
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
    if (entry.retailRelativePath) {
      const retailOn = Boolean(loadSettings(this.paths).retailSync?.enabled)
      if (!isOrphanRetailListing(entry, retailOn)) {
        throw new Error('Displaay retail fonts stay in the collection.')
      }
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
    await removeInstalledCopy(entry, catalog.entries)
    this.removeAdobeCopy(entry)
    if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
      fs.rmSync(entry.disabledPath, { force: true })
    }
    entry.disabledPath = undefined
    if (entry.retailRelativePath) {
      forgetRetailFile(this.paths, entry.retailRelativePath)
    }
    removeEntryById(catalog, id)
    saveCatalog(this.paths, catalog)
    return entry
  }

  private async openFolderUnlocked(folderPath: string): Promise<CatalogEntry> {
    const expanded = expandImportPaths([folderPath])
    const errors = [...expanded.errors]
    const imported: CatalogEntry[] = []
    const catalog = loadCatalog(this.paths)
    for (let index = 0; index < expanded.files.length; index += 1) {
      const filePath = expanded.files[index]!
      try {
        imported.push(await this.importAnalyzedUnlocked(filePath, { catalog, persist: false }))
      } catch (error) {
        errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
      await yieldDuringBulkImport(index)
    }
    if (imported.length > 0) saveCatalog(this.paths, catalog)
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

  private async analysisForPlanItem(item: ImportPlan['items'][number]): Promise<FontAnalysis | undefined> {
    const reused = analysisFromPlanItem(item)
    if (reused) {
      rememberFontAnalysis(reused)
      return reused
    }
    const fresh = await analyzeFontFile(item.path)
    rememberFontAnalysis(fresh)
    return fresh
  }

  private importOneUnlocked(
    filePath: string,
    options: {
      forceNew?: boolean
      catalog?: ReturnType<typeof loadCatalog>
      persist?: boolean
      analysis?: FontAnalysis
    } = {},
  ): CatalogEntry {
    return importOneUnlockedFn(this.paths, filePath, options)
  }

  private async importAnalyzedUnlocked(
    filePath: string,
    options: {
      forceNew?: boolean
      catalog?: ReturnType<typeof loadCatalog>
      persist?: boolean
    } = {},
  ): Promise<CatalogEntry> {
    const catalog = options.catalog ?? loadCatalog(this.paths)
    const persist = options.persist !== false
    const knownIds = new Set(catalog.entries.map((entry) => entry.id))
    let entry: CatalogEntry | undefined
    try {
      const analysis = await analyzeFontFile(filePath, {
        onPartial: (partial) => {
          rememberFontAnalysis(partial)
          entry = this.importOneUnlocked(filePath, {
            ...options,
            catalog,
            persist: false,
            analysis: partial,
          })
          if (persist) saveCatalog(this.paths, catalog)
          emitEvent({ type: 'catalog', entries: catalog.entries })
        },
      })
      rememberFontAnalysis(analysis)
      if (!entry) {
        return this.importOneUnlocked(filePath, { ...options, catalog, analysis })
      }
      if (analysis.parsed.previewSample && entry.previewSample !== analysis.parsed.previewSample) {
        applyParsedFont(entry, analysis.parsed)
        entry.previewSample = analysis.parsed.previewSample
        touchEntry(entry)
        if (persist) saveCatalog(this.paths, catalog)
        emitEvent({ type: 'catalog', entries: catalog.entries })
      }
      return entry
    } catch (error) {
      if (entry && !knownIds.has(entry.id)) {
        removeEntryById(catalog, entry.id)
        if (persist) saveCatalog(this.paths, catalog)
        emitEvent({ type: 'catalog', entries: catalog.entries })
      }
      throw error
    }
  }

  private async refreshSourceStatuses(forceFingerprint = false): Promise<void> {
    return runCatalogTask(() => this.refreshSourceStatusesUnlocked(forceFingerprint))
  }

  private async fillMissingPreviewSamplesUnlocked(): Promise<void> {
    const catalog = loadCatalog(this.paths)
    let changed = false
    for (const entry of catalog.entries) {
      if (entry.previewSample) {
        await yieldEventLoop()
        continue
      }
      const file = existingFontPath(entry, catalog.entries)
      if (!file) continue
      try {
        const analysis = await analyzeFontFile(file)
        const stubFaces = !entry.faces?.some((face) => Boolean(face.postscriptName))
        if (stubFaces && analysis.parsed.faces.length > 0) {
          applyParsedFont(entry, analysis.parsed)
          touchEntry(entry)
          changed = true
          emitEvent(catalogEvent(catalog.entries))
        } else if (fillEntryPreviewSample(entry, { sample: analysis.parsed.previewSample })) {
          touchEntry(entry)
          changed = true
          emitEvent(catalogEvent(catalog.entries))
        }
      } catch {
        // Leave the card pending if the file cannot be parsed.
      }
    }
    if (changed) saveCatalog(this.paths, catalog)
  }

  private async refreshSourceStatusesUnlocked(forceFingerprint = false): Promise<void> {
    const catalog = loadCatalog(this.paths)
    let changed = false
    for (const entry of catalog.entries) {
      if (applySourcePresence(entry)) {
        touchEntry(entry)
        changed = true
      }
      if (!entry.sourcePresent || !isExternalSource(entry)) {
        await yieldEventLoop()
        continue
      }
      const stat = readFileStat(entry.sourcePath)
      const stampUnchanged =
        !forceFingerprint &&
        stat.mtimeMs === entry.sourceMtimeMs &&
        stat.size === entry.sourceSize &&
        Boolean(entry.sourceFingerprint)
      if (!stampUnchanged) {
        if (entry.sourceMtimeMs !== stat.mtimeMs || entry.sourceSize !== stat.size) {
          entry.sourceMtimeMs = stat.mtimeMs
          entry.sourceSize = stat.size
          touchEntry(entry)
          changed = true
        }
        await yieldEventLoop()
        const fingerprint = tryFingerprintFile(entry.sourcePath)
        const bytesChanged = Boolean(fingerprint && fingerprint !== entry.sourceFingerprint)
        if (fingerprint && fingerprint !== entry.sourceFingerprint) {
          entry.sourceFingerprint = fingerprint
          touchEntry(entry)
          changed = true
        }
        const needsParse = bytesChanged || !entry.faces?.length || !entry.previewSample
        if (needsParse) {
          try {
            const parsed = (await analyzeFontFile(entry.sourcePath)).parsed
            const keepInstalledSample = previewUsesInstalledBytes(entry)
            if (JSON.stringify(entry.faces) !== JSON.stringify(parsed.faces)) {
              const installedSample = entry.previewSample
              applyParsedFont(entry, parsed)
              if (keepInstalledSample) entry.previewSample = installedSample
              touchEntry(entry)
              changed = true
            } else if (
              !keepInstalledSample &&
              parsed.previewSample &&
              entry.previewSample !== parsed.previewSample
            ) {
              entry.previewSample = parsed.previewSample
              touchEntry(entry)
              changed = true
            }
          } catch {
            // Keep stored names if the file can no longer be parsed.
          }
        }
      }
      const fingerprint = entry.sourceFingerprint
      const bytesDiffer = fingerprint && entry.installedFingerprint
        ? fingerprint !== entry.installedFingerprint
        : stat.mtimeMs !== entry.installedSnapshotMtimeMs ||
          stat.size !== entry.installedSnapshotSize
      if (entry.status === 'installed' && bytesDiffer && !entry.updateHold) {
        entry.status = 'outdated'
        touchEntry(entry)
        changed = true
      }
      await yieldEventLoop()
    }
    if (changed) {
      saveCatalog(this.paths, catalog)
      emitCatalog(this.paths)
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

  private assertRevisionAllowed(id: string, fingerprint: string): void {
    for (const project of loadProjects(this.paths)) {
      if (!project.desiredActive) continue
      const member = project.members.find((item) => item.assetId === id)
      if (member?.pinFingerprint && member.pinFingerprint !== fingerprint) {
        throw new Error(
          `Pinned for ${project.name}. Deactivate that project before restoring another version.`,
        )
      }
    }
  }

  private assertPinnedInstall(entry: CatalogEntry): void {
    const pin = this.activeProjectPin(entry.id)
    if (!pin) return
    const sourceFingerprint = sourceFileExists(entry.sourcePath)
      ? tryFingerprintFile(entry.sourcePath)
      : undefined
    if (sourceFingerprint === pin.fingerprint) return
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

  private onboardingWorkDeferred(settings = loadSettings(this.paths)): boolean {
    return settings.onboardingCompleted === false
  }

  private async refreshInboxWatcher(
    folders: string[],
    options: { importExisting: boolean },
  ): Promise<void> {
    if (this.onboardingWorkDeferred()) {
      await syncInboxWatcher([], () => {})
      return
    }
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
    return importInboxFilesFn(this, filePaths)
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

  private macosFontRoots(): string[] {
    return installDestinationRoots(this.paths)
      .filter((item) => item.id === 'macos')
      .map((item) => item.dir)
  }

  private destinationWatchDirs(): string[] {
    return [...new Set(installDestinationRoots(this.paths).map((item) => item.dir))]
  }

  private liveCopyPath(entry: CatalogEntry, destId: DestinationId): string | undefined {
    if (destId === 'macos') {
      return entry.installedPath || copyAt(entry, 'macos')?.path
    }
    return copyAt(entry, 'adobe-shared')?.path
  }

  private sourcePointsAtMacosCopy(entry: CatalogEntry, recorded: string | undefined): boolean {
    if (!entry.sourcePath) return false
    const source = path.resolve(entry.sourcePath)
    if (entry.installedPath && path.resolve(entry.installedPath) === source) return true
    return Boolean(recorded && recorded === source)
  }

  private stampAdoptedCopy(entry: CatalogEntry, destId: DestinationId, filePath: string): boolean {
    const resolved = path.resolve(filePath)
    const existing = copyAt(entry, destId)
    const recorded = existing?.path ? path.resolve(existing.path) : undefined
    if (recorded && recorded !== resolved && fs.existsSync(recorded)) {
      return false
    }
    const selfSourced = destId === 'macos' && this.sourcePointsAtMacosCopy(entry, recorded)
    const sourceNeedsMove =
      selfSourced && Boolean(entry.sourcePath) && path.resolve(entry.sourcePath) !== resolved
    const installedResolved = entry.installedPath ? path.resolve(entry.installedPath) : undefined
    const copyAlreadyCurrent =
      Boolean(existing) &&
      recorded === resolved &&
      existing?.verification === 'file-present' &&
      !existing?.parkedPath
    if (copyAlreadyCurrent && !sourceNeedsMove && (destId !== 'macos' || installedResolved === resolved)) {
      return false
    }
    upsertCopy(entry, {
      destinationId: destId,
      path: resolved,
      fingerprint: existing?.fingerprint ?? tryFingerprintFile(resolved),
      verification: 'file-present',
    })
    if (destId === 'macos') {
      entry.installedPath = resolved
      if (sourceNeedsMove && entry.sourcePath) {
        entry.sourcePath = resolved
        try {
          const stat = readFileStat(resolved)
          entry.sourceMtimeMs = stat.mtimeMs
          entry.sourceSize = stat.size
        } catch {
          // The file was present when the destination was scanned.
        }
      }
    }
    return true
  }

  private warnAdoptedDuplicate(entry: CatalogEntry, filePath: string): void {
    let familyName = entry.faces[0]?.familyName
    let format = entry.format
    let incomingVersion: string | undefined
    try {
      const parsed = parseFontFile(filePath)
      familyName = parsed.faces[0]?.familyName ?? familyName
      format = parsed.format || format
      incomingVersion = parsed.faces[0]?.fullName
    } catch {
      // Keep the occupying entry's labels when the neighbor cannot be parsed.
    }
    const fingerprint = tryFingerprintFile(filePath)
    const occupyingFingerprints = [
      entry.installedFingerprint,
      entry.sourceFingerprint,
      ...(entry.installations ?? []).map((copy) => copy.fingerprint),
    ].filter((value): value is string => Boolean(value))
    const { notify } = upsertDuplicateWarning(this.paths, {
      path: filePath,
      fingerprint,
      familyName,
      format,
      incomingVersion,
      conflictingEntryIds: [entry.id],
      activeEntryId: entry.id,
      notifyKey: duplicateNotifyKey(filePath, fingerprint, occupyingFingerprints),
    })
    emitDuplicates(this.paths)
    if (notify) {
      emitNotice({
        kind: 'info',
        message: 'A font with the same face is already in this destination and is not the managed copy.',
      })
    }
  }

  /**
   * Deactivated by macOS (Font Book), not by Font Buttler: the Fonts copy is still in place and
   * nothing was parked. Its Adobe-folder copy is still live and gets recorded.
   */
  private isDeactivatedOutsideApp(entry: CatalogEntry): boolean {
    if (entry.status !== 'deactivated' || entry.disabledPath) return false
    if ((entry.installations ?? []).some((copy) => copy.parkedPath)) return false
    return occupiesDestination(entry, 'macos', this.paths)
  }

  private isSafeAdoptMergeTarget(
    entry: CatalogEntry,
    incomingPath: string,
    destId: DestinationId,
  ): boolean {
    if (entryHasParkedBytes(entry)) return false
    if (
      entry.status === 'deactivated' &&
      !(destId === 'adobe-shared' && this.isDeactivatedOutsideApp(entry))
    ) {
      return false
    }
    const liveHere = this.liveCopyPath(entry, destId)
    if (liveHere && fs.existsSync(liveHere) && path.resolve(liveHere) !== path.resolve(incomingPath)) {
      return false
    }
    const destRoots = this.destinationWatchDirs()
    if (!isUnderAnyRoot(incomingPath, destRoots)) return false
    if (occupiedDestinations(entry, this.paths).length === 0) return false
    if (isExternalSource(entry) && sourceFileExists(entry.sourcePath)) {
      const source = path.resolve(entry.sourcePath)
      if (source !== path.resolve(incomingPath) && !isUnderAnyRoot(source, destRoots)) {
        const incomingFp = tryFingerprintFile(incomingPath)
        const known = [
          entry.installedFingerprint,
          entry.sourceFingerprint,
          ...(entry.installations ?? []).map((copy) => copy.fingerprint),
        ].filter((value): value is string => Boolean(value))
        if (!incomingFp || !known.includes(incomingFp)) return false
      }
    }
    return true
  }

  private findAdoptTarget(
    catalog: ReturnType<typeof loadCatalog>,
    resolved: string,
    destId: DestinationId,
  ): CatalogEntry | undefined {
    const byPath =
      occupantsAtPath(catalog, resolved)[0] ??
      findByInstalledPath(catalog, resolved) ??
      findBySourcePath(catalog, resolved)
    if (byPath) return byPath
    try {
      const parsed = parseFontFile(resolved)
      const occupying = occupyingSiblingsForIncoming(
        catalog.entries,
        parsed.faces,
        parsed.format,
        this.paths,
      )
      const owner = occupying.find((entry) => {
        const live = this.liveCopyPath(entry, destId)
        return Boolean(live && path.resolve(live) === resolved)
      })
      if (owner) return owner
      const merge = occupying.find((entry) => this.isSafeAdoptMergeTarget(entry, resolved, destId))
      if (merge) return merge
      return catalog.entries.find((entry) => {
        if (entryHasParkedBytes(entry) || entry.status === 'deactivated') return false
        const recorded = this.liveCopyPath(entry, destId)
        if (!recorded || fs.existsSync(recorded)) return false
        if (!matchesIncomingIdentity(entry, parsed.faces, parsed.format)) return false
        if (isExternalSource(entry) && sourceFileExists(entry.sourcePath)) {
          const source = path.resolve(entry.sourcePath)
          if (source !== resolved && !isUnderAnyRoot(source, this.destinationWatchDirs())) {
            const incomingFp = tryFingerprintFile(resolved)
            const known = [
              entry.installedFingerprint,
              entry.sourceFingerprint,
              ...(entry.installations ?? []).map((copy) => copy.fingerprint),
            ].filter((value): value is string => Boolean(value))
            if (!incomingFp || !known.includes(incomingFp)) return false
          }
        }
        return true
      })
    } catch {
      return undefined
    }
  }

  private occupyingSameDest(
    catalog: ReturnType<typeof loadCatalog>,
    resolved: string,
    destId: DestinationId,
  ): CatalogEntry | undefined {
    try {
      const parsed = parseFontFile(resolved)
      return occupyingSiblingsForIncoming(
        catalog.entries,
        parsed.faces,
        parsed.format,
        this.paths,
      ).find((entry) => {
        const live = this.liveCopyPath(entry, destId)
        return Boolean(live && fs.existsSync(live) && path.resolve(live) !== resolved)
      })
    } catch {
      return undefined
    }
  }

  private async adoptUserFonts(): Promise<void> {
    const destinations = installDestinationRoots(this.paths)
    const macosFiles = uniqueResolvedFiles(
      destinations.filter((item) => item.id === 'macos').flatMap((item) => listFontFilesInTree(item.dir)),
    )
    const adobeFiles = uniqueResolvedFiles(
      destinations
        .filter((item) => item.id === 'adobe-shared')
        .flatMap((item) => listFontFilesInTree(item.dir)),
    )
    const catalog = loadCatalog(this.paths)
    const activation =
      macosFiles.length > 0
        ? await getFontNative().fontActivationStates(macosFiles)
        : { ok: false, native: false, states: {} }
    let changed = false

    const adoptFile = (filePath: string, destId: DestinationId, useActivation: boolean) => {
      const resolved = path.resolve(filePath)
      const existing = this.findAdoptTarget(catalog, resolved, destId)
      const queriedOn = useActivation && activation.ok
        ? (activation.states[resolved] ?? activation.states[filePath])
        : undefined
      const isOn = useActivation
        ? (queriedOn ?? (existing ? existing.status !== 'deactivated' : true))
        : true
      if (existing) {
        if (entryHasParkedBytes(existing)) {
          return
        }
        if (
          existing.status === 'deactivated' &&
          destId !== 'macos' &&
          !this.isDeactivatedOutsideApp(existing)
        ) {
          return
        }
        const live = this.liveCopyPath(existing, destId)
        if (live && fs.existsSync(live) && path.resolve(live) !== resolved) {
          this.warnAdoptedDuplicate(existing, resolved)
          return
        }
        if (!live || !fs.existsSync(live)) {
          if (this.stampAdoptedCopy(existing, destId, resolved)) {
            if (destId === 'macos') {
              existing.disabledPath = undefined
              existing.status = isOn ? 'installed' : 'deactivated'
              existing.sourcePresent = isExternalSource(existing)
            } else if (existing.status === 'uninstalled' || existing.status === 'source-missing') {
              existing.status = 'installed'
            }
            touchEntry(existing)
            changed = true
          }
        } else if (path.resolve(live) === resolved) {
          if (this.stampAdoptedCopy(existing, destId, resolved)) {
            touchEntry(existing)
            changed = true
          }
          if (destId === 'macos') {
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
        }
        return
      }
      let parsedIncoming
      try {
        parsedIncoming = parseFontFile(resolved)
      } catch {
        return
      }
      const parked = catalog.entries.find(
        (entry) =>
          (entryHasParkedBytes(entry) || entry.status === 'deactivated') &&
          matchesIncomingIdentity(entry, parsedIncoming.faces, parsedIncoming.format),
      )
      if (parked) {
        return
      }
      const sameDest = this.occupyingSameDest(catalog, resolved, destId)
      if (sameDest) {
        this.warnAdoptedDuplicate(sameDest, resolved)
        return
      }
      try {
        if (parsedIncoming.faces.length === 0) {
          return
        }
        const stat = readFileStat(resolved)
        const entry: CatalogEntry = {
          id: newId(),
          sourcePath: resolved,
          sourceMtimeMs: stat.mtimeMs,
          sourceSize: stat.size,
          sourcePresent: false,
          status: isOn ? 'installed' : 'deactivated',
          installedPath: destId === 'macos' ? resolved : undefined,
          faces: parsedIncoming.faces,
          format: parsedIncoming.format,
          previewSample: parsedIncoming.previewSample,
          addedAt: now(),
          updatedAt: now(),
        }
        this.stampAdoptedCopy(entry, destId, resolved)
        upsertEntry(catalog, entry)
        changed = true
      } catch {
        // Skip unreadable or corrupt destination fonts.
      }
    }

    for (const filePath of macosFiles) {
      adoptFile(filePath, 'macos', true)
    }
    for (const filePath of adobeFiles) {
      adoptFile(filePath, 'adobe-shared', false)
    }

    const macosRoots = this.macosFontRoots()
    for (const entry of [...catalog.entries]) {
      if (entryHasParkedBytes(entry)) {
        continue
      }
      const macosPath = this.liveCopyPath(entry, 'macos')
      const macosMissing =
        Boolean(macosPath) &&
        isUnderAnyRoot(macosPath!, macosRoots) &&
        !fs.existsSync(macosPath!)
      if (macosMissing) {
        dropCopy(entry, 'macos')
        entry.installedPath = undefined
        changed = true
      }
      const adobe = copyAt(entry, 'adobe-shared')
      const adobeMissing = Boolean(adobe?.path && !adobe.parkedPath && !fs.existsSync(adobe.path))
      if (adobeMissing) {
        dropCopy(entry, 'adobe-shared')
        changed = true
      }
      const liveMacos = occupiesDestination(entry, 'macos', this.paths)
      const liveAdobe = occupiesDestination(entry, 'adobe-shared', this.paths)
      if (liveMacos || liveAdobe) {
        if (entry.status === 'uninstalled' || entry.status === 'source-missing') {
          entry.status = 'installed'
          touchEntry(entry)
          changed = true
        }
        continue
      }
      if (!macosMissing && !adobeMissing) {
        continue
      }
      if (isExternalSource(entry) && sourceFileExists(entry.sourcePath)) {
        entry.installedPath = undefined
        entry.sourcePresent = true
        entry.status = 'uninstalled'
        touchEntry(entry)
      } else if (entry.status === 'installed' || entry.status === 'outdated') {
        removeEntryById(catalog, entry.id)
      } else {
        continue
      }
      changed = true
    }

    if (changed) {
      saveCatalog(this.paths, catalog)
    }
  }

  private userFontsAdoptQueued = false

  private scheduleAdoptUserFonts(): void {
    if (this.userFontsAdoptQueued) return
    this.userFontsAdoptQueued = true
    void runCatalogTask(async () => {
      while (this.userFontsAdoptQueued) {
        this.userFontsAdoptQueued = false
        await this.adoptUserFonts()
        await syncWatchers(this.paths)
        emitCatalog(this.paths)
      }
    })
  }

  private async refreshUserFontsWatcher(): Promise<void> {
    await syncUserFontsWatcher(this.destinationWatchDirs(), () => {
      this.scheduleAdoptUserFonts()
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
      label: displayEntry(entry),
      outcome,
      reason,
      previousRevision: entry.previousRevisionId,
      expectedRevision: entry.installedFingerprint,
      expectedStatus: entry.status,
    }
  }

  private previousRevisionBeforeChange(entry: CatalogEntry | undefined): string | undefined {
    if (!entry) return undefined
    if (entry.status === 'uninstalled' || entry.status === 'source-missing') return undefined
    return this.retainInstalledRevision(entry.id) ?? entry.installedFingerprint
  }

  private rehydrateUninstalledEntry(item: OperationItem): CatalogEntry | undefined {
    if (!item.previousEntry || !item.entryId) return undefined
    const catalog = loadCatalog(this.paths)
    const entry = structuredClone(item.previousEntry)
    entry.id = item.entryId
    entry.status = item.expectedStatus ?? 'uninstalled'
    upsertEntry(catalog, entry)
    saveCatalog(this.paths, catalog)
    return entry
  }

  private applyUninstallUndoState(id: string, item: OperationItem): void {
    const snapshot = item.previousEntry
    if (!snapshot) return
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) return
    entry.installedPath = snapshot.installedPath
    entry.disabledPath = snapshot.disabledPath
    entry.destinationId = snapshot.destinationId
    entry.installations = snapshot.installations ? structuredClone(snapshot.installations) : snapshot.installations
    upsertEntry(catalog, entry)
    saveCatalog(this.paths, catalog)
  }

  private retainInstalledRevision(id: string): string | undefined {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) return undefined
    if (entry.installedFingerprint && readRevisionBytes(this.paths, entry.installedFingerprint)) {
      return entry.installedFingerprint
    }
    const current = existingManagedFontPath(entry, 'installed', catalog.entries)
    if (!current) return undefined
    return storeRevision(this.paths, current, { faces: entry.faces, format: entry.format })?.fingerprint
  }

  private withDestinationFailures(
    entry: CatalogEntry,
    succeeded: OperationItem,
    failures: Array<{ destinationId: DestinationId; reason: string }>,
  ): OperationItem[] {
    if (failures.length === 0) return [succeeded]
    return [
      succeeded,
      ...failures.map((failure) => ({
        id: crypto.randomUUID(),
        entryId: entry.id,
        label:
          failure.destinationId === 'adobe-shared'
            ? `${displayEntry(entry)} · Adobe folder`
            : displayEntry(entry),
        outcome: 'failed' as const,
        reason: failure.reason,
      })),
    ]
  }

  private familyProgress(action: BatchProgressAction, ids: string[]) {
    const catalog = loadCatalog(this.paths)
    return familyProgressReporter(
      action,
      ids.map((id) => {
        const entry = findById(catalog, id)
        return { id, familyName: entry ? displayFamily(entry) : id }
      }),
      { onFamilyDone: () => emitCatalog(this.paths) },
    )
  }

  private commitManualOperation(
    action: string,
    items: OperationItem[],
    familyName?: string,
    undoable = true,
    familyNames?: Map<string, string>,
  ): Operation | undefined {
    if (items.length === 0) return undefined
    const catalog = loadCatalog(this.paths)
    const families = new Set(
      items
        .map((item) => (item.entryId ? findById(catalog, item.entryId) : undefined))
        .filter((entry): entry is CatalogEntry => Boolean(entry))
        .map((entry) => displayFamily(entry)),
    )
    for (const family of familyNames?.values() ?? []) families.add(family)
    if (families.size > 1) {
      items = items.map((item) => {
        const entry = item.entryId ? findById(catalog, item.entryId) : undefined
        const family = familyNames?.get(item.entryId ?? '') ?? (entry ? displayFamily(entry) : undefined)
        return family ? { ...item, label: `${family} · ${item.label}` } : item
      })
    }
    const operation = finishOperation(
      createOperation({ trigger: 'manual', action, familyName }),
      items,
    )
    if (!undoable) operation.undoable = false
    upsertOperation(this.paths, operation)
    emitEvent({ type: 'operations', operations: loadOperations(this.paths) })
    return operation
  }
}

function isProtectedSystem(filePath: string, paths: AppPaths): boolean {
  return isUnderAnyRoot(filePath, [paths.systemFontsDir, '/usr/share/fonts'])
}

export type FontStatus =
  | 'installed'
  | 'uninstalled'
  | 'outdated'
  | 'source-missing'
  | 'deactivated'

export type FontFaceInfo = {
  familyName: string
  styleName: string
  fullName: string
  postscriptName: string
  isVariable: boolean
  instanceCount: number
  instanceNames: string[]
  namedInstances?: Array<{ name: string; coordinates: Record<string, number> }>
  weight: number
  italic: boolean
}

export type SourceAvailability = 'none' | 'present' | 'missing' | 'offline' | 'unreadable'
export type UpdatePolicy = 'inherit' | 'manual' | 'automatic' | 'paused-after-rollback' | 'pinned'
export type UpdateHold = 'relink-review' | 'restore' | 'undo-install'
export type FolderPolicyPreset = 'library' | 'install-new' | 'install-new-and-updates' | 'custom'
export type DestinationId = 'macos' | 'adobe-shared'
export type DefaultDestinationId = DestinationId | 'macos-and-adobe'

export type InstallationCopy = {
  destinationId: DestinationId
  path: string
  parkedPath?: string
  fingerprint?: string
  verification: 'file-present' | 'unavailable'
}

export type DestinationCapability = {
  id: DestinationId
  label: string
  path: string
  exists: boolean
  writable: boolean
  supported: boolean
  activationVerified: boolean
  canCreate?: boolean
  reason?: string
  remedy?: string
}

export type DestinationInvestigationRow = {
  destination: string
  path: string
  macos: string
  applications: string
  formats: string
  refreshWhileOpen: string
  permissions: string
  systemConflict: string
  cleanup: string
  conclusion: string
}

export type ActivationOwner = {
  kind: 'manual' | 'project'
  projectId?: string
}

export type WatchFolder = {
  id: string
  root: string
  policy: FolderPolicyPreset
  installNew: boolean
  autoUpdate: boolean
  paused: boolean
  watching: boolean
  exclusions: string[]
  availability: SourceAvailability
  destinationId?: DefaultDestinationId
}

export type CatalogEntry = {
  id: string
  sourcePath: string
  sourceMtimeMs: number
  sourceSize: number
  sourcePresent?: boolean
  sourceAvailability?: SourceAvailability
  sourceFingerprint?: string
  installedFingerprint?: string
  previousRevisionId?: string
  updatePolicy?: UpdatePolicy
  updateHold?: UpdateHold | null
  ownerFolderId?: string | null
  previewOnly?: boolean
  activationOwners?: ActivationOwner[]
  destinationId?: DestinationId
  installations?: InstallationCopy[]
  installedSnapshotMtimeMs?: number
  installedSnapshotSize?: number
  status: FontStatus
  installedPath?: string
  disabledPath?: string
  customFamilyName?: string
  faces: FontFaceInfo[]
  format: string
  /** Font Book-style library-card glyph(s), derived from cmap coverage. */
  previewSample?: string
  addedAt: number
  updatedAt: number
}

export type SystemFace = {
  path: string
  familyName: string
  styleName: string
  fullName: string
  postscriptName: string
  isVariable: boolean
  instanceCount: number
  instanceNames?: string[]
  weight?: number
  italic?: boolean
  format: string
  previewSample?: string
  protected: boolean
  writable: boolean
  managedId?: string
  deactivated?: boolean
}

export type Notice = {
  kind: 'installed' | 'reinstalled' | 'error' | 'info'
  message: string
  entryId?: string
  operationId?: string
}

export type DuplicateWarning = {
  id: string
  path: string
  fingerprint?: string
  familyName?: string
  format?: string
  incomingVersion?: string
  conflictingEntryIds: string[]
  activeEntryId?: string
  folderId?: string
  notifyKey: string
  createdAt: number
  updatedAt: number
  notifiedAt?: number
}

export type SortMode = 'name' | 'added'

export type LibraryFilter =
  | 'installed'
  | 'deactivated'
  | 'uninstalled'
  | 'vf'
  | 'static'
  | 'source'
  | 'no-source'

export type SavedLibraryFilter = {
  id: string
  name: string
  query: string
  libraryFilters: LibraryFilter[]
  watchFolder: string | null
  createdAt: number
}

export type FamilyGroup = {
  key: string
  familyName: string
  entries: CatalogEntry[]
  faces: FontFaceInfo[]
  isVariable: boolean
  instanceCount: number
  status: FontStatus
  previewEntryId: string
  addedAt: number
}

export type ViewLayout = 'list' | 'grid'

export type ThemeMode = 'light' | 'dark' | 'system'

export type PreviewPreferences = {
  text: string
  size: number
  lineHeight: number
  preset: 'headline' | 'paragraph' | 'numerals' | 'custom'
}

export type OperationItem = {
  id: string
  entryId?: string
  label: string
  outcome: 'succeeded' | 'failed' | 'skipped' | 'canceled'
  reason?: string
  previousRevision?: string
  previousSourcePath?: string
  previousSourceMtimeMs?: number
  previousSourceSize?: number
  previousSourcePresent?: boolean
  previousSourceAvailability?: SourceAvailability
  previousSourceFingerprint?: string
  previousStatus?: FontStatus
  previousUpdateHold?: UpdateHold | null
  previousUpdatePolicy?: UpdatePolicy | null
  expectedRevision?: string
  expectedStatus?: FontStatus
  expectedSourcePath?: string
  relatedEntryId?: string
}

export type Operation = {
  id: string
  startedAt: number
  finishedAt?: number
  trigger: string
  action: string
  familyName?: string
  items: OperationItem[]
  outcome: string
  undoable: boolean
  undone: boolean
  unread?: boolean
}

export type ImportPlanItem = {
  id: string
  path: string
  classification: string
  entryId?: string
  familyName?: string
  format?: string
  fingerprint?: string
  faces?: FontFaceInfo[]
  affectedFaces?: string[]
  currentFormat?: string
  currentVersion?: string
  incomingVersion?: string
  reason?: string
  defaultChoice: 'keep' | 'replace' | 'install-as' | 'skip' | 'relink' | 'add-inactive' | 'switch'
  choices: Array<'keep' | 'replace' | 'install-as' | 'skip' | 'relink' | 'add-inactive' | 'switch'>
  previewOnly?: boolean
  parallelCopy?: boolean
  siblingEntryIds?: string[]
  sourceMtimeMs?: number
}

export type ImportPlan = {
  id: string
  items: ImportPlanItem[]
  summary: { add: number; install: number; unchanged: number; review: number; preview: number }
}

export type ProjectMember = {
  assetId: string
  pinFingerprint?: string
  unsatisfied?: boolean
}

export type ProjectSet = {
  id: string
  name: string
  members: ProjectMember[]
  desiredActive: boolean
}

export type RelinkPreview = {
  entryId: string
  oldPath: string
  proposedPath: string
  match: string
  identityMatch: boolean
  format: string
  bytesDiffer: boolean
  reason?: string
}

export type FolderRelinkRow = {
  entryId: string
  relativePath: string
  oldPath: string
  proposedPath?: string
  status: 'matched' | 'changed' | 'ambiguous' | 'not-found'
  candidates: string[]
  bytesDiffer: boolean
  selected?: string
}

export type FolderRelinkPreview = {
  oldRoot: string
  newRoot: string
  rows: FolderRelinkRow[]
}

export type FontAxisInfo = {
  tag: string
  name: string
  min: number
  default: number
  max: number
}

export type AppSettings = {
  version: 1
  watchFolders: string[]
  folders?: WatchFolder[]
  defaultView: ViewLayout
  defaultSort: SortMode
  installAfterUpload: boolean
  installWatchFolderFonts: boolean
  theme: ThemeMode
  menuBarIcon: boolean
  openAtLogin: boolean
  clearOfficeFontCache: boolean
  clearAdobeFontCache: boolean
  autoReinstallOnUpdate: boolean
  skipCacheClearOnReinstall: boolean
  nativeNotifications: boolean
  onboardingCompleted: boolean
  revisionBudgetBytes?: number
  activityRetentionDays?: number
  activityMaxOperations?: number
  specimen?: PreviewPreferences
  defaultDestination?: DefaultDestinationId
  savedFilters?: SavedLibraryFilter[]
}

export type OfficeFontCacheInfo = {
  path: string
  exists: boolean
}

export type AdobeFontCacheInfo = {
  exists: boolean
  paths: string[]
  roots: string[]
}

export type SystemFamilyGroup = {
  key: string
  familyName: string
  faces: SystemFace[]
  isVariable: boolean
  instanceCount: number
  protected: boolean
  writable: boolean
}

export type ComparisonCapture = {
  id: string
  installedFingerprint: string | null
  sourceFingerprint: string
}

export type AppUpdateAsset = {
  name: string
  url: string
  contentType?: string
  size?: number
}

export type AppUpdateStatus = {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseName: string | null
  releaseNotes: string | null
  htmlUrl: string | null
  publishedAt: string | null
  assets: AppUpdateAsset[]
  preferredAsset: AppUpdateAsset | null
  autoInstall: 'parked'
  checkedAt: number
  error?: string
}

export type {
  RetailDriftItem,
  RetailDriftKind,
  RetailFile,
  RetailSkip,
  RetailSkipReason,
  RetailSyncStatus,
} from '../../shared/retail'
export { retailDriftSummary } from '../../shared/retail'

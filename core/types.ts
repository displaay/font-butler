export const FONT_EXTENSIONS = ['.ttf', '.otf', '.ttc', '.otc'] as const
export const WEB_FONT_EXTENSIONS = ['.woff', '.woff2'] as const

export type FontStatus =
  | 'installed'
  | 'uninstalled'
  | 'outdated'
  | 'source-missing'
  | 'deactivated'

export type SourceAvailability = 'none' | 'present' | 'missing' | 'offline' | 'unreadable'

export type SourceComparison =
  | 'current'
  | 'update-available'
  | 'retained-different'
  | 'pending'
  | 'invalid'

export type UpdatePolicy = 'inherit' | 'manual' | 'automatic' | 'paused-after-rollback' | 'pinned'

export type UpdateHold = 'relink-review' | 'restore' | 'undo-install'

export type FolderPolicyPreset = 'library' | 'install-new' | 'install-new-and-updates' | 'custom'

export type DestinationId = 'macos' | 'adobe-shared'
export type DefaultDestinationId = DestinationId | 'macos-and-adobe'

export type InstallationVerification = 'file-present' | 'unavailable'

export type InstallationCopy = {
  destinationId: DestinationId
  path: string
  parkedPath?: string
  fingerprint?: string
  verification: InstallationVerification
}

export type DestinationCapability = {
  id: DestinationId
  label: string
  path: string
  exists: boolean
  writable: boolean
  supported: boolean
  activationVerified: boolean
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

export type InstallOptions = {
  replace?: boolean
  destinationId?: DestinationId
  destinationIds?: DestinationId[]
  switch?: boolean
}

export type FontFaceInfo = {
  familyName: string
  styleName: string
  fullName: string
  postscriptName: string
  isVariable: boolean
  instanceCount: number
  instanceNames: string[]
  weight: number
  italic: boolean
}

export type FontAxisInfo = {
  tag: string
  name: string
  min: number
  default: number
  max: number
}

export type NamedInstanceInfo = {
  name: string
  coordinates: Record<string, number>
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
  storageVolumeId?: string
  sourceRoot?: string
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
  addedAt: number
  updatedAt: number
}

export type CatalogFile = {
  version: 1
  entries: CatalogEntry[]
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

export type ViewLayout = 'list' | 'grid'

export type SortMode = 'name' | 'added'

export type ThemeMode = 'light' | 'dark' | 'system'

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

export type SpecimenPreset = 'headline' | 'paragraph' | 'numerals' | 'custom'

export type PreviewPreferences = {
  text: string
  size: number
  lineHeight: number
  preset: SpecimenPreset
}

export type AppSettings = {
  version: 1
  watchFolders: string[]
  folders: WatchFolder[]
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
  revisionBudgetBytes: number
  activityRetentionDays: number
  activityMaxOperations: number
  specimen?: PreviewPreferences
  defaultDestination?: DefaultDestinationId
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

export type OperationTrigger =
  | 'import'
  | 'watch'
  | 'menu-bar'
  | 'project'
  | 'repair'
  | 'relink'
  | 'restore'
  | 'undo'
  | 'manual'
  | 'open-with'
  | 'startup'

export type OperationOutcome = 'pending' | 'succeeded' | 'partial' | 'failed' | 'canceled'

export type OperationItemOutcome = 'succeeded' | 'failed' | 'skipped' | 'canceled'

export type OperationItem = {
  id: string
  entryId?: string
  label: string
  outcome: OperationItemOutcome
  reason?: string
  expectedRevision?: string
  previousRevision?: string
  relatedEntryId?: string
}

export type Operation = {
  id: string
  startedAt: number
  finishedAt?: number
  trigger: OperationTrigger
  action: string
  familyName?: string
  destination?: string
  items: OperationItem[]
  outcome: OperationOutcome
  undoable: boolean
  undone: boolean
  idempotencyKey?: string
}

export type OperationFile = {
  version: 1
  operations: Operation[]
}

export type FontRevision = {
  fingerprint: string
  format: string
  size: number
  faces: FontFaceInfo[]
  createdAt: number
  refs: number
}

export type RevisionIndex = {
  version: 1
  revisions: FontRevision[]
}

export type ActivationOwner = {
  kind: 'manual' | 'project'
  projectId?: string
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

export type ProjectFile = {
  version: 1
  projects: ProjectSet[]
}

export type ImportClassification =
  | 'new'
  | 'identical'
  | 'revision'
  | 'alt-format'
  | 'new-style'
  | 'collection-overlap'
  | 'unsupported'
  | 'preview-only'

export type ImportPlanChoice =
  | 'keep'
  | 'replace'
  | 'install-as'
  | 'skip'
  | 'relink'
  | 'add-inactive'
  | 'switch'

export type ImportPlanItem = {
  id: string
  path: string
  classification: ImportClassification
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
  defaultChoice: ImportPlanChoice
  choices: ImportPlanChoice[]
  previewOnly?: boolean
  parallelCopy?: boolean
  siblingEntryIds?: string[]
  sourceMtimeMs?: number
}

export type ImportPlan = {
  id: string
  createdAt: number
  trigger: OperationTrigger
  folderId?: string
  expectedCatalogRevision: number
  items: ImportPlanItem[]
  summary: {
    add: number
    install: number
    unchanged: number
    review: number
    preview: number
  }
}

export type RelinkMatchKind = 'fingerprint' | 'identity' | 'ambiguous' | 'mismatch' | 'missing'

export type RelinkPreview = {
  entryId: string
  oldPath: string
  proposedPath: string
  match: RelinkMatchKind
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

export type RepairItemResult = {
  target: string
  kind: 'font' | 'ats' | 'office' | 'adobe'
  outcome: 'succeeded' | 'not-found' | 'unavailable' | 'failed'
  reason?: string
}

export type BatchActionResult = {
  operationId: string
  succeeded: number
  failed: number
  skipped: number
  canceled: number
  errors: string[]
  entries: CatalogEntry[]
  failedIds: string[]
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

export type ServiceEvent =
  | { type: 'catalog'; entries: CatalogEntry[] }
  | { type: 'system'; faces: SystemFace[] }
  | { type: 'notice'; notice: Notice }
  | { type: 'settings'; settings: AppSettings }
  | { type: 'operations'; operations: Operation[] }
  | { type: 'projects'; projects: ProjectSet[] }
  | { type: 'duplicates'; duplicates: DuplicateWarning[] }

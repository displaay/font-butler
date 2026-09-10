/**
 * Types shared by the retail-sync server code and the UI.
 *
 * Mirrors the worker's `admin-worker/src/routes/font-butler/types.ts`. Kept in `shared/` for the same
 * reason `shared/app-update.ts` is: both the Node server and the renderer need them.
 */

export type RetailFile = {
  /** Full R2 key. Opaque here — it is handed straight back to the worker's file proxy. */
  key: string
  /** Identity that survives a revision bump: `<GlyphsFile name>/<basename>`. Flattened to Fonts on install. */
  relativePath: string
  size: number
  etag: string
  uploaded: string
}

export type RetailCollection = {
  glyphsFile: string
  revisionId: string
  /** `GlyphsFileStats.lastRegenerateFinishedAt` — the timestamp that says whether R2 moved on. */
  lastRegeneratedAt: string | null
  files: RetailFile[]
}

export type RetailSkipReason =
  | 'regenerating'
  | 'no-active-revision'
  | 'no-transaction'
  | 'transaction-not-succeeded'
  /** transaction.json and the bucket listing disagree, so the generation is still landing. */
  | 'incomplete'
  /** No desktop fonts in this revision at all. */
  | 'no-files'
  /** The server could not read this one family; the rest of the manifest is still valid. */
  | 'error'

export type RetailSkip = {
  glyphsFile: string
  reason: RetailSkipReason
}

export type RetailManifest = {
  generatedAt: string
  collections: RetailCollection[]
  skipped: RetailSkip[]
}

/**
 * What the last successful sync put on disk. Persisted next to the catalog so a later check can tell
 * "R2 changed" from "someone edited the local copy".
 */
export type RetailLocalManifest = {
  version: 1
  syncedAt: string | null
  /** Keyed by `relativePath`, because that is the identity that survives a revision bump. */
  files: Record<string, RetailLocalFile>
}

export type RetailLocalFile = {
  key: string
  relativePath: string
  size: number
  etag: string
  glyphsFile: string
  revisionId: string
  syncedAt: string
  /** Last install path in ~/Library/Fonts (or the parked copy). */
  installedPath?: string
  /** True when installedPath is a parked copy kept out of the live Fonts folder. */
  parked?: boolean
}

export type RetailDriftKind =
  /** On R2, never synced here. */
  | 'added'
  /** Synced before, but R2 now holds different bytes. */
  | 'changed'
  /** Synced before, gone from R2 now. Reported only — never deleted automatically. */
  | 'removed'
  /** In the local manifest, but the file is not on disk. */
  | 'missing-locally'
  /** On disk, but its size no longer matches what was synced. */
  | 'corrupt-locally'
  /** Two collections claim the same local path. Reported, never synced — writing either would thrash. */
  | 'conflict'
  /** The server proposed a path we will not write. Reported so it cannot fail silently. */
  | 'refused'

export type RetailDriftItem = {
  kind: RetailDriftKind
  relativePath: string
  glyphsFile: string
  /** Absent for `removed`, where there is no remote file left to describe. */
  remote?: RetailFile
  local?: RetailLocalFile
  /** Why a `conflict` or `refused` item was not synced, for the UI to show. */
  note?: string
}

export type RetailSyncStatus = {
  enabled: boolean
  /** Background check interval in minutes; `0` means the app never checks on its own. */
  autoCheckMinutes: number
  configured: boolean
  hasToken: boolean
  workerBaseUrl: string
  checkedAt: string | null
  syncedAt: string | null
  /** Only drift that a sync would act on: added + changed + missing-locally + corrupt-locally. */
  pending: number
  drift: RetailDriftItem[]
  skipped: RetailSkip[]
  error: string | null
}

/**
 * How often the app re-checks the collection in the background, in minutes. `0` turns it off.
 *
 * Background checks deliberately do NOT pass `refresh`, so they are served from the worker's cached
 * manifest — the regenerate webhook purges that cache, so a fresh generation still shows up promptly
 * without every client rebuilding the manifest on its own schedule. The manual Check button passes
 * `refresh` and rebuilds.
 */
export const DEFAULT_RETAIL_AUTOCHECK_MINUTES = 60

export const RETAIL_AUTOCHECK_CHOICES: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0, label: 'Never' },
  { minutes: 15, label: 'Every 15 minutes' },
  { minutes: 60, label: 'Every hour' },
  { minutes: 360, label: 'Every 6 hours' },
]

export function normalizeAutoCheckMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return DEFAULT_RETAIL_AUTOCHECK_MINUTES
  }
  // Only an exact 0 means "never". Rounding first would turn a positive sub-minute value into 0 and
  // silently stop checking altogether, which is the opposite of what asking for 0.2 wants.
  if (value === 0) return 0
  return Math.max(1, Math.round(value))
}

/** Drift kinds a sync actually downloads. `removed` is reported but never acted on. */
export const SYNCABLE_DRIFT_KINDS: readonly RetailDriftKind[] = [
  'added',
  'changed',
  'missing-locally',
  'corrupt-locally',
]

export function isSyncableDrift(item: RetailDriftItem): boolean {
  return SYNCABLE_DRIFT_KINDS.includes(item.kind)
}

export function emptyRetailLocalManifest(): RetailLocalManifest {
  return { version: 1, syncedAt: null, files: {} }
}

export function retailDriftSummary(status: {
  pending: number
  drift: RetailDriftItem[]
  error?: string | null
}): string {
  // An error means the numbers below were never measured, or are left over from an earlier check.
  // Saying "Up to date." here would be the one wording that actively misleads.
  if (status.error) {
    return 'Could not check the collection.'
  }
  if (status.pending > 0) {
    return `${status.pending} ${status.pending === 1 ? 'file' : 'files'} to sync.`
  }
  // A blocked file must never read as "up to date" — that is the one wording that would hide it.
  const blocked = status.drift.filter(
    (item) => item.kind === 'conflict' || item.kind === 'refused',
  ).length
  if (blocked > 0) {
    return `Up to date. ${blocked} ${blocked === 1 ? 'file was' : 'files were'} skipped and need attention.`
  }
  const removed = status.drift.filter((item) => item.kind === 'removed').length
  if (removed > 0) {
    return `Up to date. ${removed} ${removed === 1 ? 'file is' : 'files are'} no longer on the server.`
  }
  return 'Up to date.'
}

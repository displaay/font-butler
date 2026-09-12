/**
 * Types shared by the retail-sync server code and the UI.
 *
 * Mirrors the worker's `admin-worker/src/routes/font-butler/types.ts`. Kept in `shared/` for the same
 * reason `shared/app-update.ts` is: both the Node server and the renderer need them.
 */

export type RetailFontFormat = 'otf' | 'ttf'

export type RetailFile = {
  /** Full R2 key. Opaque here — it is handed straight back to the worker's file proxy. */
  key: string
  /** Identity that survives a revision bump: `<typeface>/<basename>`. Flattened to Fonts on install. */
  relativePath: string
  size: number
  etag: string
  uploaded: string
  /** OpenType family this file belongs to (child row in Settings). */
  familyName?: string
}

export type RetailCollection = {
  /** Legacy collection id. New manifests send `typefaceName` instead (or as well). */
  glyphsFile?: string
  /** Parent typeface shown in Settings (e.g. Azeret wrapping Azeret / Azeret Mono / Azeret VF). */
  typefaceName?: string
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
  glyphsFile?: string
  typefaceName?: string
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
  familyName?: string
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
  familyName?: string
  /** Absent for `removed`, where there is no remote file left to describe. */
  remote?: RetailFile
  local?: RetailLocalFile
  /** Why a `conflict` or `refused` item was not synced, for the UI to show. */
  note?: string
}

export type RetailSyncFont = {
  familyName: string
  typefaceName: string
  /** Same as `familyName`. Kept so older callers that keyed off glyphsFile still match. */
  glyphsFile: string
  fileCount: number
  /** False when this family is in `disabledGlyphsFiles`. */
  enabled: boolean
  /** False when the last check said this family is not ready to sync. */
  available: boolean
  /** Desktop formats present for this family. One format means on/off only. */
  formats: RetailFontFormat[]
  /** Format that Sync will download. Ignored when `formats` has a single entry. */
  selectedFormat: RetailFontFormat
}

/** Replace the other copy, or keep it and stop acting on that family. */
export type RetailCollisionAction = 'replace' | 'keep'

export type RetailFamilyCollision = {
  familyName: string
  typefaceName: string
  entryIds: string[]
  installedLabel: string
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
  /** Families from the last successful check (or catalog listings after a restart). */
  fonts: RetailSyncFont[]
  disabledGlyphsFiles: string[]
  familyFormats: Record<string, RetailFontFormat>
  /** Outside installs that share a family with a pending retail sync. Empty when none. */
  collisions: RetailFamilyCollision[]
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

export const RETAIL_FONT_FORMATS: readonly RetailFontFormat[] = ['otf', 'ttf']

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

export function retailTypefaceName(collection: {
  typefaceName?: string
  glyphsFile?: string
}): string {
  const typeface = typeof collection.typefaceName === 'string' ? collection.typefaceName.trim() : ''
  if (typeface) return typeface
  return typeof collection.glyphsFile === 'string' ? collection.glyphsFile.trim() : ''
}

export function retailSkipName(skip: { typefaceName?: string; glyphsFile?: string }): string {
  return retailTypefaceName(skip)
}

export function retailFileFamilyName(
  file: { familyName?: string },
  collection: { typefaceName?: string; glyphsFile?: string },
): string {
  const family = typeof file.familyName === 'string' ? file.familyName.trim() : ''
  if (family) return family
  return retailTypefaceName(collection)
}

export function retailFileFormat(relativePath: string): RetailFontFormat | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(relativePath)
  const ext = match?.[1]?.toLowerCase()
  if (ext === 'otf' || ext === 'ttf') return ext
  return null
}

export function normalizeDisabledGlyphsFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names.sort((left, right) => left.localeCompare(right))
}

export function normalizeFamilyFormats(value: unknown): Record<string, RetailFontFormat> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const formats: Record<string, RetailFontFormat> = {}
  for (const [rawName, rawFormat] of Object.entries(value as Record<string, unknown>)) {
    const name = rawName.trim()
    if (!name) continue
    if (rawFormat !== 'otf' && rawFormat !== 'ttf') continue
    formats[name] = rawFormat
  }
  return formats
}

export function defaultRetailFormat(
  formats: readonly RetailFontFormat[],
  chosen?: RetailFontFormat,
): RetailFontFormat {
  if (chosen && formats.includes(chosen)) return chosen
  if (formats.includes('otf')) return 'otf'
  if (formats.includes('ttf')) return 'ttf'
  return 'otf'
}

function sortedFormats(values: Iterable<RetailFontFormat>): RetailFontFormat[] {
  const seen = new Set<RetailFontFormat>()
  for (const value of values) seen.add(value)
  return RETAIL_FONT_FORMATS.filter((format) => seen.has(format))
}

export function retailDriftFamilyName(item: {
  familyName?: string
  glyphsFile?: string
  remote?: { familyName?: string }
  local?: { familyName?: string; glyphsFile?: string }
}): string {
  const named =
    item.familyName?.trim() ||
    item.remote?.familyName?.trim() ||
    item.local?.familyName?.trim() ||
    item.glyphsFile?.trim() ||
    item.local?.glyphsFile?.trim() ||
    ''
  return named
}

export type RetailSyncSelection = {
  disabledFamilyNames?: readonly string[]
  familyFormats?: Readonly<Record<string, RetailFontFormat>>
  selectedFormats?: Readonly<Record<string, RetailFontFormat>>
  /** `typeface` also matches collection names saved before family rows existed. */
  optOutMode?: RetailOptOutMode
}

/** How `disabledGlyphsFiles` is interpreted. `typeface` is the pre-family-row meaning. */
export type RetailOptOutMode = 'family' | 'typeface'

export function isRetailFamilyOptedOut(
  familyName: string,
  typefaceName: string,
  disabledNames: readonly string[] | ReadonlySet<string>,
  mode: RetailOptOutMode = 'family',
): boolean {
  const disabled = disabledNames instanceof Set ? disabledNames : new Set(disabledNames)
  if (familyName && disabled.has(familyName)) return true
  // Saved collection opt-outs used the typeface/glyphsFile name. Matching only familyName would
  // re-enable Azeret Mono / Azeret VF when the user had turned off Azeret.
  if (mode === 'typeface' && typefaceName && disabled.has(typefaceName)) return true
  return false
}

export function selectedRetailFormat(
  familyName: string,
  formats: readonly RetailFontFormat[],
  familyFormats: Readonly<Record<string, RetailFontFormat>> = {},
): RetailFontFormat {
  return defaultRetailFormat(formats, familyFormats[familyName])
}

export function isSelectedRetailFormat(
  relativePath: string,
  familyName: string,
  selection: RetailSyncSelection,
): boolean {
  const format = retailFileFormat(relativePath)
  if (!format) return true
  const selected = selection.selectedFormats?.[familyName] ?? selection.familyFormats?.[familyName]
  if (!selected) return true
  return format === selected
}

export function filterDisabledRetailDrift(
  drift: RetailDriftItem[],
  disabledGlyphsFiles: readonly string[],
  selection: RetailSyncSelection = {},
): RetailDriftItem[] {
  const disabled = new Set(
    selection.disabledFamilyNames ?? disabledGlyphsFiles,
  )
  const hasFormatFilter = Boolean(
    selection.selectedFormats && Object.keys(selection.selectedFormats).length > 0,
  ) || Boolean(selection.familyFormats && Object.keys(selection.familyFormats).length > 0)
  if (disabled.size === 0 && !hasFormatFilter) return drift
  const mode = selection.optOutMode ?? 'family'
  return drift.filter((item) => {
    const family = retailDriftFamilyName(item)
    const typeface = item.glyphsFile?.trim() || family
    if (isRetailFamilyOptedOut(family, typeface, disabled, mode)) return false
    if (!hasFormatFilter) return true
    return isSelectedRetailFormat(item.relativePath, family, selection)
  })
}

export function selectedFormatsFromFonts(
  fonts: Array<{ familyName: string; selectedFormat: RetailFontFormat }>,
): Record<string, RetailFontFormat> {
  const selected: Record<string, RetailFontFormat> = {}
  for (const font of fonts) {
    selected[font.familyName] = font.selectedFormat
  }
  return selected
}

type RetailFontAccumulator = {
  familyName: string
  typefaceName: string
  formats: Set<RetailFontFormat>
  counts: Map<RetailFontFormat | 'other', number>
  available: boolean
}

function takeFamily(
  families: Map<string, RetailFontAccumulator>,
  familyName: string,
  typefaceName: string,
): RetailFontAccumulator {
  const existing = families.get(familyName)
  if (existing) return existing
  const created: RetailFontAccumulator = {
    familyName,
    typefaceName,
    formats: new Set(),
    counts: new Map(),
    available: true,
  }
  families.set(familyName, created)
  return created
}

function addFileToFamily(family: RetailFontAccumulator, relativePath: string | undefined): void {
  const format = relativePath ? retailFileFormat(relativePath) : null
  if (format) family.formats.add(format)
  const key = format ?? 'other'
  family.counts.set(key, (family.counts.get(key) ?? 0) + 1)
}

function finishFamilies(
  families: Map<string, RetailFontAccumulator>,
  disabledFamilyNames: readonly string[],
  familyFormats: Readonly<Record<string, RetailFontFormat>>,
  optOutMode: RetailOptOutMode = 'family',
): RetailSyncFont[] {
  const disabled = new Set(disabledFamilyNames)
  const fonts: RetailSyncFont[] = []
  for (const family of families.values()) {
    const formats = sortedFormats(family.formats)
    const selectedFormat = selectedRetailFormat(family.familyName, formats, familyFormats)
    const fileCount =
      formats.length === 0
        ? [...family.counts.values()].reduce((sum, count) => sum + count, 0)
        : (family.counts.get(selectedFormat) ?? 0)
    fonts.push({
      familyName: family.familyName,
      typefaceName: family.typefaceName,
      glyphsFile: family.familyName,
      fileCount,
      enabled: !isRetailFamilyOptedOut(family.familyName, family.typefaceName, disabled, optOutMode),
      available: family.available,
      formats,
      selectedFormat,
    })
  }
  fonts.sort((left, right) => {
    const typeface = left.typefaceName.localeCompare(right.typefaceName)
    if (typeface !== 0) return typeface
    return left.familyName.localeCompare(right.familyName)
  })
  return fonts
}

export function retailFontsFromCollections(
  collections: Array<{
    glyphsFile?: string
    typefaceName?: string
    files?: unknown[]
  }> | undefined,
  disabledGlyphsFiles: readonly string[] = [],
  skipped: Array<{ glyphsFile?: string; typefaceName?: string }> | undefined = undefined,
  familyFormats: Readonly<Record<string, RetailFontFormat>> = {},
  optOutMode: RetailOptOutMode = 'family',
): RetailSyncFont[] {
  const families = new Map<string, RetailFontAccumulator>()
  for (const collection of collections ?? []) {
    const typefaceName = retailTypefaceName(collection)
    if (!typefaceName) continue
    const files = Array.isArray(collection.files) ? collection.files : []
    let sawFile = false
    for (const file of files) {
      if (!file || typeof file !== 'object') continue
      sawFile = true
      const row = file as { familyName?: string; relativePath?: string }
      const familyName = retailFileFamilyName(row, collection)
      if (!familyName) continue
      addFileToFamily(takeFamily(families, familyName, typefaceName), row.relativePath)
    }
    if (!sawFile && files.length > 0) {
      const family = takeFamily(families, typefaceName, typefaceName)
      family.counts.set('other', (family.counts.get('other') ?? 0) + files.length)
    }
  }
  for (const skip of skipped ?? []) {
    const name = retailSkipName(skip)
    if (!name || families.has(name)) continue
    const family = takeFamily(families, name, name)
    family.available = false
  }
  return finishFamilies(families, disabledGlyphsFiles, familyFormats, optOutMode)
}

export function applyRetailFontSelection(
  fonts: Array<{
    familyName?: string
    typefaceName?: string
    glyphsFile?: string
    fileCount: number
    available?: boolean
    formats?: RetailFontFormat[]
    selectedFormat?: RetailFontFormat
  }>,
  disabledGlyphsFiles: readonly string[] = [],
  familyFormats: Readonly<Record<string, RetailFontFormat>> = {},
  optOutMode: RetailOptOutMode = 'family',
): RetailSyncFont[] {
  const disabled = new Set(disabledGlyphsFiles)
  return fonts
    .map((font) => {
      const familyName = (font.familyName ?? font.glyphsFile ?? '').trim()
      const typefaceName = (font.typefaceName ?? familyName).trim()
      const formats = sortedFormats(font.formats ?? [])
      const selectedFormat = selectedRetailFormat(familyName, formats, familyFormats)
      return {
        familyName,
        typefaceName,
        glyphsFile: familyName,
        fileCount: font.fileCount,
        enabled: Boolean(familyName) && !isRetailFamilyOptedOut(familyName, typefaceName, disabled, optOutMode),
        available: font.available !== false,
        formats,
        selectedFormat,
      }
    })
    .filter((font) => font.familyName)
    .sort((left, right) => {
      const typeface = left.typefaceName.localeCompare(right.typefaceName)
      if (typeface !== 0) return typeface
      return left.familyName.localeCompare(right.familyName)
    })
}

export function groupRetailFontsByTypeface(
  fonts: RetailSyncFont[],
): Array<{ typefaceName: string; fonts: RetailSyncFont[] }> {
  const groups: Array<{ typefaceName: string; fonts: RetailSyncFont[] }> = []
  const index = new Map<string, number>()
  for (const font of fonts) {
    const existing = index.get(font.typefaceName)
    if (existing === undefined) {
      index.set(font.typefaceName, groups.length)
      groups.push({ typefaceName: font.typefaceName, fonts: [font] })
      continue
    }
    groups[existing]!.fonts.push(font)
  }
  return groups
}

export function retailLibraryEntryVisible(
  entry: {
    retailRelativePath?: string | null
    retailFamilyName?: string | null
    faces?: Array<{ familyName?: string }>
  },
  fonts: readonly RetailSyncFont[],
): boolean {
  const relative = entry.retailRelativePath
  if (!relative) return true
  if (fonts.length === 0) return true
  const familyName = (entry.retailFamilyName ?? entry.faces?.[0]?.familyName ?? '').trim()
  const font = fonts.find((item) => item.familyName === familyName)
  if (!font || font.formats.length < 2) return true
  const format = retailFileFormat(relative)
  if (!format) return true
  return format === font.selectedFormat
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

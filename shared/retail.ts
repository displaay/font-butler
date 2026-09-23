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
  /** Declared desktop fonts that are neither loose R2 objects nor members of fonts.zip. */
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

/**
 * Which half of the collection the worker served, decided by the token: the licensed retail files or
 * the trial cut (`<revision>-TRIALS/`, `Matter-TRIAL-Regular.otf`).
 */
export type RetailCollectionMode = 'retail' | 'trial'

export type RetailManifest = {
  /** Absent from workers that predate trial tokens; those only ever served retail. */
  mode?: RetailCollectionMode
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
  /** True while a download/install pass is running. Survives a quit so the next launch can resume. */
  incomplete?: boolean
  /** Mode of the last successful check. Absent in records written before trial tokens existed. */
  mode?: RetailCollectionMode
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

/** Turning the collection off: leave Fonts copies, or uninstall and forget the listings. */
export type RetailDisableAction = 'keep' | 'remove'

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
  /**
   * True when the user saved a token of their own. Without one the built-in trial token is used, so a
   * check never needs this to be true.
   */
  hasToken: boolean
  /** Collection the listings came from. Null before the first check on a fresh install. */
  mode: RetailCollectionMode | null
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
  /** True when a download/install pass was interrupted and still has work to do. */
  incomplete: boolean
  /** Family count for the in-flight download. Null when no sync is running. */
  progress: RetailSyncProgress | null
}

export type RetailSyncProgress = {
  /** Families whose files in this pass have all been written or failed. */
  done: number
  /** Distinct families this pass will download. Styles of one family count as one. */
  total: number
}

/** Subset the library uses to decide badges, instance marks, and stub visibility. */
export type RetailSyncView = {
  enabled: boolean
  /** `trial` adds the Trial badge next to the Displaay one. */
  mode?: RetailCollectionMode | null
  fonts: ReadonlyArray<Pick<RetailSyncFont, 'familyName' | 'enabled'>>
  disabledGlyphsFiles?: readonly string[]
}

export type RetailLibraryEntry = {
  retailRelativePath?: string | null
  retailFamilyName?: string | null
  faces?: Array<{ familyName?: string }>
  installedPath?: string | null
  disabledPath?: string | null
  installations?: Array<{
    path?: string
    parkedPath?: string
    verification?: 'file-present' | 'unavailable'
  }>
  sourcePath?: string | null
  sourcePresent?: boolean
  sourceAvailability?: 'none' | 'present' | 'missing' | 'offline' | 'unreadable'
  status?: string
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

export function nextDisabledRetailFamilyNames(
  fonts: ReadonlyArray<Pick<RetailSyncFont, 'familyName' | 'enabled'>>,
  names: readonly string[],
  enabled: boolean,
): string[] {
  const target = new Set(names)
  return fonts
    .filter((font) => (target.has(font.familyName) ? !enabled : !font.enabled))
    .map((font) => font.familyName)
}

export function matchesRetailFontQuery(
  font: Pick<RetailSyncFont, 'familyName' | 'typefaceName'>,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (
    font.familyName.toLowerCase().includes(needle) ||
    font.typefaceName.toLowerCase().includes(needle)
  )
}

/** Unpack glued worker names (`AzeretVFCollection`) before VF / collection heuristics run. */
export function normalizeRetailFamilyName(name: string): string {
  return name
    .trim()
    .replace(/VFCollection/gi, 'VF Collection')
    .replace(/([a-z0-9])(VF\b)/gi, '$1 $2')
}

/** Settings rows mark VF families in the name (`Aguzzo VF`, `AguzzoVF`). */
export function isRetailVariableFamilyName(name: string): boolean {
  const trimmed = normalizeRetailFamilyName(name)
  if (!trimmed) return false
  return /(?:^|[^a-z0-9])vf(?:$|[^a-z0-9])/i.test(trimmed) || /vf$/i.test(trimmed)
}

/**
 * A VF *collection* file, as opposed to a member family (`Azeret VF`, `Azeret Monospaced VF`).
 * Matched as a substring so `VF Collection` and a glued `VFCollection` both count.
 */
export function isRetailVfCollectionName(name: string): boolean {
  return /collections?/i.test(normalizeRetailFamilyName(name))
}

/** `Italic` and `Italics` are the same side. A collection on this side is its own top collection. */
export function isRetailItalicFamilyName(name: string): boolean {
  return /italics?/i.test(name.trim())
}

export type RetailSyncScope = 'all' | 'static' | 'vf-collections' | 'vf-all'

/**
 * Family names a Sync scope turns on.
 *
 * Collections only, per typeface: install every family whose name marks it as a collection, roman and
 * italic separately (`Reckless VF Collection` and `Reckless Italics VF Collection` are both tops).
 * When a typeface has VF families but none is named a collection, install those VF families — a lone
 * `Tobias VF` is the collection. Several collections on the same side are all installed; the manifest
 * has no parent pointer, so guessing one would drop a file. Typefaces with no VF family contribute
 * nothing. All installs every VF family. Static installs the rest.
 */
export function retailFamilyNamesForSyncScope(
  fonts: ReadonlyArray<Pick<RetailSyncFont, 'familyName' | 'typefaceName'>>,
  scope: RetailSyncScope,
): string[] {
  if (scope === 'all') return fonts.map((font) => font.familyName)
  if (scope === 'static') {
    return fonts.filter((font) => !isRetailVariableFamilyName(font.familyName)).map((font) => font.familyName)
  }
  if (scope === 'vf-all') {
    return fonts.filter((font) => isRetailVariableFamilyName(font.familyName)).map((font) => font.familyName)
  }
  const byTypeface = new Map<string, Array<Pick<RetailSyncFont, 'familyName' | 'typefaceName'>>>()
  for (const font of fonts) {
    if (!isRetailVariableFamilyName(font.familyName)) continue
    const key = font.typefaceName.trim() || font.familyName
    const list = byTypeface.get(key) ?? []
    list.push(font)
    byTypeface.set(key, list)
  }
  const selected: string[] = []
  for (const group of byTypeface.values()) {
    const collections = group.filter((font) => isRetailVfCollectionName(font.familyName))
    if (collections.length === 0) {
      selected.push(...group.map((font) => font.familyName))
      continue
    }
    // Italic collections stay even when a roman collection exists; neither side collapses into the other.
    selected.push(
      ...collections
        .filter((font) => !isRetailItalicFamilyName(font.familyName))
        .map((font) => font.familyName),
      ...collections
        .filter((font) => isRetailItalicFamilyName(font.familyName))
        .map((font) => font.familyName),
    )
  }
  return selected
}

/**
 * True when "Collections only" would install a different set than every VF family.
 * Trial cuts and any other manifest with no collection-vs-member split return false, so the VF
 * control installs all VF files directly instead of offering a choice that changes nothing.
 * Decided from the family names in the manifest, not from whether a user token is saved.
 */
export function retailSyncOffersVfCollections(
  fonts: ReadonlyArray<Pick<RetailSyncFont, 'familyName' | 'typefaceName'>>,
): boolean {
  const collections = retailFamilyNamesForSyncScope(fonts, 'vf-collections')
  const all = retailFamilyNamesForSyncScope(fonts, 'vf-all')
  if (all.length === 0 || collections.length === 0) return false
  if (collections.length !== all.length) return true
  const selected = new Set(collections)
  return all.some((name) => !selected.has(name))
}

/** Disabled-family list for a scope, same shape Sync All writes (`disabledGlyphsFiles`). */
export function nextDisabledRetailFamilyNamesForScope(
  fonts: ReadonlyArray<Pick<RetailSyncFont, 'familyName' | 'typefaceName'>>,
  scope: RetailSyncScope,
): string[] {
  const enabled = new Set(retailFamilyNamesForSyncScope(fonts, scope))
  return fonts.filter((font) => !enabled.has(font.familyName)).map((font) => font.familyName)
}

export type RetailFontKindFilter = 'all' | 'static' | 'variable'

export function matchesRetailFontKindFilter(
  font: Pick<RetailSyncFont, 'familyName'>,
  kind: RetailFontKindFilter,
): boolean {
  if (kind === 'all') return true
  const variable = isRetailVariableFamilyName(font.familyName)
  return kind === 'variable' ? variable : !variable
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

export function retailFamilyNameOf(entry: RetailLibraryEntry): string {
  return (entry.retailFamilyName ?? entry.faces?.[0]?.familyName ?? '').trim()
}

function copyHasVerifiedBytes(copy: {
  path?: string
  parkedPath?: string
  verification?: 'file-present' | 'unavailable'
}): boolean {
  if (copy.parkedPath) return true
  return copy.verification === 'file-present' && Boolean(copy.path)
}

/**
 * Verified managed/parked bytes, or a source the catalog still marks present.
 * Live Fonts/Adobe paths count only as `verification: 'file-present'`. A parked
 * vault is `parkedPath` / `disabledPath`. `installedPath` or `copy.path` alone
 * is not enough — same spirit as `previewUsesInstalledBytes` in core.
 */
function sourceHasLiveBytes(entry: RetailLibraryEntry): boolean {
  const source = entry.sourcePath?.trim()
  if (!source) return false
  if (entry.sourcePresent === false) return false
  // Defined availability wins over a leftover `sourcePresent: true`. Undefined
  // keeps the legacy "path is present" case used by older catalog rows.
  if (entry.sourceAvailability && entry.sourceAvailability !== 'present') return false
  return true
}

export function retailListingHasLocalFile(entry: RetailLibraryEntry): boolean {
  if (entry.disabledPath) return true
  const copies = entry.installations ?? []
  if (copies.some(copyHasVerifiedBytes)) return true
  return sourceHasLiveBytes(entry)
}

/**
 * Installed, deactivated, or otherwise on the Mac. An `uninstalled` retail listing can still point at a
 * copy parked in the retail cache (a re-sync after an uninstall); that copy is ours, not the user's.
 */
export function retailListingOnMac(entry: RetailLibraryEntry): boolean {
  if (!retailListingHasLocalFile(entry)) return false
  if (entry.retailRelativePath && entry.status === 'uninstalled') return false
  return true
}

/** Not-installed Displaay listings left in the catalog after collection sync is off. */
export function isOrphanRetailListing(
  entry: RetailLibraryEntry,
  syncEnabled = false,
): boolean {
  if (syncEnabled) return false
  if (!entry.retailRelativePath) return false
  return !retailListingOnMac(entry)
}

/**
 * Badge / synced mark only when collection sync is on and this family is still
 * in the sync set (`fonts[].enabled`). An unlisted family is inactive, including
 * when `fonts` is empty after a successful empty check.
 */
export function entryHasActiveRetailSync(
  entry: RetailLibraryEntry,
  retail?: RetailSyncView | null,
): boolean {
  if (!entry.retailRelativePath) return false
  if (!retail?.enabled) return false
  const familyName = retailFamilyNameOf(entry)
  if (!familyName) return false
  const font = retail.fonts.find((item) => item.familyName === familyName)
  return Boolean(font?.enabled)
}

/**
 * File-less collection listings stay in the catalog after sync is turned off.
 * Unknown status must be treated as off, otherwise the library shows every
 * stub until `/api/retail/status` arrives.
 */
export function retailSyncIsOn(retail?: Pick<RetailSyncView, 'enabled'> | null): boolean {
  return retail?.enabled === true
}

export function retailLibraryEntryVisible(
  entry: RetailLibraryEntry,
  fonts: readonly RetailSyncFont[],
  syncEnabled = true,
): boolean {
  const relative = entry.retailRelativePath
  if (!relative) return true
  if (!syncEnabled) return retailListingOnMac(entry)
  if (fonts.length === 0) return retailListingOnMac(entry)
  const familyName = retailFamilyNameOf(entry)
  const font = fonts.find((item) => item.familyName === familyName)
  if (!font || !font.enabled) return retailListingOnMac(entry)
  if (font.formats.length < 2) return true
  const format = retailFileFormat(relative)
  if (!format) return true
  return format === font.selectedFormat
}

export function normalizeRetailMode(value: unknown): RetailCollectionMode | undefined {
  return value === 'retail' || value === 'trial' ? value : undefined
}

/**
 * Mode of one R2 key (`<glyphsFile>/<revisionId>[-TRIALS]/<basename>`), mirroring the worker's own
 * `allowedCollectionKeys` rule. Lets a local record written before `mode` existed say which collection
 * its files came from.
 */
export function retailModeOfKey(key: string): RetailCollectionMode {
  const slash = key.lastIndexOf('/')
  return key.slice(0, Math.max(slash, 0)).endsWith('-TRIALS') ? 'trial' : 'retail'
}

/** Stored mode, else inferred from the synced keys; undefined when nothing was ever synced. */
export function retailLocalManifestMode(local: RetailLocalManifest): RetailCollectionMode | undefined {
  if (local.mode) return local.mode
  const first = Object.values(local.files)[0]
  return first ? retailModeOfKey(first.key) : undefined
}

export function emptyRetailLocalManifest(): RetailLocalManifest {
  return { version: 1, syncedAt: null, files: {} }
}

/** How many families in this download pass are finished. Styles of one family count as one. */
export function retailSyncFamilyProgress(
  todo: ReadonlyArray<{
    familyName?: string
    relativePath: string
    glyphsFile?: string
    remote?: { familyName?: string }
  }>,
  processedRelativePaths: ReadonlySet<string>,
): RetailSyncProgress {
  const families = new Map<string, string[]>()
  for (const item of todo) {
    const name = retailDriftFamilyName(item) || item.relativePath
    const files = families.get(name) ?? []
    files.push(item.relativePath)
    families.set(name, files)
  }
  let done = 0
  for (const files of families.values()) {
    if (files.every((relativePath) => processedRelativePaths.has(relativePath))) done += 1
  }
  return { done, total: families.size }
}

export function retailSyncingStatusMessage(progress?: RetailSyncProgress | null): string {
  if (progress && progress.total > 0) {
    return `Syncing Displaay retail… ${progress.done}/${progress.total}`
  }
  return 'Syncing Displaay retail…'
}

/** Families in a None/Off batch that are still syncing and have fonts on the Mac. */
export function retailFamiliesOffInstalled(
  fonts: ReadonlyArray<Pick<RetailSyncFont, 'familyName' | 'enabled'>>,
  familyNames: readonly string[],
  familiesOnMac: ReadonlySet<string> = new Set(),
): number {
  const batch = new Set(familyNames)
  return fonts.filter((font) => font.enabled && batch.has(font.familyName) && familiesOnMac.has(font.familyName))
    .length
}

/** None while a pass runs, or over installed fonts, asks whether to keep or uninstall what landed. */
export function retailFamiliesOffNeedsChoice(
  fonts: ReadonlyArray<Pick<RetailSyncFont, 'familyName' | 'enabled'>>,
  familyNames: readonly string[],
  status: { progress?: RetailSyncProgress | null } | null | undefined,
  familiesOnMac?: ReadonlySet<string>,
): boolean {
  const batch = new Set(familyNames)
  if (!fonts.some((font) => font.enabled && batch.has(font.familyName))) return false
  return retailSyncInProgress(status) || retailFamiliesOffInstalled(fonts, familyNames, familiesOnMac) > 0
}

export function isRetailSyncingStatusMessage(message: string | null | undefined): boolean {
  return Boolean(message?.startsWith('Syncing Displaay retail…'))
}

/** A status with no family progress means no download pass is running, however the last one ended. */
export function retailSyncInProgress(status: { progress?: RetailSyncProgress | null } | null | undefined): boolean {
  return Boolean(status?.progress && status.progress.total > 0)
}

/**
 * Updates-tab total: remaining families while a sync is in flight, otherwise pending files.
 * `pending` is only remasured when a check or sync finishes, so the badge must not use it mid-sync.
 */
export function retailUpdateCount(status: {
  pending: number
  progress?: RetailSyncProgress | null
} | null | undefined): number {
  if (!status) return 0
  const progress = status.progress
  if (progress && progress.total > 0) {
    return Math.max(0, progress.total - progress.done)
  }
  return Math.max(0, status.pending)
}

/** Keep the Updates tab open while a download is still running, even if remaining is already 0. */
export function retailHasLiveUpdates(status: {
  pending: number
  progress?: RetailSyncProgress | null
} | null | undefined): boolean {
  if (!status) return false
  if (status.progress && status.progress.total > 0) return true
  return status.pending > 0
}

export function retailDriftSummary(status: {
  pending: number
  drift: RetailDriftItem[]
  error?: string | null
  skipped?: RetailSkip[]
}): string {
  // An error means the numbers below were never measured, or are left over from an earlier check.
  // Saying "Up to date." here would be the one wording that actively misleads.
  if (status.error) {
    return 'Could not check the collection.'
  }
  if (status.pending > 0) {
    return `${status.pending} ${status.pending === 1 ? 'file' : 'files'} to sync.`
  }
  // Skipped families never become pending, so an empty drift list is not "up to date".
  const skipped = status.skipped?.length ?? 0
  if (skipped > 0) {
    return `${skipped} ${skipped === 1 ? 'family is' : 'families are'} not available on the worker.`
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

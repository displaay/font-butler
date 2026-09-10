import type { CatalogEntry, DestinationId } from './types'

export const INSTALLABLE_FORMATS = ['otf', 'ttf', 'ttc', 'otc'] as const
export const WOFF_INSTALL_ERROR = 'WOFF files cannot be installed.'

export type InstallableFormat = (typeof INSTALLABLE_FORMATS)[number]

export type FormatCount = {
  format: string
  count: number
}

export const WEB_FORMATS = ['woff', 'woff2'] as const

const FORMAT_LABELS: Record<string, string> = {
  otf: 'OpenType',
  ttf: 'TrueType',
  ttc: 'TrueType Collection',
  otc: 'OpenType Collection',
  woff: 'WOFF',
  woff2: 'WOFF2',
}

export function normalizeFormat(format: string): string {
  return format.trim().toLowerCase().replace(/^\./, '')
}

export function formatFromName(name: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(name)
  return match ? normalizeFormat(match[1]) : null
}

export function isWebFormat(format: string): boolean {
  const value = normalizeFormat(format)
  return value === 'woff' || value === 'woff2'
}

export function isInstallableFormat(format: string): format is InstallableFormat {
  return (INSTALLABLE_FORMATS as readonly string[]).includes(normalizeFormat(format))
}

export function formatLabel(format: string): string {
  const value = normalizeFormat(format)
  return FORMAT_LABELS[value] ?? value.toUpperCase()
}

export function formatExtension(format: string): string {
  return `.${normalizeFormat(format)}`
}

export function preferredFormat(formats: string[]): string | undefined {
  for (const format of INSTALLABLE_FORMATS) {
    if (formats.includes(format)) return format
  }
  return formats[0]
}

export function countFormats(formats: string[]): FormatCount[] {
  const counts = new Map<string, number>()
  for (const format of formats) {
    const value = normalizeFormat(format)
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...INSTALLABLE_FORMATS, ...WEB_FORMATS]
    .filter((format) => counts.has(format))
    .map((format) => ({
      format,
      count: counts.get(format) ?? 0,
    }))
}

export function fileCountLabel(count: number): string {
  return count === 1 ? '1 file' : `${count} files`
}

export function entryFormatOf(entry: Pick<CatalogEntry, 'format' | 'sourcePath'>): string {
  return normalizeFormat(entry.format) || formatFromName(entry.sourcePath) || ''
}

export function uniqueEntryFormats(
  entries: Array<Pick<CatalogEntry, 'format' | 'sourcePath'>>,
): string[] {
  return countFormats(entries.map(entryFormatOf)).map((item) => item.format)
}

function isActiveStatus(status: CatalogEntry['status']): boolean {
  return status === 'installed' || status === 'outdated'
}

export function occupyingEntries<T extends Pick<CatalogEntry, 'status'>>(entries: T[]): T[] {
  return entries.filter((entry) => isActiveStatus(entry.status))
}

/** Formats that are live on the Mac (installed or outdated), in desktop order. */
export function occupyingFormats(
  entries: Array<Pick<CatalogEntry, 'format' | 'sourcePath' | 'status'>>,
): string[] {
  return uniqueEntryFormats(occupyingEntries(entries))
}

export function hasMixedInstalledFormats(
  entries: Array<Pick<CatalogEntry, 'format' | 'sourcePath' | 'status'>>,
): boolean {
  return occupyingFormats(entries).length > 1
}

export function occupyingIdsForFormat(
  entries: Array<Pick<CatalogEntry, 'id' | 'format' | 'sourcePath' | 'status'>>,
  format: string,
): string[] {
  const wanted = normalizeFormat(format)
  return occupyingEntries(entries)
    .filter((entry) => entryFormatOf(entry) === wanted)
    .map((entry) => entry.id)
}

/** Destinations the occupying format actually uses, so a swap can follow them. */
export function occupyingDestinationIds(
  entries: Array<
    Pick<CatalogEntry, 'format' | 'sourcePath' | 'status' | 'installedPath' | 'installations'>
  >,
  format: string,
): DestinationId[] {
  const wanted = normalizeFormat(format)
  const dests = new Set<DestinationId>()
  for (const entry of occupyingEntries(entries)) {
    if (entryFormatOf(entry) !== wanted) continue
    if (entry.installedPath) dests.add('macos')
    for (const copy of entry.installations ?? []) {
      if (copy.verification === 'unavailable') continue
      dests.add(copy.destinationId)
    }
  }
  if (dests.size === 0) dests.add('macos')
  return (['macos', 'adobe-shared'] as const).filter((id) => dests.has(id))
}

export function mixedFormatWarning(formats: string[]): string {
  if (formats.length < 2) return ''
  if (formats.length === 2) {
    return `${formats[0]!.toUpperCase()} and ${formats[1]!.toUpperCase()} installed`
  }
  return 'Multiple formats installed'
}

function instanceKey(familyName: string, styleName: string): string {
  return `${familyName.trim().toLowerCase()}::${styleName.trim().toLowerCase()}`
}

export function styleKeysForEntry(entry: Pick<CatalogEntry, 'faces'>): string[] {
  const keys: string[] = []
  for (const face of entry.faces) {
    if (face.isVariable && face.instanceNames.length > 0) {
      for (const name of face.instanceNames) {
        keys.push(instanceKey(face.familyName, name))
      }
    } else if (face.isVariable) {
      const count = Math.max(face.instanceCount, 1)
      for (let index = 0; index < count; index += 1) {
        keys.push(instanceKey(face.familyName, `${face.styleName}#${index}`))
      }
    } else {
      keys.push(instanceKey(face.familyName, face.styleName))
    }
  }
  return keys
}

export function uniqueStyleCount(entries: Array<Pick<CatalogEntry, 'faces'>>): number {
  const keys = new Set<string>()
  for (const entry of entries) {
    for (const key of styleKeysForEntry(entry)) keys.add(key)
  }
  return keys.size
}

export function occupyingStyleKeys(
  entries: Array<Pick<CatalogEntry, 'faces' | 'status'>>,
): Set<string> {
  const keys = new Set<string>()
  for (const entry of occupyingEntries(entries)) {
    for (const key of styleKeysForEntry(entry)) keys.add(key)
  }
  return keys
}

export function occupyingStyleCount(
  entries: Array<Pick<CatalogEntry, 'faces' | 'status'>>,
): number {
  return occupyingStyleKeys(entries).size
}

export function entryAddsUnoccupiedStyle(
  entry: Pick<CatalogEntry, 'faces'>,
  occupyingKeys: Set<string>,
): boolean {
  return styleKeysForEntry(entry).some((key) => !occupyingKeys.has(key))
}

export type FormatSwap = {
  from: string
  to: string
  incomingIds: string[]
  occupying: boolean
}

export function formatSwapLabel(swap: Pick<FormatSwap, 'from' | 'to'> & { occupying?: boolean }): string {
  if (!swap.occupying) return `Install ${swap.to.toUpperCase()}`
  return `Swap ${swap.from.toUpperCase()} for ${swap.to.toUpperCase()}`
}

function deactivatedEntries<T extends Pick<CatalogEntry, 'status' | 'previewOnly'>>(
  entries: T[],
): T[] {
  return entries.filter((entry) => entry.status === 'deactivated' && !entry.previewOnly)
}

/** Styles already live, or parked when nothing is live. */
export function coveredStyleKeys(
  entries: Array<Pick<CatalogEntry, 'faces' | 'status' | 'previewOnly'>>,
): Set<string> {
  const occupying = occupyingStyleKeys(entries)
  if (occupying.size > 0) return occupying
  const keys = new Set<string>()
  for (const entry of deactivatedEntries(entries)) {
    for (const key of styleKeysForEntry(entry)) keys.add(key)
  }
  return keys
}

/**
 * One live or parked format plus a catalog copy of the same styles in another
 * format. Installing those files is a format change, not missing styles.
 */
export function formatSwap(
  entries: Array<
    Pick<CatalogEntry, 'id' | 'format' | 'sourcePath' | 'status' | 'faces' | 'previewOnly'>
  >,
): FormatSwap | null {
  const liveFormats = occupyingFormats(entries)
  if (liveFormats.length > 1) return null
  const occupying = liveFormats.length === 1
  const parkedFormats = uniqueEntryFormats(deactivatedEntries(entries))
  const fromFormats = occupying
    ? liveFormats
    : parkedFormats.length === 1
      ? parkedFormats
      : parkedFormats.length === 2
        ? [preferredFormat(parkedFormats)].filter((format): format is string => Boolean(format))
        : []
  if (fromFormats.length !== 1) return null
  const from = fromFormats[0]!
  const fromKeys = occupying
    ? occupyingStyleKeys(entries)
    : new Set(
        deactivatedEntries(entries)
          .filter((entry) => entryFormatOf(entry) === from)
          .flatMap(styleKeysForEntry),
      )
  if (fromKeys.size === 0) return null
  const incoming = entries.filter((entry) => {
    if (entry.previewOnly) return false
    if (entry.status !== 'uninstalled' && entry.status !== 'deactivated') return false
    const format = entryFormatOf(entry)
    return Boolean(format) && format !== from && isInstallableFormat(format)
  })
  const toFormats = uniqueEntryFormats(incoming)
  if (toFormats.length !== 1) return null
  const to = toFormats[0]!
  const incomingKeys = new Set(incoming.flatMap(styleKeysForEntry))
  for (const key of fromKeys) {
    if (!incomingKeys.has(key)) return null
  }
  return { from, to, incomingIds: incoming.map((entry) => entry.id), occupying }
}

function isIncomingStatus(status: CatalogEntry['status']): boolean {
  return status === 'uninstalled' || status === 'deactivated'
}

/**
 * Per-style swap when this file and an overlapping sibling use different formats,
 * and only one of them is occupying the Mac.
 */
export function instanceFormatSwap(
  entry: CatalogEntry,
  family: CatalogEntry[],
): FormatSwap | null {
  if (entry.previewOnly) return null
  const format = entryFormatOf(entry)
  if (!format || !isInstallableFormat(format)) return null
  const counterpart = family.find((other) => {
    if (other.id === entry.id || other.previewOnly) return false
    const otherFormat = entryFormatOf(other)
    if (!otherFormat || otherFormat === format || !isInstallableFormat(otherFormat)) return false
    return instancesOverlap(entry, other)
  })
  if (!counterpart) return null
  const entryKeys = new Set(styleKeysForEntry(entry))
  const counterpartKeys = new Set(styleKeysForEntry(counterpart))
  if (
    entryKeys.size !== counterpartKeys.size ||
    [...entryKeys].some((key) => !counterpartKeys.has(key))
  ) {
    // A font collection cannot be replaced one face at a time. Only expose
    // the instance swap when both files contain the same complete style set.
    return null
  }
  const otherFormat = entryFormatOf(counterpart)
  if (!otherFormat) return null
  const entryLive = occupyingEntries([entry]).length > 0
  const otherLive = occupyingEntries([counterpart]).length > 0
  if (entryLive && isIncomingStatus(counterpart.status)) {
    return { from: format, to: otherFormat, incomingIds: [counterpart.id], occupying: true }
  }
  if (otherLive && isIncomingStatus(entry.status)) {
    return { from: otherFormat, to: format, incomingIds: [entry.id], occupying: true }
  }
  return null
}

export function instanceSwapLabel(swap: FormatSwap, entryId: string): string {
  if (swap.incomingIds.includes(entryId)) {
    return `Swap with ${swap.from.toUpperCase()}`
  }
  return `Swap for ${swap.to.toUpperCase()}`
}

export function instancesOverlap(
  left: Pick<CatalogEntry, 'faces'>,
  right: Pick<CatalogEntry, 'faces'>,
): boolean {
  const styles = new Set<string>()
  const posts = new Set<string>()
  for (const face of left.faces) {
    styles.add(instanceKey(face.familyName, face.styleName))
    const postscript = face.postscriptName.trim().toLowerCase()
    if (postscript) posts.add(postscript)
  }
  return right.faces.some((face) => {
    if (styles.has(instanceKey(face.familyName, face.styleName))) return true
    const postscript = face.postscriptName.trim().toLowerCase()
    return Boolean(postscript && posts.has(postscript))
  })
}

export type FormatConflict = {
  incoming: CatalogEntry
  existing: CatalogEntry
}

export function listFormatConflicts(
  incoming: CatalogEntry[],
  catalog: CatalogEntry[],
): FormatConflict[] {
  const conflicts: FormatConflict[] = []
  const seen = new Set<string>()
  for (const entry of incoming) {
    const format = entryFormatOf(entry)
    const existing = catalog.find((other) => {
      if (other.id === entry.id || !isActiveStatus(other.status)) return false
      if (entryFormatOf(other) === format) return false
      return instancesOverlap(entry, other)
    })
    if (!existing) continue
    const key = `${entry.id}:${existing.id}`
    if (seen.has(key)) continue
    seen.add(key)
    conflicts.push({ incoming: entry, existing })
  }
  return conflicts
}

export function conflictInstanceNames(conflicts: FormatConflict[]): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const { incoming, existing } of conflicts) {
    const existingKeys = new Set(
      existing.faces.map((face) => instanceKey(face.familyName, face.styleName)),
    )
    const matches = incoming.faces.filter((face) =>
      existingKeys.has(instanceKey(face.familyName, face.styleName)),
    )
    const faces = matches.length > 0 ? matches : incoming.faces.slice(0, 1)
    for (const face of faces) {
      const name = `${face.familyName} ${face.styleName}`.trim()
      if (seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

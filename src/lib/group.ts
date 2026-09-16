import { uniqueStyleCount, occupyingStyleCount, entryFormatOf } from './formats.ts'
import { entryCopyDestinations } from './state.ts'
import { entryHasActiveRetailSync, retailListingHasLocalFile, type RetailSyncView } from '../../shared/retail.ts'
import type {
  CatalogEntry,
  FamilyGroup,
  FontStatus,
  LibraryFilter,
  SortMode,
  SystemFace,
  SystemFamilyGroup,
} from './types'

const statusRank: Record<FontStatus, number> = {
  outdated: 0,
  installed: 1,
  deactivated: 2,
  uninstalled: 3,
  'source-missing': 4,
}

export function familyNameOf(entry: CatalogEntry): string {
  const custom = entry.customFamilyName?.trim()
  if (custom) return custom
  const retail = entry.retailFamilyName?.trim()
  if (retail) return retail
  return entry.faces[0]?.familyName || 'Unknown'
}

export function retailFamilyNameOf(entry: CatalogEntry): string {
  return (entry.retailFamilyName || familyNameOf(entry)).trim()
}

export function hasRetailSyncedSource(
  group: { entries: CatalogEntry[] },
  retail?: RetailSyncView | null,
): boolean {
  return group.entries.some((entry) => entryHasActiveRetailSync(entry, retail))
}

/** Family names still in Displaay retail sync for these catalog entries. */
export function retailFamiliesToOptOut(
  entries: CatalogEntry[],
  retail?: RetailSyncView | null,
): string[] {
  if (!retail?.enabled) return []
  const names = new Set<string>()
  for (const entry of entries) {
    if (!entryHasActiveRetailSync(entry, retail)) continue
    const name = retailFamilyNameOf(entry)
    if (!name) continue
    names.add(name)
  }
  return [...names]
}

export function countFamilyNames(entries: CatalogEntry[]): number {
  const names = new Set<string>()
  for (const entry of entries) names.add(familyNameOf(entry))
  return names.size
}

export function catalogEntriesMatch(prev: CatalogEntry[], next: CatalogEntry[]): boolean {
  if (prev === next) return true
  if (prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i]!
    const b = next[i]!
    if (
      a.id !== b.id ||
      a.updatedAt !== b.updatedAt ||
      a.status !== b.status ||
      a.sourcePresent !== b.sourcePresent ||
      a.installedPath !== b.installedPath ||
      a.disabledPath !== b.disabledPath ||
      a.sourcePath !== b.sourcePath ||
      a.sourceFingerprint !== b.sourceFingerprint ||
      a.installedFingerprint !== b.installedFingerprint ||
      a.customFamilyName !== b.customFamilyName ||
      a.retailFamilyName !== b.retailFamilyName ||
      a.updateHold !== b.updateHold ||
      a.previousRevisionId !== b.previousRevisionId ||
      a.previewSample !== b.previewSample ||
      a.faces.length !== b.faces.length ||
      (a.installations?.length ?? 0) !== (b.installations?.length ?? 0)
    ) {
      return false
    }
    const aInstall = a.installations ?? []
    const bInstall = b.installations ?? []
    for (let j = 0; j < aInstall.length; j++) {
      const left = aInstall[j]!
      const right = bInstall[j]!
      if (
        left.destinationId !== right.destinationId ||
        left.path !== right.path ||
        left.parkedPath !== right.parkedPath ||
        left.fingerprint !== right.fingerprint ||
        left.verification !== right.verification
      ) {
        return false
      }
    }
  }
  return true
}

export function mergeCatalogEntries(current: CatalogEntry[], patch: CatalogEntry[]): CatalogEntry[] {
  if (patch.length === 0) return current
  const byId = new Map(current.map((entry) => [entry.id, entry]))
  for (const entry of patch) byId.set(entry.id, entry)
  const seen = new Set<string>()
  const merged: CatalogEntry[] = []
  for (const entry of current) {
    const next = byId.get(entry.id)
    if (!next) continue
    seen.add(entry.id)
    merged.push(next)
  }
  for (const entry of patch) {
    if (seen.has(entry.id)) continue
    merged.push(entry)
  }
  return catalogEntriesMatch(current, merged) ? current : merged
}

export function catalogPatchFromResult(result: unknown): CatalogEntry[] {
  if (!result || typeof result !== 'object') return []
  if (Array.isArray(result)) {
    return result.filter((item): item is CatalogEntry => Boolean(item && typeof item === 'object' && 'id' in item && 'status' in item))
  }
  const record = result as { entries?: CatalogEntry[]; id?: string; status?: FontStatus }
  if (Array.isArray(record.entries) && record.entries.length) {
    return record.entries.filter((item): item is CatalogEntry => Boolean(item && typeof item === 'object' && 'id' in item))
  }
  if (record.id && record.status) return [record as CatalogEntry]
  return []
}

export function groupCatalog(entries: CatalogEntry[]): FamilyGroup[] {
  const map = new Map<string, CatalogEntry[]>()
  for (const entry of entries) {
    const name = familyNameOf(entry)
    const list = map.get(name) ?? []
    list.push(entry)
    map.set(name, list)
  }
  return [...map.entries()]
    .map(([familyName, groupEntries]) => {
      const faces = groupEntries.flatMap((entry) => entry.faces)
      const isVariable = faces.some((face) => face.isVariable)
      const instanceCount = uniqueStyleCount(groupEntries)
      const status = groupEntries.reduce(
        (best, entry) =>
          statusRank[entry.status] < statusRank[best] ? entry.status : best,
        groupEntries[0].status,
      )
      const previewPool = groupEntries.filter(entryHasPreviewFile)
      const previewCandidates = previewPool.length > 0 ? previewPool : groupEntries
      const preview =
        previewCandidates.find((entry) =>
          entry.faces.some(
            (face) => !face.italic && /regular|roman|book/i.test(face.styleName),
          ),
        ) ??
        previewCandidates.find((entry) => entry.faces.some((face) => !face.italic)) ??
        previewCandidates[0]
      return {
        key: familyName,
        familyName,
        entries: groupEntries,
        faces,
        isVariable,
        instanceCount,
        status,
        previewEntryId: preview.id,
        addedAt: Math.max(...groupEntries.map((entry) => entry.addedAt)),
      }
    })
    .sort((a, b) => a.familyName.localeCompare(b.familyName))
}

export function sortFamilyGroups(groups: FamilyGroup[], mode: SortMode): FamilyGroup[] {
  const copy = [...groups]
  if (mode === 'added') {
    copy.sort((a, b) => b.addedAt - a.addedAt || a.familyName.localeCompare(b.familyName))
  } else {
    copy.sort((a, b) => a.familyName.localeCompare(b.familyName))
  }
  return copy
}

const STATUS_FILTERS = new Set<LibraryFilter>(['installed', 'deactivated', 'uninstalled'])
const KIND_FILTERS = new Set<LibraryFilter>(['vf', 'static'])
const SOURCE_FILTERS = new Set<LibraryFilter>(['source', 'no-source'])
const DESTINATION_FILTERS = new Set<LibraryFilter>(['computer', 'adobe', 'no-destination'])
const FORMAT_FILTERS = new Set<LibraryFilter>(['otf', 'ttf'])

const LIBRARY_FILTERS = new Set<LibraryFilter>([
  ...STATUS_FILTERS,
  ...KIND_FILTERS,
  ...SOURCE_FILTERS,
  ...DESTINATION_FILTERS,
  ...FORMAT_FILTERS,
])

export function isLibraryFilter(value: unknown): value is LibraryFilter {
  return typeof value === 'string' && LIBRARY_FILTERS.has(value as LibraryFilter)
}

function matchesStatusFilter(entry: CatalogEntry, filter: LibraryFilter): boolean {
  switch (filter) {
    case 'installed':
      return entry.status === 'installed' || entry.status === 'outdated'
    case 'deactivated':
      return entry.status === 'deactivated'
    case 'uninstalled':
      return entry.status === 'uninstalled' || entry.status === 'source-missing'
    default:
      return false
  }
}

function matchesKindFilter(entry: CatalogEntry, filter: LibraryFilter): boolean {
  const variable = entry.faces.some((face) => face.isVariable)
  const statik = entry.faces.some((face) => !face.isVariable)
  if (filter === 'vf') return variable
  if (filter === 'static') return statik
  return false
}

function matchesSourceFilter(entry: CatalogEntry, filter: LibraryFilter): boolean {
  const tracked = entryHasTrackedSource(entry)
  if (filter === 'source') return tracked
  if (filter === 'no-source') return !tracked
  return false
}

function matchesDestinationFilter(entry: CatalogEntry, filter: LibraryFilter): boolean {
  const dest = entryCopyDestinations(entry)
  if (filter === 'computer') return dest.macos
  if (filter === 'adobe') return dest.adobe
  if (filter === 'no-destination') return !dest.macos && !dest.adobe
  return false
}

function matchesFormatFilter(entry: CatalogEntry, filter: LibraryFilter): boolean {
  const format = entryFormatOf(entry)
  if (filter === 'otf') return format === 'otf'
  if (filter === 'ttf') return format === 'ttf'
  return false
}

export function countLibraryFilters(entries: CatalogEntry[]): Record<LibraryFilter, number> {
  const counts = {
    installed: 0,
    deactivated: 0,
    uninstalled: 0,
    vf: 0,
    static: 0,
    source: 0,
    'no-source': 0,
    computer: 0,
    adobe: 0,
    'no-destination': 0,
    otf: 0,
    ttf: 0,
  } satisfies Record<LibraryFilter, number>
  for (const group of groupCatalog(entries)) {
    for (const filter of LIBRARY_FILTERS) {
      if (group.entries.some((entry) => matchesLibraryFilter(entry, [filter]))) {
        counts[filter]++
      }
    }
  }
  return counts
}

export function matchesLibraryFilter(
  entry: CatalogEntry,
  filters: readonly LibraryFilter[],
): boolean {
  if (filters.length === 0) {
    return true
  }
  const statuses = filters.filter((filter) => STATUS_FILTERS.has(filter))
  const kinds = filters.filter((filter) => KIND_FILTERS.has(filter))
  const sources = filters.filter((filter) => SOURCE_FILTERS.has(filter))
  const destinations = filters.filter((filter) => DESTINATION_FILTERS.has(filter))
  const formats = filters.filter((filter) => FORMAT_FILTERS.has(filter))
  if (statuses.length > 0 && !statuses.some((filter) => matchesStatusFilter(entry, filter))) {
    return false
  }
  if (kinds.length > 0 && !kinds.some((filter) => matchesKindFilter(entry, filter))) {
    return false
  }
  if (sources.length > 0 && !sources.some((filter) => matchesSourceFilter(entry, filter))) {
    return false
  }
  if (
    destinations.length > 0 &&
    !destinations.some((filter) => matchesDestinationFilter(entry, filter))
  ) {
    return false
  }
  if (formats.length > 0 && !formats.some((filter) => matchesFormatFilter(entry, filter))) {
    return false
  }
  return true
}

export function groupSystem(faces: SystemFace[]): SystemFamilyGroup[] {
  const map = new Map<string, SystemFace[]>()
  for (const face of faces) {
    const list = map.get(face.familyName) ?? []
    list.push(face)
    map.set(face.familyName, list)
  }
  return [...map.entries()]
    .map(([familyName, groupFaces]) => {
      const isVariable = groupFaces.some((face) => face.isVariable)
      const instanceCount = groupFaces.reduce(
        (sum, face) => sum + (face.isVariable ? face.instanceCount : 1),
        0,
      )
      return {
        key: familyName,
        familyName,
        faces: groupFaces,
        isVariable,
        instanceCount,
        protected: groupFaces.every((face) => face.protected),
        writable: groupFaces.some((face) => face.writable),
      }
    })
    .sort((a, b) => a.familyName.localeCompare(b.familyName))
}

export function matchesQuery(haystack: string, query: string): boolean {
  if (!query.trim()) return true
  return haystack.toLowerCase().includes(query.trim().toLowerCase())
}

/** Delete/Backspace uninstalls these families from ~/Library/Fonts. */
export function isUninstallableGroup(group: { status: FontStatus }): boolean {
  return group.status === 'installed' || group.status === 'outdated' || group.status === 'deactivated'
}

/** Delete/Backspace forgets these families (already off the Mac). */
export function isForgettableOnlyGroup(group: { status: FontStatus; entries?: CatalogEntry[] }): boolean {
  if (group.status !== 'uninstalled' && group.status !== 'source-missing') return false
  if (group.entries) return forgettableIds({ entries: group.entries }).length > 0
  return true
}

export function familyStatusSummary(group: { entries: CatalogEntry[] }): string | null {
  const total = uniqueStyleCount(group.entries)
  const active = occupyingStyleCount(group.entries)
  if (active === 0 || active === total) {
    return null
  }
  const noun = total === 1 ? 'style' : 'styles'
  return `${active} of ${total} ${noun} active`
}

/** Status badge representative: family status, not the Aa preview face. */
export function familyBadgeEntry(group: FamilyGroup): CatalogEntry {
  const preview =
    group.entries.find((entry) => entry.id === group.previewEntryId) ?? group.entries[0]
  if (preview.status === group.status) return preview
  return group.entries.find((entry) => entry.status === group.status) ?? preview
}

export function entryIds(group: { entries: CatalogEntry[] }): string[] {
  return group.entries.map((entry) => entry.id)
}

export function forgettableIds(group: { entries: CatalogEntry[] }): string[] {
  return group.entries
    .filter(
      (entry) =>
        !entry.retailRelativePath &&
        (entry.status === 'uninstalled' || entry.status === 'source-missing'),
    )
    .map((entry) => entry.id)
}

export function deletableSourceIds(group: { entries: CatalogEntry[] }): string[] {
  return group.entries
    .filter((entry) => !entry.retailRelativePath && entry.status === 'uninstalled')
    .map((entry) => entry.id)
}

export function hasSourceMissing(group: { entries: CatalogEntry[] }): boolean {
  return group.entries.some((entry) => entry.status === 'source-missing')
}

export function hasManagedInstall(entry: CatalogEntry): boolean {
  return Boolean(
    entry.installedPath ||
      entry.disabledPath ||
      (entry.installations ?? []).some((copy) => copy.path || copy.parkedPath),
  )
}

/** Bytes the preview FontFace can actually load: verified install/parked, or a present source. */
export function entryHasPreviewFile(entry: CatalogEntry): boolean {
  return retailListingHasLocalFile(entry)
}

function isSelfSourced(entry: CatalogEntry): boolean {
  if (!entry.sourcePath) return true
  if (entry.installedPath && entry.sourcePath === entry.installedPath) return true
  if (entry.disabledPath && entry.sourcePath === entry.disabledPath) return true
  return false
}

export function entryHasTrackedSource(entry: CatalogEntry): boolean {
  if (entry.retailRelativePath) {
    return false
  }
  if (entry.customFamilyName) {
    return false
  }
  if (isSelfSourced(entry)) {
    return false
  }
  if (entry.sourceAvailability === 'offline' || entry.sourceAvailability === 'unreadable') {
    return true
  }
  if (typeof entry.sourcePresent === 'boolean') {
    return entry.sourcePresent
  }
  return entry.status !== 'source-missing'
}

export function hasTrackedSource(group: { entries: CatalogEntry[] }): boolean {
  return group.entries.some(entryHasTrackedSource)
}

export function uniquePaths(faces: SystemFace[]): string[] {
  return [...new Set(faces.map((face) => face.path))]
}

export function catalogRevealEntry(
  group: FamilyGroup,
  selected: CatalogEntry | undefined,
  which: 'source' | 'installed',
): CatalogEntry | undefined {
  const preferred =
    selected && group.entries.some((item) => item.id === selected.id)
      ? selected
      : group.entries[0]
  if (which === 'installed') {
    const hasInstall = hasManagedInstall
    if (preferred && hasInstall(preferred)) return preferred
    return group.entries.find(hasInstall) ?? preferred
  }
  if (preferred && entryHasTrackedSource(preferred)) return preferred
  return group.entries.find(entryHasTrackedSource) ?? preferred
}

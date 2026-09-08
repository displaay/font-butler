import { uniqueStyleCount, occupyingStyleCount } from './formats.ts'
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
  return entry.customFamilyName || entry.faces[0]?.familyName || 'Unknown'
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
      const preview =
        groupEntries.find((entry) =>
          entry.faces.some(
            (face) => !face.italic && /regular|roman|book/i.test(face.styleName),
          ),
        ) ??
        groupEntries.find((entry) => entry.faces.some((face) => !face.italic)) ??
        groupEntries[0]
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

const LIBRARY_FILTERS = new Set<LibraryFilter>([
  ...STATUS_FILTERS,
  ...KIND_FILTERS,
  ...SOURCE_FILTERS,
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

export function countLibraryFilters(entries: CatalogEntry[]): Record<LibraryFilter, number> {
  const counts = {
    installed: 0,
    deactivated: 0,
    uninstalled: 0,
    vf: 0,
    static: 0,
    source: 0,
    'no-source': 0,
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
  if (statuses.length > 0 && !statuses.some((filter) => matchesStatusFilter(entry, filter))) {
    return false
  }
  if (kinds.length > 0 && !kinds.some((filter) => matchesKindFilter(entry, filter))) {
    return false
  }
  if (sources.length > 0 && !sources.some((filter) => matchesSourceFilter(entry, filter))) {
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
export function isForgettableOnlyGroup(group: { status: FontStatus }): boolean {
  return group.status === 'uninstalled' || group.status === 'source-missing'
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
    .filter((entry) => entry.status === 'uninstalled' || entry.status === 'source-missing')
    .map((entry) => entry.id)
}

export function deletableSourceIds(group: { entries: CatalogEntry[] }): string[] {
  return group.entries
    .filter((entry) => entry.status === 'uninstalled')
    .map((entry) => entry.id)
}

export function hasSourceMissing(group: { entries: CatalogEntry[] }): boolean {
  return group.entries.some((entry) => entry.status === 'source-missing')
}

function isSelfSourced(entry: CatalogEntry): boolean {
  if (!entry.sourcePath) return true
  if (entry.installedPath && entry.sourcePath === entry.installedPath) return true
  if (entry.disabledPath && entry.sourcePath === entry.disabledPath) return true
  return false
}

export function entryHasTrackedSource(entry: CatalogEntry): boolean {
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
    const hasInstall = (entry: CatalogEntry) => Boolean(entry.installedPath || entry.disabledPath)
    if (preferred && hasInstall(preferred)) return preferred
    return group.entries.find(hasInstall) ?? preferred
  }
  if (preferred && entryHasTrackedSource(preferred)) return preferred
  return group.entries.find(entryHasTrackedSource) ?? preferred
}

import type {
  CatalogEntry,
  FamilyGroup,
  FontStatus,
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
      const instanceCount = faces.reduce(
        (sum, face) => sum + (face.isVariable ? face.instanceCount : 1),
        0,
      )
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
  if (mode === 'installed') {
    copy.sort((a, b) => b.addedAt - a.addedAt || a.familyName.localeCompare(b.familyName))
  } else {
    copy.sort((a, b) => a.familyName.localeCompare(b.familyName))
  }
  return copy
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

/** Every catalog status belongs on the Fonts tab, including uninstalled. */
export function isLibraryEntry(entry: CatalogEntry): boolean {
  switch (entry.status) {
    case 'installed':
    case 'outdated':
    case 'deactivated':
    case 'uninstalled':
    case 'source-missing':
      return true
  }
}

/** Delete/Backspace uninstalls these families; they stay on Fonts as not installed. */
export function isUninstallableGroup(group: { status: FontStatus }): boolean {
  return group.status === 'installed' || group.status === 'outdated' || group.status === 'deactivated'
}

/** Delete/Backspace forgets these families (already off the Mac). */
export function isForgettableOnlyGroup(group: { status: FontStatus }): boolean {
  return group.status === 'uninstalled' || group.status === 'source-missing'
}

export function familyStatusSummary(group: { entries: CatalogEntry[] }): string | null {
  const statuses = new Set(group.entries.map((entry) => entry.status))
  if (statuses.size <= 1) {
    return null
  }
  const installed = group.entries.filter((entry) => entry.status === 'installed').length
  return `${installed}/${group.entries.length} installed`
}

export function entryIds(group: { entries: CatalogEntry[] }): string[] {
  return group.entries.map((entry) => entry.id)
}

export function sourceMissingIds(group: { entries: CatalogEntry[] }): string[] {
  return group.entries
    .filter((entry) => entry.status === 'source-missing')
    .map((entry) => entry.id)
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

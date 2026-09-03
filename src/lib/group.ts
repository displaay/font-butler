import type {
  CatalogEntry,
  FamilyGroup,
  FontStatus,
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
          entry.faces.some((face) => /regular|roman|book/i.test(face.styleName)),
        ) ?? groupEntries[0]
      return {
        key: familyName,
        familyName,
        entries: groupEntries,
        faces,
        isVariable,
        instanceCount,
        status,
        previewEntryId: preview.id,
      }
    })
    .sort((a, b) => a.familyName.localeCompare(b.familyName))
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

/** Installed on the Mac, or installed copy remains while the source file is gone. */
export function isLibraryEntry(entry: CatalogEntry): boolean {
  return (
    entry.status === 'installed' ||
    entry.status === 'outdated' ||
    (entry.status === 'source-missing' && Boolean(entry.installedPath))
  )
}

/** Tracked in the catalog but not active: not installed, deactivated, or source gone. */
export function isInactiveEntry(entry: CatalogEntry): boolean {
  return (
    entry.status === 'uninstalled' ||
    entry.status === 'deactivated' ||
    (entry.status === 'source-missing' && !entry.installedPath)
  )
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

import { groupCatalog, matchesQuery, sortFamilyGroups } from './group'
import type { CatalogEntry, FamilyGroup, SortMode } from './types'

export function allUpdateGroups(entries: CatalogEntry[], sortMode: SortMode): FamilyGroup[] {
  return sortFamilyGroups(
    groupCatalog(entries.filter((entry) => entry.status === 'outdated')),
    sortMode,
  )
}

export function visibleUpdateGroups(groups: FamilyGroup[], query: string): FamilyGroup[] {
  return groups.filter((group) => matchesQuery(group.familyName, query))
}

export function updateGroupsForIds(groups: FamilyGroup[], ids: string[]): FamilyGroup[] {
  const idSet = new Set(ids)
  return groups.filter((group) => group.entries.some((entry) => idSet.has(entry.id)))
}

export function entriesForIds(entries: CatalogEntry[], ids: string[]): CatalogEntry[] {
  const idSet = new Set(ids)
  return entries.filter((entry) => idSet.has(entry.id))
}

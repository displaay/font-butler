import type { LibraryFilter, SavedLibraryFilter } from './types'
import { isRetailLibraryFilter, RETAIL_LIBRARY_LABEL } from './watchFolders'

export type SavedFilterCriteria = {
  query: string
  libraryFilters: readonly LibraryFilter[]
  watchFolder: string | null
}

export function defaultSavedFilterName(criteria: SavedFilterCriteria): string {
  const folder = isRetailLibraryFilter(criteria.watchFolder)
    ? RETAIL_LIBRARY_LABEL
    : criteria.watchFolder?.split(/[/\\]/).filter(Boolean).at(-1)
  const chips = criteria.libraryFilters.join(', ')
  const parts = [criteria.query.trim(), folder, chips].filter((part) => Boolean(part))
  return parts.join(' · ') || 'Untitled filter'
}

export function createSavedFilter(
  existing: SavedLibraryFilter[],
  input: { name?: string } & SavedFilterCriteria,
): SavedLibraryFilter[] {
  return [
    ...existing,
    {
      id: crypto.randomUUID(),
      name: input.name?.trim() || defaultSavedFilterName(input),
      query: input.query,
      libraryFilters: [...input.libraryFilters],
      watchFolder: input.watchFolder,
      createdAt: Date.now(),
    },
  ]
}

export function renameSavedFilter(
  existing: SavedLibraryFilter[],
  id: string,
  name: string,
): SavedLibraryFilter[] {
  return existing.map((item) =>
    item.id === id ? { ...item, name: name.trim() || 'Untitled filter' } : item,
  )
}

export function deleteSavedFilter(existing: SavedLibraryFilter[], id: string): SavedLibraryFilter[] {
  return existing.filter((item) => item.id !== id)
}

export function savedFilterMatches(
  filter: SavedLibraryFilter,
  current: SavedFilterCriteria,
): boolean {
  if (filter.query !== current.query) return false
  if ((filter.watchFolder ?? null) !== (current.watchFolder ?? null)) return false
  if (filter.libraryFilters.length !== current.libraryFilters.length) return false
  const have = new Set(current.libraryFilters)
  return filter.libraryFilters.every((id) => have.has(id))
}

export function emptyLibraryCriteria(): SavedFilterCriteria {
  return { query: '', libraryFilters: [], watchFolder: null }
}

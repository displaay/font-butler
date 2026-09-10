import type { LibraryFilter, SavedLibraryFilter } from './types.ts'

const LIBRARY_FILTER_IDS = new Set<LibraryFilter>([
  'installed',
  'deactivated',
  'uninstalled',
  'vf',
  'static',
  'source',
  'no-source',
])

export type SavedFilterCriteria = {
  query: string
  libraryFilters: readonly LibraryFilter[]
  watchFolder: string | null
}

function isLibraryFilter(value: unknown): value is LibraryFilter {
  return typeof value === 'string' && LIBRARY_FILTER_IDS.has(value as LibraryFilter)
}

export function normalizeSavedFilters(value: unknown): SavedLibraryFilter[] {
  if (!Array.isArray(value)) return []
  const out: SavedLibraryFilter[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !row.id.trim()) continue
    if (typeof row.name !== 'string' || !row.name.trim()) continue
    const libraryFilters = Array.isArray(row.libraryFilters)
      ? row.libraryFilters.filter(isLibraryFilter)
      : []
    const watchFolder =
      typeof row.watchFolder === 'string' && row.watchFolder.trim() ? row.watchFolder.trim() : null
    out.push({
      id: row.id,
      name: row.name.trim(),
      query: typeof row.query === 'string' ? row.query : '',
      libraryFilters,
      watchFolder,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
    })
  }
  return out
}

const RETAIL_LIBRARY_FILTER = '__retail__'
const RETAIL_LIBRARY_LABEL = 'Displaay retail'

export function defaultSavedFilterName(criteria: SavedFilterCriteria): string {
  const folder =
    criteria.watchFolder === RETAIL_LIBRARY_FILTER
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

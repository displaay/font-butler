export const LIBRARY_FILTER_GROUP_IDS = [
  'status',
  'type',
  'source',
  'destination',
  'format',
  'classification',
  'foundry',
] as const

export type LibraryFilterGroupId = (typeof LIBRARY_FILTER_GROUP_IDS)[number]

export type LibraryFilterGroupPref = {
  id: LibraryFilterGroupId
  visible: boolean
}

export const LIBRARY_FILTER_GROUP_LABELS: Record<LibraryFilterGroupId, string> = {
  status: 'Status',
  type: 'Type',
  source: 'Source',
  destination: 'Destination',
  format: 'Format',
  classification: 'Classification',
  foundry: 'Foundries',
}

const DEFAULT_VISIBLE = new Set<LibraryFilterGroupId>([
  'status',
  'type',
  'source',
  'destination',
  'format',
])

const GROUP_SET = new Set<string>(LIBRARY_FILTER_GROUP_IDS)

export const LIBRARY_FILTER_GROUPS_KEY = 'font-butler-filter-groups'

export function isLibraryFilterGroupId(value: string): value is LibraryFilterGroupId {
  return GROUP_SET.has(value)
}

export function defaultLibraryFilterGroups(): LibraryFilterGroupPref[] {
  return LIBRARY_FILTER_GROUP_IDS.map((id) => ({
    id,
    visible: DEFAULT_VISIBLE.has(id),
  }))
}

export function normalizeLibraryFilterGroups(value: unknown): LibraryFilterGroupPref[] {
  const defaults = defaultLibraryFilterGroups()
  const seen = new Set<LibraryFilterGroupId>()
  const ordered: LibraryFilterGroupPref[] = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue
      const row = item as { id?: unknown; visible?: unknown }
      if (typeof row.id !== 'string' || !isLibraryFilterGroupId(row.id) || seen.has(row.id)) continue
      seen.add(row.id)
      ordered.push({ id: row.id, visible: row.visible === true })
    }
  }
  for (const item of defaults) {
    if (!seen.has(item.id)) ordered.push(item)
  }
  return ordered
}

export function readLibraryFilterGroups(storage: { getItem(key: string): string | null }): LibraryFilterGroupPref[] {
  const raw = storage.getItem(LIBRARY_FILTER_GROUPS_KEY)
  if (!raw) return defaultLibraryFilterGroups()
  try {
    return normalizeLibraryFilterGroups(JSON.parse(raw))
  } catch {
    return defaultLibraryFilterGroups()
  }
}

export function moveLibraryFilterGroup(
  groups: readonly LibraryFilterGroupPref[],
  fromId: string,
  toId: string,
): LibraryFilterGroupPref[] {
  if (!isLibraryFilterGroupId(fromId) || !isLibraryFilterGroupId(toId) || fromId === toId) {
    return [...groups]
  }
  const next = [...groups]
  const from = next.findIndex((item) => item.id === fromId)
  const to = next.findIndex((item) => item.id === toId)
  if (from < 0 || to < 0) return next
  const [row] = next.splice(from, 1)
  next.splice(to, 0, row!)
  return next
}

/**
 * Move one visible group before or after another visible group.
 * Hidden groups stay in their original slots, so a sidebar reorder cannot
 * drop them or slide them into a different place in the full order.
 * Returns the same array when the drop is a no-op or the target is invalid.
 */
export function moveVisibleLibraryFilterGroup(
  groups: readonly LibraryFilterGroupPref[],
  fromId: string,
  toId: string,
  placement: 'before' | 'after',
): LibraryFilterGroupPref[] {
  if (placement !== 'before' && placement !== 'after') return groups as LibraryFilterGroupPref[]
  if (!isLibraryFilterGroupId(fromId) || !isLibraryFilterGroupId(toId) || fromId === toId) {
    return groups as LibraryFilterGroupPref[]
  }
  const visible = groups.filter((group) => group.visible)
  const fromIndex = visible.findIndex((group) => group.id === fromId)
  const toIndex = visible.findIndex((group) => group.id === toId)
  if (fromIndex < 0 || toIndex < 0) return groups as LibraryFilterGroupPref[]

  const nextVisible = visible.slice()
  const [row] = nextVisible.splice(fromIndex, 1)
  if (!row) return groups as LibraryFilterGroupPref[]
  let insertAt = nextVisible.findIndex((group) => group.id === toId)
  if (insertAt < 0) return groups as LibraryFilterGroupPref[]
  if (placement === 'after') insertAt += 1
  nextVisible.splice(insertAt, 0, row)
  if (nextVisible.every((group, index) => group.id === visible[index]?.id)) {
    return groups as LibraryFilterGroupPref[]
  }

  let cursor = 0
  return groups.map((group) => (group.visible ? nextVisible[cursor++]! : group))
}

export function filterBelongsToGroup(filter: string, group: LibraryFilterGroupId): boolean {
  switch (group) {
    case 'status':
      return filter === 'installed' || filter === 'deactivated' || filter === 'uninstalled'
    case 'type':
      return filter === 'vf' || filter === 'static'
    case 'source':
      return filter === 'source' || filter === 'no-source'
    case 'destination':
      return filter === 'computer' || filter === 'adobe' || filter === 'no-destination'
    case 'format':
      return filter === 'otf' || filter === 'ttf'
    case 'classification':
      return filter.startsWith('classification:')
    case 'foundry':
      return filter.startsWith('foundry:')
    default:
      return false
  }
}

export function withoutGroupFilters<T extends string>(filters: readonly T[], group: LibraryFilterGroupId): T[] {
  return filters.filter((filter) => !filterBelongsToGroup(filter, group))
}

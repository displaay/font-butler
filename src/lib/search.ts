import { matchesQuery } from './group.ts'
import type { Operation } from './types.ts'

export type SearchTab = 'library' | 'system' | 'updates' | 'activity'

export function tabWithSearchHits(input: {
  current: SearchTab
  query: string
  libraryHits: number
  systemHits: number
  updateHits: number
  activityHits: number
}): SearchTab {
  if (!input.query.trim()) return input.current
  const hits: Record<SearchTab, number> = {
    library: input.libraryHits,
    system: input.systemHits,
    updates: input.updateHits,
    activity: input.activityHits,
  }
  if (hits[input.current] > 0) return input.current
  const order: SearchTab[] = ['library', 'system', 'updates', 'activity']
  return order.find((tab) => hits[tab] > 0) ?? input.current
}

export function operationMatchesQuery(operation: Operation, query: string): boolean {
  if (!query.trim()) return true
  const haystack = [
    operation.familyName,
    operation.action,
    operation.trigger,
    operation.outcome,
    ...operation.items.map((item) => item.label),
  ]
    .filter(Boolean)
    .join(' ')
  return matchesQuery(haystack, query)
}

import { isLibraryFilter } from './group'
import type { AppSettings, LibraryFilter, SortMode } from './types'

export const LIBRARY_FILTERS_KEY = 'font-butler-library-filters'

export function shouldShowOnboarding(settings: AppSettings) {
  return (
    new URLSearchParams(window.location.search).get('onboarding') === '1' ||
    settings.onboardingCompleted === false
  )
}

export function readSortMode(): SortMode {
  const stored = localStorage.getItem('font-butler-sort')
  return stored === 'added' || stored === 'installed' ? 'added' : 'name'
}

export function readLibraryFilters(): LibraryFilter[] {
  const raw = localStorage.getItem(LIBRARY_FILTERS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isLibraryFilter)
  } catch {
    return []
  }
}

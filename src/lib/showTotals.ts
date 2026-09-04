import { normalizeWatchPath } from './watchFolders.ts'

export const SHOW_TOTALS_KEY = 'font-butler-show-totals'

export type ShowTotalId = 'library' | 'system' | 'updates' | `watch:${string}`

export function watchShowTotalId(folder: string): ShowTotalId {
  return `watch:${normalizeWatchPath(folder)}`
}

export function readShowTotals(
  storage: Pick<Storage, 'getItem'> = localStorage,
): Record<string, boolean> {
  try {
    const raw = storage.getItem(SHOW_TOTALS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'boolean'),
    )
  } catch {
    return {}
  }
}

export function writeShowTotals(
  next: Record<string, boolean>,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(SHOW_TOTALS_KEY, JSON.stringify(next))
}

export function setShowTotal(
  current: Record<string, boolean>,
  id: string,
  value: boolean,
): Record<string, boolean> {
  if (!value) {
    const { [id]: _removed, ...rest } = current
    return rest
  }
  return { ...current, [id]: true }
}

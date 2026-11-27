/** Pixel width of the side-by-side sidebar. 224 matches the old `md:w-56` (14rem). */
export const SIDEBAR_WIDTH_KEY = 'font-butler-sidebar-width'
export const SIDEBAR_DEFAULT_WIDTH = 224
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 420
/** Main panel keeps at least this much horizontal space beside the sidebar. */
export const SIDEBAR_MAIN_MIN_WIDTH = 480
export const SIDEBAR_RESIZE_STEP = 16

export function sidebarWidthBounds(viewportWidth: number): { min: number; max: number } {
  const viewport = Number.isFinite(viewportWidth) ? viewportWidth : SIDEBAR_MAX_WIDTH + SIDEBAR_MAIN_MIN_WIDTH
  const cap = Math.floor(viewport - SIDEBAR_MAIN_MIN_WIDTH)
  if (cap <= SIDEBAR_MIN_WIDTH) {
    const tight = Math.max(0, cap)
    return { min: tight, max: tight }
  }
  return { min: SIDEBAR_MIN_WIDTH, max: Math.min(SIDEBAR_MAX_WIDTH, cap) }
}

export function clampSidebarWidth(value: number, viewportWidth: number): number {
  const { min, max } = sidebarWidthBounds(viewportWidth)
  if (!Number.isFinite(value)) return clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, viewportWidth)
  return Math.round(Math.min(max, Math.max(min, value)))
}

export function readSidebarWidth(viewportWidth: number): number {
  if (typeof localStorage === 'undefined') return clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, viewportWidth)
  const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
  if (raw == null || raw.trim() === '') return clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, viewportWidth)
  return clampSidebarWidth(Number(raw), viewportWidth)
}

export function writeSidebarWidth(width: number): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(width)))
}

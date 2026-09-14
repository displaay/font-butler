import type { CatalogEntry, SystemFace, ViewLayout } from './types'

export const LIBRARY_GRID_GAP_REM = 0.75
export const LIBRARY_LIST_GAP_REM = 0.5
export const LIBRARY_OVERSCAN_ROWS = 3

export function gridCardMinWidthRem(previewSize: number): number {
  return 5.25 + previewSize * 1.85
}
export const LIBRARY_WINDOW_FALLBACK_WIDTH = 960
export const LIBRARY_WINDOW_FALLBACK_HEIGHT = 800

export type LibraryWindowMetrics = {
  columns: number
  columnWidth: number
  rowHeight: number
  gap: number
  start: number
  end: number
  startRow: number
  endRow: number
  totalRows: number
  padTop: number
  padBottom: number
  totalHeight: number
}

export type LibraryWindowLayout = {
  count: number
  columns: number
  columnWidth: number
  rowHeight: number
  gap: number
  originLeft: number
  originTop: number
}

export function libraryGapPx(layout: ViewLayout, rootFontSize: number): number {
  const rem = layout === 'grid' ? LIBRARY_GRID_GAP_REM : LIBRARY_LIST_GAP_REM
  return rem * rootFontSize
}

export function libraryGridColumns(width: number, minCardWidth: number, gap: number): number {
  const inner = Math.max(width, 0)
  if (inner <= 0 || minCardWidth <= 0) return 1
  return Math.max(1, Math.floor((inner + gap) / (minCardWidth + gap)))
}

export function libraryGridRowHeightPx(
  previewSize: number,
  rootFontSize: number,
  extraLines = 0,
): number {
  const preview = previewSize * 2 * rootFontSize
  const pad = (previewSize < 3.25 ? 0.5 : 0.75) * rootFontSize
  const identity = (1.25 + 0.125 + 1 + extraLines * 1.1) * rootFontSize + pad * 2
  return Math.ceil(preview + identity + 2)
}

export function libraryListRowHeightPx(rootFontSize: number, extraLines = 0): number {
  const padY = 0.625 * 2 * rootFontSize
  const preview = 2.75 * rootFontSize
  const text = (1.25 + 0.125 + 1 + extraLines * 1.1) * rootFontSize
  return Math.ceil(Math.max(preview, text) + padY + 2)
}

export function libraryRowHeightPx(
  layout: ViewLayout,
  previewSize: number,
  rootFontSize: number,
  extraLines = 0,
): number {
  return layout === 'grid'
    ? libraryGridRowHeightPx(previewSize, rootFontSize, extraLines)
    : libraryListRowHeightPx(rootFontSize, extraLines)
}

export function libraryRowStride(rowHeight: number, gap: number): number {
  return rowHeight + gap
}

export function libraryTotalHeight(count: number, columns: number, rowHeight: number, gap: number): number {
  const cols = Math.max(1, columns)
  const totalRows = Math.ceil(Math.max(0, count) / cols)
  if (totalRows === 0) return 0
  return totalRows * rowHeight + Math.max(0, totalRows - 1) * gap
}

export function alignLibraryWindowToRows(
  start: number,
  end: number,
  count: number,
  columns: number,
): { start: number; end: number; startRow: number; endRow: number; totalRows: number } {
  const cols = Math.max(1, columns)
  const totalRows = Math.ceil(Math.max(0, count) / cols)
  const startRow = Math.max(0, Math.floor(Math.max(0, start) / cols))
  const endRow = Math.min(totalRows, Math.ceil(Math.max(start, end) / cols))
  return {
    start: Math.min(count, startRow * cols),
    end: Math.min(count, endRow * cols),
    startRow,
    endRow,
    totalRows,
  }
}

export function libraryWindowRange(options: {
  count: number
  columns: number
  rowHeight: number
  gap: number
  scrollTop: number
  viewportHeight: number
  overscanRows?: number
}): { start: number; end: number } {
  const count = Math.max(0, options.count)
  if (count === 0) return { start: 0, end: 0 }
  const cols = Math.max(1, options.columns)
  const stride = libraryRowStride(options.rowHeight, options.gap)
  const overscan = Math.max(0, options.overscanRows ?? LIBRARY_OVERSCAN_ROWS)
  const pad = overscan * stride
  const from = options.scrollTop - pad
  const to = options.scrollTop + Math.max(0, options.viewportHeight) + pad
  const firstRow = Math.max(0, Math.floor(from / stride))
  const lastRow = Math.max(firstRow, Math.ceil(to / stride))
  return {
    start: Math.min(count, firstRow * cols),
    end: Math.min(count, lastRow * cols),
  }
}

export function libraryWindowMetrics(options: {
  count: number
  layout: ViewLayout
  width: number
  minCardWidth: number
  previewSize: number
  rootFontSize: number
  extraLines?: number
  scrollTop: number
  viewportHeight: number
  overscanRows?: number
}): LibraryWindowMetrics {
  const gap = libraryGapPx(options.layout, options.rootFontSize)
  const columns =
    options.layout === 'list' ? 1 : libraryGridColumns(options.width, options.minCardWidth, gap)
  const rowHeight = libraryRowHeightPx(
    options.layout,
    options.previewSize,
    options.rootFontSize,
    options.extraLines ?? 0,
  )
  const columnWidth =
    columns <= 1 ? Math.max(0, options.width) : (Math.max(0, options.width) - gap * (columns - 1)) / columns
  const range = libraryWindowRange({
    count: options.count,
    columns,
    rowHeight,
    gap,
    scrollTop: options.scrollTop,
    viewportHeight: options.viewportHeight,
    overscanRows: options.overscanRows,
  })
  const aligned = alignLibraryWindowToRows(range.start, range.end, options.count, columns)
  const stride = libraryRowStride(rowHeight, gap)
  return {
    columns,
    columnWidth,
    rowHeight,
    gap,
    start: aligned.start,
    end: aligned.end,
    startRow: aligned.startRow,
    endRow: aligned.endRow,
    totalRows: aligned.totalRows,
    padTop: aligned.startRow * stride,
    padBottom: Math.max(0, aligned.totalRows - aligned.endRow) * stride,
    totalHeight: libraryTotalHeight(options.count, columns, rowHeight, gap),
  }
}

export function libraryItemRect(
  index: number,
  layout: Pick<LibraryWindowLayout, 'columns' | 'columnWidth' | 'rowHeight' | 'gap' | 'originLeft' | 'originTop'>,
): { left: number; top: number; right: number; bottom: number } {
  const cols = Math.max(1, layout.columns)
  const row = Math.floor(Math.max(0, index) / cols)
  const col = Math.max(0, index) % cols
  const stride = libraryRowStride(layout.rowHeight, layout.gap)
  const left = layout.originLeft + col * (layout.columnWidth + layout.gap)
  const top = layout.originTop + row * stride
  return {
    left,
    top,
    right: left + layout.columnWidth,
    bottom: top + layout.rowHeight,
  }
}

export function libraryCardRects<T extends { familyName: string }>(
  items: T[],
  layout: LibraryWindowLayout,
  mounted: Array<{ key: string; left: number; top: number; right: number; bottom: number }> = [],
): Array<{ key: string; rect: { left: number; top: number; right: number; bottom: number } }> {
  const live = new Map(mounted.map((item) => [item.key, item]))
  return items.map((item, index) => {
    const box = live.get(item.familyName)
    return {
      key: item.familyName,
      rect: box
        ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
        : libraryItemRect(index, layout),
    }
  })
}

export function libraryItemScrollTop(
  index: number,
  columns: number,
  rowHeight: number,
  gap: number,
): number {
  const cols = Math.max(1, columns)
  const row = Math.floor(Math.max(0, index) / cols)
  return row * libraryRowStride(rowHeight, gap)
}

export function sameLibraryWindow(
  left: Pick<LibraryWindowMetrics, 'start' | 'end' | 'columns' | 'rowHeight' | 'gap' | 'padTop' | 'padBottom'>,
  right: Pick<LibraryWindowMetrics, 'start' | 'end' | 'columns' | 'rowHeight' | 'gap' | 'padTop' | 'padBottom'>,
): boolean {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.columns === right.columns &&
    left.rowHeight === right.rowHeight &&
    left.gap === right.gap &&
    left.padTop === right.padTop &&
    left.padBottom === right.padBottom
  )
}

export function sliceLibraryWindow<T>(items: T[], start: number, end: number): T[] {
  if (items.length === 0) return items
  if (end <= start || start >= items.length) return items.slice(0, Math.min(items.length, 48))
  return items.slice(start, Math.min(end, items.length))
}

export function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

export function catalogEntriesForPreviewCss(
  mountedGroups: Array<{ entries: CatalogEntry[] }>,
  pinnedGroups: Array<{ entries: CatalogEntry[] }> = [],
): CatalogEntry[] {
  const entries: CatalogEntry[] = []
  for (const group of mountedGroups) entries.push(...group.entries)
  for (const group of pinnedGroups) entries.push(...group.entries)
  return uniqueById(entries)
}

function systemFaceKey(face: Pick<SystemFace, 'path' | 'weight' | 'italic'>): string {
  return `${face.path}\t${face.weight ?? ''}\t${face.italic ? 1 : 0}`
}

export function systemFacesForPreviewCss(
  mountedGroups: Array<{ faces: SystemFace[] }>,
  pinnedGroups: Array<{ faces: SystemFace[] }> = [],
): SystemFace[] {
  const seen = new Set<string>()
  const out: SystemFace[] = []
  for (const group of [...mountedGroups, ...pinnedGroups]) {
    for (const face of group.faces) {
      const key = systemFaceKey(face)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(face)
    }
  }
  return out
}

export function contentOffsetTop(element: HTMLElement, ancestor: HTMLElement): number {
  const ancestorBox = ancestor.getBoundingClientRect()
  const box = element.getBoundingClientRect()
  return box.top - ancestorBox.top + ancestor.scrollTop
}

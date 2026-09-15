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
  tops?: number[]
  heights?: number[]
}

export type LibraryWindowLayout = {
  count: number
  columns: number
  columnWidth: number
  rowHeight: number
  gap: number
  originLeft: number
  originTop: number
  tops?: number[]
  heights?: number[]
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
  // Collapsed estimate only. Expanded InstanceList rows are measured via itemHeights.
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

export function libraryGridRowHeights(
  itemHeights: number[],
  columns: number,
  fallback: number,
): number[] {
  const cols = Math.max(1, columns)
  const estimated = Math.max(0, fallback)
  const totalRows = Math.ceil(Math.max(0, itemHeights.length) / cols)
  const rows: number[] = []
  for (let row = 0; row < totalRows; row++) {
    let height = estimated
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col
      if (index >= itemHeights.length) break
      const value = itemHeights[index]
      if (Number.isFinite(value) && (value as number) > 0) height = Math.max(height, value as number)
    }
    rows.push(height)
  }
  return rows
}

function itemLayoutFromRowHeights(
  rowHeights: number[],
  rowTops: number[],
  count: number,
  columns: number,
): { heights: number[]; tops: number[] } {
  const cols = Math.max(1, columns)
  const heights: number[] = []
  const tops: number[] = []
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / cols)
    heights.push(rowHeights[row] ?? 0)
    tops.push(rowTops[row] ?? 0)
  }
  return { heights, tops }
}

export function libraryItemOffsets(heights: number[], gap: number): { tops: number[]; totalHeight: number } {
  const tops: number[] = []
  let y = 0
  for (let i = 0; i < heights.length; i++) {
    if (i > 0) y += gap
    tops.push(y)
    y += Math.max(0, heights[i] ?? 0)
  }
  return { tops, totalHeight: y }
}

export function libraryWindowRangeFromHeights(options: {
  heights: number[]
  tops: number[]
  scrollTop: number
  viewportHeight: number
  overscanPx?: number
}): { start: number; end: number } {
  const count = options.heights.length
  if (count === 0) return { start: 0, end: 0 }
  const from = options.scrollTop - Math.max(0, options.overscanPx ?? 0)
  const to = options.scrollTop + Math.max(0, options.viewportHeight) + Math.max(0, options.overscanPx ?? 0)
  let start = 0
  while (start < count) {
    if ((options.tops[start] ?? 0) + (options.heights[start] ?? 0) >= from) break
    start += 1
  }
  let end = start
  while (end < count && (options.tops[end] ?? 0) < to) end += 1
  return { start, end }
}

export function libraryWindowPads(options: {
  start: number
  end: number
  tops: number[]
  heights: number[]
  totalHeight: number
}): { padTop: number; padBottom: number } {
  const { start, end, tops, heights, totalHeight } = options
  if (heights.length === 0 || end <= start) {
    return { padTop: 0, padBottom: Math.max(0, totalHeight) }
  }
  const padTop = tops[start] ?? 0
  const last = end - 1
  const renderedBottom = (tops[last] ?? 0) + (heights[last] ?? 0)
  return { padTop, padBottom: Math.max(0, totalHeight - renderedBottom) }
}

export function applyMeasuredCardHeights(
  keys: string[],
  estimated: number,
  measured: ReadonlyMap<string, number> = new Map(),
): number[] {
  const fallback = Math.max(0, estimated)
  return keys.map((key) => {
    const height = measured.get(key)
    return Number.isFinite(height) && (height as number) > 0 ? (height as number) : fallback
  })
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
  itemHeights?: number[]
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
  if (options.itemHeights && options.itemHeights.length > 0) {
    const filled = Array.from({ length: options.count }, (_, index) => {
      const value = options.itemHeights![index]
      return Number.isFinite(value) && (value as number) > 0 ? (value as number) : rowHeight
    })
    const rowHeights = columns === 1 ? filled : libraryGridRowHeights(filled, columns, rowHeight)
    const { tops: rowTops, totalHeight } = libraryItemOffsets(rowHeights, gap)
    const overscanPx = (options.overscanRows ?? LIBRARY_OVERSCAN_ROWS) * libraryRowStride(rowHeight, gap)
    const rowRange = libraryWindowRangeFromHeights({
      heights: rowHeights,
      tops: rowTops,
      scrollTop: options.scrollTop,
      viewportHeight: options.viewportHeight,
      overscanPx,
    })
    const start = Math.min(options.count, rowRange.start * columns)
    const end = Math.min(options.count, rowRange.end * columns)
    const { heights, tops } = itemLayoutFromRowHeights(rowHeights, rowTops, options.count, columns)
    const pads = libraryWindowPads({
      start,
      end,
      tops,
      heights,
      totalHeight,
    })
    return {
      columns,
      columnWidth,
      rowHeight,
      gap,
      start,
      end,
      startRow: rowRange.start,
      endRow: rowRange.end,
      totalRows: rowHeights.length,
      padTop: pads.padTop,
      padBottom: pads.padBottom,
      totalHeight,
      tops,
      heights,
    }
  }
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
  layout: Pick<
    LibraryWindowLayout,
    'columns' | 'columnWidth' | 'rowHeight' | 'gap' | 'originLeft' | 'originTop' | 'tops' | 'heights'
  >,
): { left: number; top: number; right: number; bottom: number } {
  const cols = Math.max(1, layout.columns)
  const col = Math.max(0, index) % cols
  const left = layout.originLeft + col * (layout.columnWidth + layout.gap)
  if (layout.tops && layout.heights && index >= 0 && index < layout.heights.length) {
    const top = layout.originTop + (layout.tops[index] ?? 0)
    const height = layout.heights[index] ?? layout.rowHeight
    return { left, top, right: left + layout.columnWidth, bottom: top + height }
  }
  const row = Math.floor(Math.max(0, index) / cols)
  const stride = libraryRowStride(layout.rowHeight, layout.gap)
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
  tops?: number[],
): number {
  if (tops && index >= 0 && index < tops.length) return tops[index] ?? 0
  const cols = Math.max(1, columns)
  const row = Math.floor(Math.max(0, index) / cols)
  return row * libraryRowStride(rowHeight, gap)
}

export type ScrollToFamilyResolution =
  | { action: 'computed'; index: number }
  | { action: 'dom' }
  | { action: 'defer' }

export function resolveScrollToFamily(options: {
  target: string
  groups: Array<{ familyName: string }>
  hasViewport: boolean
  rowHeight: number
  nodePresent: boolean
}): ScrollToFamilyResolution {
  const index = options.groups.findIndex((group) => group.familyName === options.target)
  if (index >= 0 && options.hasViewport && options.rowHeight > 0) {
    return { action: 'computed', index }
  }
  if (options.nodePresent) return { action: 'dom' }
  return { action: 'defer' }
}

export function sameLibraryWindow(
  left: Pick<
    LibraryWindowMetrics,
    'start' | 'end' | 'columns' | 'rowHeight' | 'gap' | 'padTop' | 'padBottom' | 'totalHeight'
  >,
  right: Pick<
    LibraryWindowMetrics,
    'start' | 'end' | 'columns' | 'rowHeight' | 'gap' | 'padTop' | 'padBottom' | 'totalHeight'
  >,
): boolean {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.columns === right.columns &&
    left.rowHeight === right.rowHeight &&
    left.gap === right.gap &&
    left.padTop === right.padTop &&
    left.padBottom === right.padBottom &&
    left.totalHeight === right.totalHeight
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

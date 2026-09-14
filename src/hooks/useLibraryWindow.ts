import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import {
  LIBRARY_GRID_GAP_REM,
  LIBRARY_LIST_GAP_REM,
  LIBRARY_OVERSCAN_ROWS,
  LIBRARY_WINDOW_FALLBACK_HEIGHT,
  LIBRARY_WINDOW_FALLBACK_WIDTH,
  applyMeasuredCardHeights,
  contentOffsetTop,
  gridCardMinWidthRem,
  libraryRowHeightPx,
  libraryWindowMetrics,
  sameLibraryWindow,
  type LibraryWindowLayout,
  type LibraryWindowMetrics,
} from '@/lib/libraryWindow'
import type { ViewLayout } from '@/lib/types'

const EMPTY_WINDOW: LibraryWindowMetrics = {
  columns: 1,
  columnWidth: LIBRARY_WINDOW_FALLBACK_WIDTH,
  rowHeight: 0,
  gap: 0,
  start: 0,
  end: 0,
  startRow: 0,
  endRow: 0,
  totalRows: 0,
  padTop: 0,
  padBottom: 0,
  totalHeight: 0,
}

function readRootFontSize(): number {
  if (typeof document === 'undefined') return 16
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(size) && size > 0 ? size : 16
}

function fallbackWindow(
  count: number,
  layout: ViewLayout,
  previewSize: number,
  extraLines: number,
): LibraryWindowMetrics {
  return libraryWindowMetrics({
    count,
    layout,
    width: LIBRARY_WINDOW_FALLBACK_WIDTH,
    minCardWidth: gridCardMinWidthRem(previewSize) * 16,
    previewSize,
    rootFontSize: 16,
    extraLines,
    scrollTop: 0,
    viewportHeight: LIBRARY_WINDOW_FALLBACK_HEIGHT,
  })
}

export function useLibraryWindow(options: {
  count: number
  itemKeys?: readonly string[]
  layout: ViewLayout
  previewSize: number
  extraLines?: number
  viewportRef: RefObject<HTMLElement | null>
  gridRef: RefObject<HTMLElement | null>
  enabled?: boolean
  frozen?: boolean
}): {
  window: LibraryWindowMetrics
  layoutRef: RefObject<LibraryWindowLayout>
  gridStyle: CSSProperties
} {
  const {
    count,
    itemKeys,
    layout,
    previewSize,
    extraLines = 0,
    viewportRef,
    gridRef,
    enabled = true,
    frozen = false,
  } = options
  const [measured, setMeasured] = useState<LibraryWindowMetrics>(() =>
    fallbackWindow(count, layout, previewSize, extraLines),
  )
  const metrics = enabled ? measured : EMPTY_WINDOW
  const layoutRef = useRef<LibraryWindowLayout>({
    count,
    columns: metrics.columns,
    columnWidth: metrics.columnWidth,
    rowHeight: metrics.rowHeight,
    gap: metrics.gap,
    originLeft: 0,
    originTop: 0,
  })

  useLayoutEffect(() => {
    if (!enabled) return
    const viewport = viewportRef.current
    const grid = gridRef.current
    if (!viewport || !grid) return

    let frame = 0

    function measure() {
      const viewportNode = viewportRef.current
      const gridNode = gridRef.current
      if (!viewportNode || !gridNode) return
      if (frozen && layoutRef.current.rowHeight > 0) {
        const origin = gridNode.getBoundingClientRect()
        layoutRef.current = {
          ...layoutRef.current,
          originLeft: origin.left,
          originTop: origin.top,
        }
        return
      }
      const width = gridNode.clientWidth || viewportNode.clientWidth || LIBRARY_WINDOW_FALLBACK_WIDTH
      const height = viewportNode.clientHeight || LIBRARY_WINDOW_FALLBACK_HEIGHT
      const rootFontSize = readRootFontSize()
      const minCardWidth = gridCardMinWidthRem(previewSize) * rootFontSize
      const gridOffsetTop = contentOffsetTop(gridNode, viewportNode)
      const estimatedRowHeight = libraryRowHeightPx(layout, previewSize, rootFontSize, extraLines)
      let itemHeights: number[] | undefined
      if (layout === 'list' && itemKeys && itemKeys.length === count) {
        const measured = new Map<string, number>()
        for (const node of Array.from(gridNode.querySelectorAll('[data-family-key]'))) {
          if (!(node instanceof HTMLElement)) continue
          const key = node.getAttribute('data-family-key')
          if (!key) continue
          const boxHeight = Math.ceil(node.getBoundingClientRect().height)
          if (boxHeight > 0) measured.set(key, boxHeight)
        }
        itemHeights = applyMeasuredCardHeights([...itemKeys], estimatedRowHeight, measured)
      }
      const next = libraryWindowMetrics({
        count,
        layout,
        width,
        minCardWidth,
        previewSize,
        rootFontSize,
        extraLines,
        scrollTop: Math.max(0, viewportNode.scrollTop - gridOffsetTop),
        viewportHeight: height,
        overscanRows: LIBRARY_OVERSCAN_ROWS,
        itemHeights,
      })
      const origin = gridNode.getBoundingClientRect()
      layoutRef.current = {
        count,
        columns: next.columns,
        columnWidth: next.columnWidth,
        rowHeight: next.rowHeight,
        gap: next.gap,
        originLeft: origin.left,
        originTop: origin.top,
        tops: next.tops,
        heights: next.heights,
      }
      setMeasured((current) =>
        sameLibraryWindow(current, next) && current.columnWidth === next.columnWidth ? current : next,
      )
    }

    function onScroll() {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }

    measure()
    const observer = new ResizeObserver(onScroll)
    observer.observe(viewport)
    observer.observe(grid)
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      viewport.removeEventListener('scroll', onScroll)
    }
  }, [count, enabled, extraLines, frozen, itemKeys, layout, previewSize, gridRef, viewportRef])

  const gridStyle = useMemo<CSSProperties>(() => {
    const columns =
      layout === 'grid' ? `repeat(auto-fill, minmax(${gridCardMinWidthRem(previewSize)}rem, 1fr))` : undefined
    return {
      display: 'grid',
      gap: `${layout === 'grid' ? LIBRARY_GRID_GAP_REM : LIBRARY_LIST_GAP_REM}rem`,
      gridTemplateColumns: columns,
      gridAutoRows:
        layout === 'grid' && metrics.rowHeight > 0 ? `${metrics.rowHeight}px` : undefined,
      paddingTop: metrics.padTop,
      paddingBottom: metrics.padBottom,
      alignItems: 'start',
      overflowAnchor: 'none',
    }
  }, [layout, metrics.padBottom, metrics.padTop, metrics.rowHeight, previewSize])

  return { window: metrics, layoutRef, gridStyle }
}

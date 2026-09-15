import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  alignLibraryWindowToRows,
  applyMeasuredCardHeights,
  catalogEntriesForPreviewCss,
  libraryCardRects,
  libraryGridColumns,
  libraryGridRowHeights,
  libraryItemOffsets,
  libraryItemRect,
  libraryItemScrollTop,
  libraryTotalHeight,
  libraryWindowMetrics,
  libraryWindowPads,
  libraryWindowRange,
  libraryWindowRangeFromHeights,
  resolveScrollToFamily,
  sameLibraryWindow,
  sliceLibraryWindow,
  systemFacesForPreviewCss,
} from './libraryWindow.ts'
import { catalogEntriesNeedingPreviewCss, catalogPreviewFingerprint } from './preview.ts'
import type { CatalogEntry, FontFaceInfo, SystemFace } from './types.ts'

function face(familyName: string): FontFaceInfo {
  return {
    familyName,
    styleName: 'Regular',
    fullName: `${familyName} Regular`,
    postscriptName: `${familyName}-Regular`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function entry(id: string, familyName = id): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.ttf`,
    sourceMtimeMs: 10,
    sourceSize: 100,
    status: 'installed',
    installedPath: `/tmp/installed/${id}.ttf`,
    installedSnapshotMtimeMs: 1,
    installedSnapshotSize: 50,
    faces: [face(familyName)],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
  }
}

function group(id: string) {
  const catalog = entry(id)
  return { key: id, familyName: id, entries: [catalog] }
}

test('libraryGridColumns fills auto-fit tracks from the min card width', () => {
  assert.equal(libraryGridColumns(400, 180, 12), 2)
  assert.equal(libraryGridColumns(900, 180, 12), 4)
  assert.equal(libraryGridColumns(0, 180, 12), 1)
})

test('libraryGridRowHeights uses the tallest card on each row', () => {
  assert.deepEqual(libraryGridRowHeights([100, 180, 90, 120], 2, 80), [180, 120])
  assert.deepEqual(libraryGridRowHeights([50], 3, 80), [80])
})

test('libraryWindowRange only covers visible rows plus overscan, not the full catalog', () => {
  const range = libraryWindowRange({
    count: 400,
    columns: 4,
    rowHeight: 180,
    gap: 12,
    scrollTop: 0,
    viewportHeight: 600,
    overscanRows: 2,
  })
  assert.equal(range.start, 0)
  assert.ok(range.end < 400)
  assert.ok(range.end <= 4 * (Math.ceil(600 / 192) + 2))

  const scrolled = libraryWindowRange({
    count: 400,
    columns: 4,
    rowHeight: 180,
    gap: 12,
    scrollTop: 1920,
    viewportHeight: 600,
    overscanRows: 2,
  })
  assert.ok(scrolled.start > 0)
  assert.ok(scrolled.end < 400)
  assert.ok(scrolled.end - scrolled.start < 80)
})

test('library window aligns to full rows so CSS grid columns stay stable', () => {
  const aligned = alignLibraryWindowToRows(5, 14, 40, 4)
  assert.equal(aligned.start, 4)
  assert.equal(aligned.end, 16)
  assert.equal(aligned.startRow, 1)
  assert.equal(aligned.endRow, 4)
})

test('libraryWindowMetrics pads off-screen rows instead of mounting them', () => {
  const metrics = libraryWindowMetrics({
    count: 200,
    layout: 'grid',
    width: 960,
    minCardWidth: 180,
    previewSize: 4.25,
    rootFontSize: 16,
    scrollTop: 800,
    viewportHeight: 640,
    overscanRows: 2,
  })
  assert.equal(metrics.columns > 1, true)
  assert.ok(metrics.end - metrics.start < 200)
  assert.ok(metrics.padTop > 0)
  assert.ok(metrics.padBottom > 0)
  assert.equal(
    metrics.totalHeight,
    libraryTotalHeight(200, metrics.columns, metrics.rowHeight, metrics.gap),
  )
  const list = libraryWindowMetrics({
    count: 200,
    layout: 'list',
    width: 960,
    minCardWidth: 180,
    previewSize: 4.25,
    rootFontSize: 16,
    scrollTop: 0,
    viewportHeight: 640,
    overscanRows: 2,
  })
  assert.equal(list.columns, 1)
  assert.ok(list.end < 200)
})

test('catalogEntriesForPreviewCss is bounded by the mounted window, not catalog size', () => {
  const catalog = Array.from({ length: 120 }, (_, index) => group(`f${index}`))
  const mounted = catalog.slice(8, 20)
  const pinned = [catalog[90]!]
  const preview = catalogEntriesForPreviewCss(mounted, pinned)
  assert.equal(preview.length, 13)
  assert.deepEqual(
    preview.map((item) => item.id),
    [...mounted.map((item) => item.familyName), 'f90'],
  )
  const needed = catalogEntriesNeedingPreviewCss(preview, new Map())
  assert.equal(needed.keep.size, 13)
  assert.equal(needed.changed.length, 13)
  assert.equal(needed.keep.has('f0'), false)
  assert.equal(needed.keep.has('f90'), true)
})

test('sliceLibraryWindow falls back to a first page when the range is empty', () => {
  const items = Array.from({ length: 80 }, (_, index) => index)
  assert.deepEqual(sliceLibraryWindow(items, 4, 10), [4, 5, 6, 7, 8, 9])
  assert.equal(sliceLibraryWindow(items, 0, 0).length, 48)
  assert.equal(sliceLibraryWindow(items, 90, 100).length, 48)
  assert.deepEqual(sliceLibraryWindow([1, 2], 0, 0), [1, 2])
})

test('sliding the preview window does not remount CSS for overlapping cards', () => {
  const catalog = Array.from({ length: 30 }, (_, index) => entry(`f${index}`))
  const first = catalogEntriesNeedingPreviewCss(catalog.slice(0, 8), new Map())
  const scrolled = catalogEntriesNeedingPreviewCss(catalog.slice(4, 12), first.fingerprints, {
    mounted: first.keep,
  })
  assert.deepEqual(
    scrolled.changed.map((item) => item.id),
    ['f8', 'f9', 'f10', 'f11'],
  )
  assert.equal(scrolled.fingerprints.get('f4'), first.fingerprints.get('f4'))
  assert.deepEqual([...scrolled.keep].sort(), catalog.slice(4, 12).map((item) => item.id).sort())
})

test('sliding the preview window with a live catalog keeps off-screen CSS mounted', () => {
  const catalog = Array.from({ length: 30 }, (_, index) => entry(`f${index}`))
  const first = catalogEntriesNeedingPreviewCss(catalog.slice(0, 8), new Map(), { catalog })
  const scrolled = catalogEntriesNeedingPreviewCss(catalog.slice(4, 12), first.fingerprints, {
    mounted: first.keep,
    catalog,
  })
  assert.deepEqual(
    scrolled.changed.map((item) => item.id),
    ['f8', 'f9', 'f10', 'f11'],
  )
  assert.equal(scrolled.keep.has('f0'), true)
  assert.equal(scrolled.keep.has('f11'), true)
  const leftTab = catalogEntriesNeedingPreviewCss([], scrolled.fingerprints, {
    mounted: scrolled.keep,
    catalog,
  })
  assert.deepEqual(leftTab.changed, [])
  assert.equal(leftTab.keep.has('f0'), true)
  assert.equal(leftTab.keep.has('f11'), true)
})

test('pinning a selected off-screen family does not change sibling preview fingerprints', () => {
  const kept = entry('kept')
  const other = entry('other')
  const selected = entry('selected')
  const first = catalogEntriesNeedingPreviewCss([kept, other], new Map())
  const afterSelect = catalogEntriesNeedingPreviewCss([kept, other, selected], first.fingerprints, {
    mounted: first.keep,
  })
  assert.deepEqual(
    afterSelect.changed.map((item) => item.id),
    ['selected'],
  )
  assert.equal(afterSelect.fingerprints.get('kept'), first.fingerprints.get('kept'))
  assert.equal(catalogPreviewFingerprint(kept), catalogPreviewFingerprint(entry('kept')))
  assert.equal(catalogPreviewFingerprint(other), catalogPreviewFingerprint(entry('other')))
})

test('systemFacesForPreviewCss only keeps faces from the mounted window', () => {
  const faceAt = (path: string): SystemFace => ({
    path,
    familyName: path,
    styleName: 'Regular',
    fullName: path,
    postscriptName: path,
    isVariable: false,
    instanceCount: 1,
    weight: 400,
    italic: false,
    format: 'ttf',
    protected: true,
    writable: false,
  })
  const groups = Array.from({ length: 40 }, (_, index) => ({
    faces: [faceAt(`/System/Library/Fonts/${index}.ttf`)],
  }))
  const preview = systemFacesForPreviewCss(groups.slice(0, 6), [groups[30]!])
  assert.equal(preview.length, 7)
})

test('libraryCardRects prefer live mounted boxes so select does not invent a remount rect', () => {
  const items = [{ familyName: 'A' }, { familyName: 'B' }, { familyName: 'C' }]
  const layout = {
    count: 3,
    columns: 3,
    columnWidth: 100,
    rowHeight: 80,
    gap: 12,
    originLeft: 10,
    originTop: 20,
  }
  const estimated = libraryCardRects(items, layout)
  assert.deepEqual(estimated[1]?.rect, libraryItemRect(1, layout))
  const live = libraryCardRects(items, layout, [
    { key: 'B', left: 11, top: 21, right: 111, bottom: 101 },
  ])
  assert.deepEqual(live[1]?.rect, { left: 11, top: 21, right: 111, bottom: 101 })
  assert.deepEqual(live[0]?.rect, estimated[0]?.rect)
})

test('libraryItemScrollTop keeps a stable offset for a family index', () => {
  assert.equal(libraryItemScrollTop(0, 4, 180, 12), 0)
  assert.equal(libraryItemScrollTop(4, 4, 180, 12), 192)
  assert.equal(libraryItemScrollTop(9, 4, 180, 12), 384)
})

test('sameLibraryWindow ignores scroll-only identity so sibling cards can stay mounted', () => {
  const metrics = libraryWindowMetrics({
    count: 80,
    layout: 'grid',
    width: 800,
    minCardWidth: 200,
    previewSize: 4,
    rootFontSize: 16,
    scrollTop: 0,
    viewportHeight: 500,
    overscanRows: 1,
  })
  assert.equal(sameLibraryWindow(metrics, { ...metrics }), true)
  assert.equal(sameLibraryWindow(metrics, { ...metrics, start: metrics.start + 4 }), false)
})

test('expanded list row stays mounted while scrolling through its instance rows', () => {
  const estimated = 72
  const gap = 8
  const heights = Array.from({ length: 30 }, () => estimated)
  heights[4] = estimated + 18 * 40
  const { tops, totalHeight } = libraryItemOffsets(heights, gap)
  const nominalBottom = (tops[4] ?? 0) + estimated
  const scrollTop = nominalBottom + estimated * 5
  const variable = libraryWindowRangeFromHeights({
    heights,
    tops,
    scrollTop,
    viewportHeight: 240,
    overscanPx: estimated * 2,
  })
  assert.ok(variable.start <= 4)
  assert.ok(variable.end > 4)

  const uniform = libraryWindowRange({
    count: 30,
    columns: 1,
    rowHeight: estimated,
    gap,
    scrollTop,
    viewportHeight: 240,
    overscanRows: 2,
  })
  assert.ok(uniform.start > 4)

  const metrics = libraryWindowMetrics({
    count: 30,
    layout: 'list',
    width: 720,
    minCardWidth: 180,
    previewSize: 4,
    rootFontSize: 16,
    scrollTop,
    viewportHeight: 240,
    overscanRows: 2,
    itemHeights: heights,
  })
  assert.ok(metrics.start <= 4)
  assert.ok(metrics.end > 4)
  assert.equal(metrics.heights?.[4], heights[4])
  assert.ok(metrics.totalHeight > libraryTotalHeight(30, 1, estimated, metrics.gap))
  assert.equal(metrics.totalHeight, totalHeight)
  const pads = libraryWindowPads({
    start: metrics.start,
    end: metrics.end,
    tops,
    heights,
    totalHeight,
  })
  assert.equal(metrics.padTop, pads.padTop)
  assert.equal(libraryItemScrollTop(4, 1, estimated, gap, tops), tops[4])
})

test('grid windowing uses the tallest card in each row', () => {
  const estimated = 180
  const heights = Array.from({ length: 40 }, () => estimated)
  heights[2] = 320
  const withHeights = libraryWindowMetrics({
    count: 40,
    layout: 'grid',
    width: 960,
    minCardWidth: 180,
    previewSize: 4.25,
    rootFontSize: 16,
    scrollTop: 0,
    viewportHeight: 640,
    overscanRows: 2,
    itemHeights: heights,
  })
  const without = libraryWindowMetrics({
    count: 40,
    layout: 'grid',
    width: 960,
    minCardWidth: 180,
    previewSize: 4.25,
    rootFontSize: 16,
    scrollTop: 0,
    viewportHeight: 640,
    overscanRows: 2,
  })
  assert.equal(withHeights.columns, without.columns)
  assert.ok(withHeights.columns > 1)
  assert.equal(withHeights.heights?.[2], 320)
  for (let col = 0; col < withHeights.columns; col++) {
    assert.equal(withHeights.heights?.[col], 320)
    assert.equal(withHeights.tops?.[col], 0)
  }
  assert.ok(withHeights.totalHeight > without.totalHeight)
  const rect = libraryItemRect(withHeights.columns, {
    columns: withHeights.columns,
    columnWidth: withHeights.columnWidth,
    rowHeight: withHeights.rowHeight,
    gap: withHeights.gap,
    originLeft: 0,
    originTop: 0,
    tops: withHeights.tops,
    heights: withHeights.heights,
  })
  assert.equal(rect.top, 320 + withHeights.gap)
})

test('applyMeasuredCardHeights keeps a measured expanded row and estimates the rest', () => {
  assert.deepEqual(
    applyMeasuredCardHeights(['A', 'B', 'C'], 72, new Map([['B', 640]])),
    [72, 640, 72],
  )
})

test('marquee and scrollToFamily use measured list tops instead of uniform strides', () => {
  const heights = [72, 72, 640, 72]
  const gap = 8
  const { tops } = libraryItemOffsets(heights, gap)
  const layout = {
    count: 4,
    columns: 1,
    columnWidth: 400,
    rowHeight: 72,
    gap,
    originLeft: 0,
    originTop: 10,
    tops,
    heights,
  }
  const expanded = libraryItemRect(2, layout)
  assert.equal(expanded.top, 10 + tops[2]!)
  assert.equal(expanded.bottom - expanded.top, 640)
  assert.equal(libraryItemScrollTop(2, 1, 72, gap, tops), tops[2])
  assert.equal(libraryItemScrollTop(3, 1, 72, gap, tops), tops[3])
  assert.ok(libraryItemScrollTop(3, 1, 72, gap) < tops[3]!)
})

test('scrollToFamily stays pending until the family is in the catalog or DOM', () => {
  const groups = [{ familyName: 'Already here' }]
  assert.equal(
    resolveScrollToFamily({
      target: 'New Family',
      groups,
      hasViewport: true,
      rowHeight: 80,
      nodePresent: false,
    }).action,
    'defer',
  )
  assert.deepEqual(
    resolveScrollToFamily({
      target: 'New Family',
      groups: [...groups, { familyName: 'New Family' }],
      hasViewport: true,
      rowHeight: 80,
      nodePresent: false,
    }),
    { action: 'computed', index: 1 },
  )
  assert.equal(
    resolveScrollToFamily({
      target: 'New Family',
      groups: [{ familyName: 'New Family' }],
      hasViewport: false,
      rowHeight: 80,
      nodePresent: false,
    }).action,
    'defer',
  )
  assert.equal(
    resolveScrollToFamily({
      target: 'New Family',
      groups: [{ familyName: 'New Family' }],
      hasViewport: true,
      rowHeight: 0,
      nodePresent: false,
    }).action,
    'defer',
  )
  assert.equal(
    resolveScrollToFamily({
      target: 'New Family',
      groups,
      hasViewport: false,
      rowHeight: 0,
      nodePresent: true,
    }).action,
    'dom',
  )
})

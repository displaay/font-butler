import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogFontUrl, catalogFontFaceRules, catalogPreviewFingerprint, catalogPreviewFingerprintSet, catalogPreviewRevision, catalogPreviewWhich, cachedSignedCatalogFontUrl, catalogEntriesNeedingPreviewCss, PREVIEW_CSS_RETAIN_EXTRA, previewStylesFingerprint, signedCatalogFontUrl, systemFacesNeedingPreviewCss, systemPathPreviewFingerprint, systemPreviewCssKey, systemPreviewFingerprintSet } from './preview.ts'
import { verifyFontPreviewQuery } from '../../core/font-access.ts'
import type { CatalogEntry, FontFaceInfo } from './types.ts'

function entry(partial: Partial<CatalogEntry> = {}): CatalogEntry {
  const face: FontFaceInfo = {
    familyName: 'Preview',
    styleName: 'Regular',
    fullName: 'Preview Regular',
    postscriptName: 'Preview-Regular',
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
  return {
    id: 'preview',
    sourcePath: '/tmp/Preview.ttf',
    sourceMtimeMs: 10,
    sourceSize: 100,
    status: 'installed',
    installedPath: '/tmp/installed/Preview.ttf',
    installedSnapshotMtimeMs: 1,
    installedSnapshotSize: 50,
    faces: [face],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

test('uninstalled previews use the source file, not a stale installed fingerprint', () => {
  const gone = entry({
    status: 'uninstalled',
    installedPath: undefined,
    disabledPath: undefined,
    installedFingerprint: 'b'.repeat(64),
    sourceFingerprint: 'a'.repeat(64),
    updatedAt: 9,
  })
  assert.equal(catalogPreviewWhich(gone), 'source')
  assert.equal(catalogPreviewRevision(gone, 'installed'), catalogPreviewRevision(gone, 'source'))
  assert.match(catalogFontUrl(gone, catalogPreviewWhich(gone)), /which=source/)
})

test('Adobe-only installs use the retained destination for default previews', () => {
  const adobeOnly = entry({
    installedPath: undefined,
    disabledPath: undefined,
    sourcePresent: false,
    installedFingerprint: 'c'.repeat(64),
    installations: [{
      destinationId: 'adobe-shared',
      path: '/tmp/adobe/Preview.ttf',
      verification: 'file-present',
    }],
  })
  assert.equal(catalogPreviewWhich(adobeOnly), 'installed')
  assert.notEqual(
    catalogPreviewRevision(adobeOnly, 'installed'),
    catalogPreviewRevision(adobeOnly, 'source'),
  )
})

test('outdated entries still preview installed bytes after a source cmap change', () => {
  const outdated = entry({
    status: 'outdated',
    sourceMtimeMs: 99,
    sourceSize: 999,
    previewSample: 'Aa',
  })
  assert.equal(catalogPreviewWhich(outdated), 'installed')
  assert.match(catalogFontUrl(outdated, catalogPreviewWhich(outdated)), /which=installed/)
})

test('installed preview URLs version from the installed revision, not the source mtime', () => {
  const installed = entry()
  const sourceChanged = entry({ sourceMtimeMs: 99, sourceSize: 999 })
  assert.equal(catalogPreviewRevision(installed), catalogPreviewRevision(sourceChanged))
  assert.equal(catalogFontUrl(installed), catalogFontUrl(sourceChanged))
  const reinstalled = entry({ installedSnapshotMtimeMs: 2, updatedAt: 5 })
  assert.notEqual(catalogFontUrl(installed), catalogFontUrl(reinstalled))
  assert.match(catalogFontUrl(reinstalled), /[?&]v=/)
})

test('catalogFontFaceRules emit one descriptor per collection face', () => {
  const rules = catalogFontFaceRules('fc-pack', '/api/font-file/pack', [
    { weight: 400, italic: false },
    { weight: 700, italic: false },
  ])
  assert.equal(rules.length, 2)
  assert.match(rules[0]!, /font-weight:400/)
  assert.match(rules[1]!, /font-weight:700/)
  assert.match(rules[0]!, /font-display:block/)
  assert.equal(rules[0] === rules[1], false)
})

test('variable faces register a weight range so instance hover can interpolate', () => {
  const rules = catalogFontFaceRules('fc-vf', '/api/font-file/vf', [
    { weight: 400, italic: false, isVariable: true },
  ])
  assert.equal(rules.length, 1)
  assert.match(rules[0]!, /font-weight:1 1000/)
})

test('captured revision preview URLs stay pinned when the live source fingerprint changes', () => {
  const captured = 'a'.repeat(64)
  const opened = entry({ sourceFingerprint: captured, installedFingerprint: 'b'.repeat(64) })
  const later = entry({
    sourceFingerprint: 'c'.repeat(64),
    sourceMtimeMs: 99,
    sourceSize: 999,
    updatedAt: 9,
    installedFingerprint: 'b'.repeat(64),
  })
  const openedUrl = catalogFontUrl(opened, 'revision', captured)
  const laterUrl = catalogFontUrl(later, 'revision', captured)
  assert.equal(openedUrl, laterUrl)
  assert.match(openedUrl, /which=revision/)
  assert.match(openedUrl, new RegExp(`revision=${captured}`))
  assert.notEqual(catalogFontUrl(opened, 'source'), catalogFontUrl(later, 'source'))
})

test('signed catalog preview URLs carry exp/sig that the API verifier accepts', async () => {
  const opened = entry()
  const now = 1_700_000_000_000
  const secret = 'local-secret-token'
  const url = await signedCatalogFontUrl(opened, 'installed', secret, undefined, now)
  assert.match(url, /[?&]exp=/)
  assert.match(url, /[?&]sig=/)
  const parsed = new URL(url, 'http://127.0.0.1')
  assert.equal(
    verifyFontPreviewQuery(
      secret,
      parsed.pathname,
      Object.fromEntries(parsed.searchParams),
      now,
    ),
    true,
  )
  assert.equal(
    verifyFontPreviewQuery(secret, parsed.pathname, Object.fromEntries(parsed.searchParams), now + 3 * 60 * 60 * 1000),
    false,
  )
})

test('preview stylesheet fingerprint is stable for a new catalog array with the same files', () => {
  const installed = entry()
  const copy = entry()
  assert.equal(catalogPreviewFingerprintSet([installed]), catalogPreviewFingerprintSet([copy]))
  assert.equal(
    previewStylesFingerprint([installed], []),
    previewStylesFingerprint([copy], []),
  )
})

test('preview stylesheet fingerprint ignores selection-only system-face array identity', () => {
  const installed = entry()
  const emptyA: [] = []
  const emptyB: [] = []
  assert.equal(
    previewStylesFingerprint([installed], emptyA),
    previewStylesFingerprint([installed], emptyB),
  )
  assert.equal(systemPreviewFingerprintSet(emptyA), systemPreviewFingerprintSet(emptyB))
})

test('preview stylesheet fingerprint changes when the live file revision changes', () => {
  const installed = entry()
  const reinstalled = entry({ installedSnapshotMtimeMs: 2, updatedAt: 5, installedFingerprint: 'c'.repeat(64) })
  assert.notEqual(catalogPreviewFingerprintSet([installed]), catalogPreviewFingerprintSet([reinstalled]))
})

test('cached signed preview URLs are reused until the unsigned catalog URL changes', async () => {
  const installed = entry()
  const secret = 'local-secret-token'
  const cache = new Map<string, string>()
  const first = await cachedSignedCatalogFontUrl(cache, installed, 'installed', secret, { now: 1_700_000_000_000 })
  const laterTick = await cachedSignedCatalogFontUrl(cache, installed, 'installed', secret, { now: 1_700_000_060_000 })
  assert.equal(first, laterTick)
  const refreshed = await cachedSignedCatalogFontUrl(cache, installed, 'installed', secret, {
    now: 1_700_000_120_000,
    refresh: true,
  })
  assert.notEqual(first, refreshed)
  const sibling = entry({ id: 'other' })
  const other = await cachedSignedCatalogFontUrl(cache, sibling, 'installed', secret, { now: 1_700_000_180_000 })
  const stillFirst = await cachedSignedCatalogFontUrl(cache, installed, 'installed', secret, { now: 1_700_000_240_000 })
  assert.equal(stillFirst, refreshed)
  assert.notEqual(other, refreshed)
})

test('catalogEntriesNeedingPreviewCss for a viewport window stays far below catalog size', () => {
  const catalog = Array.from({ length: 500 }, (_, index) => entry({ id: `bulk-${index}` }))
  const windowed = catalog.slice(12, 40)
  const needed = catalogEntriesNeedingPreviewCss(windowed, new Map())
  assert.equal(needed.keep.size, 28)
  assert.equal(needed.changed.length, 28)
  assert.ok(needed.keep.size < catalog.length / 10)
})

test('uninstalling one catalog entry does not change a sibling preview fingerprint', () => {
  const kept = entry({ id: 'kept' })
  const removed = entry({
    id: 'removed',
    status: 'installed',
    installedPath: '/tmp/installed/Removed.ttf',
  })
  const after = entry({
    id: 'removed',
    status: 'uninstalled',
    installedPath: undefined,
    disabledPath: undefined,
    installedFingerprint: 'b'.repeat(64),
    sourceFingerprint: 'a'.repeat(64),
    updatedAt: 9,
  })
  assert.equal(catalogPreviewFingerprint(kept), catalogPreviewFingerprint(entry({ id: 'kept' })))
  assert.notEqual(catalogPreviewFingerprint(removed), catalogPreviewFingerprint(after))
  assert.equal(catalogPreviewWhich(after), 'source')
})

test('catalogEntriesNeedingPreviewCss skips unchanged fingerprints until refresh', () => {
  const kept = entry({ id: 'kept' })
  const other = entry({ id: 'other' })
  const first = catalogEntriesNeedingPreviewCss([kept, other], new Map())
  assert.deepEqual(first.changed.map((item) => item.id).sort(), ['kept', 'other'])
  const second = catalogEntriesNeedingPreviewCss([kept, other], first.fingerprints, {
    mounted: first.keep,
  })
  assert.deepEqual(second.changed, [])
  const refreshed = catalogEntriesNeedingPreviewCss([kept, other], first.fingerprints, {
    refresh: true,
    mounted: first.keep,
  })
  assert.equal(refreshed.changed.length, 2)
  const removed = catalogEntriesNeedingPreviewCss([kept], first.fingerprints, { mounted: first.keep })
  assert.deepEqual([...removed.keep], ['kept'])
  assert.deepEqual(removed.changed, [])
})

test('catalog preview fingerprint changes when install verification flips at the same path', () => {
  const path = '/tmp/installed/Preview.ttf'
  const unavailable = entry({
    id: 'flip',
    sourcePath: '',
    sourcePresent: false,
    installedPath: path,
    disabledPath: undefined,
    installations: [{ destinationId: 'macos', path, verification: 'unavailable' }],
    retailRelativePath: 'Preview/Preview.otf',
    status: 'uninstalled',
  })
  const present = {
    ...unavailable,
    installations: [{ destinationId: 'macos', path, verification: 'file-present' as const }],
  }
  assert.notEqual(catalogPreviewFingerprint(unavailable), catalogPreviewFingerprint(present))
  const first = catalogEntriesNeedingPreviewCss([unavailable], new Map())
  assert.deepEqual([...first.keep], [])
  const after = catalogEntriesNeedingPreviewCss([present], first.fingerprints, { mounted: first.keep })
  assert.deepEqual([...after.keep], ['flip'])
  assert.deepEqual(after.changed.map((item) => item.id), ['flip'])
  const gone = catalogEntriesNeedingPreviewCss([unavailable], after.fingerprints, { mounted: after.keep })
  assert.deepEqual([...gone.keep], [])
  assert.deepEqual(gone.changed, [])
})

test('catalogEntriesNeedingPreviewCss skips listings with no file to load', () => {
  const installed = entry({ id: 'on' })
  const stub = entry({
    id: 'stub',
    sourcePath: '',
    sourcePresent: false,
    installedPath: undefined,
    disabledPath: undefined,
    installations: [],
    retailRelativePath: 'Reckless/Reckless-Regular.otf',
    status: 'uninstalled',
  })
  const stale = entry({
    id: 'stale',
    sourcePath: '',
    sourcePresent: false,
    installedPath: '/tmp/installed/Gone.ttf',
    disabledPath: undefined,
    installations: [{ destinationId: 'macos', path: '/tmp/installed/Gone.ttf', verification: 'unavailable' }],
    retailRelativePath: 'Reckless/Reckless-Bold.otf',
    status: 'uninstalled',
  })
  const pathOnly = entry({
    id: 'path-only',
    sourcePath: '',
    sourcePresent: false,
    installedPath: '/tmp/installed/Gone.ttf',
    disabledPath: undefined,
    installations: [],
    retailRelativePath: 'Reckless/Reckless-Light.otf',
    status: 'uninstalled',
  })
  const needed = catalogEntriesNeedingPreviewCss([installed, stub, stale, pathOnly], new Map())
  assert.deepEqual([...needed.keep], ['on'])
  assert.deepEqual(needed.changed.map((item) => item.id), ['on'])
  assert.equal(needed.fingerprints.has('stub'), false)
  assert.equal(needed.fingerprints.has('stale'), false)
  assert.equal(needed.fingerprints.has('path-only'), false)
})

test('retained catalog CSS stays cached when the Fonts viewport unmounts', () => {
  const catalog = Array.from({ length: 12 }, (_, index) => entry({ id: `keep-${index}` }))
  const windowed = catalog.slice(0, 4)
  const first = catalogEntriesNeedingPreviewCss(windowed, new Map(), { catalog })
  assert.deepEqual(first.changed.map((item) => item.id), ['keep-0', 'keep-1', 'keep-2', 'keep-3'])
  assert.equal(first.keep.size, 4)

  const leftTab = catalogEntriesNeedingPreviewCss([], first.fingerprints, {
    mounted: first.keep,
    catalog,
  })
  assert.deepEqual(leftTab.changed, [])
  assert.deepEqual([...leftTab.keep].sort(), [...first.keep].sort())
  assert.equal(leftTab.fingerprints.get('keep-0'), first.fingerprints.get('keep-0'))

  const back = catalogEntriesNeedingPreviewCss(windowed, leftTab.fingerprints, {
    mounted: leftTab.keep,
    catalog,
  })
  assert.deepEqual(back.changed, [])
  assert.equal(back.keep.size, 4)
})

test('retained catalog CSS still only loads the viewport on first paint', () => {
  const catalog = Array.from({ length: 80 }, (_, index) => entry({ id: `bulk-${index}` }))
  const windowed = catalog.slice(12, 40)
  const needed = catalogEntriesNeedingPreviewCss(windowed, new Map(), { catalog })
  assert.equal(needed.keep.size, 28)
  assert.equal(needed.changed.length, 28)
  assert.equal(needed.keep.has('bulk-0'), false)
  assert.equal(needed.fingerprints.has('bulk-0'), false)
})

test('install or uninstall of a cached off-screen font rebuilds only that preview', () => {
  const kept = entry({ id: 'kept' })
  const sibling = entry({
    id: 'removed',
    status: 'installed',
    installedPath: '/tmp/installed/Removed.ttf',
  })
  const catalog = [kept, sibling]
  const first = catalogEntriesNeedingPreviewCss([kept, sibling], new Map(), { catalog })
  const leftTab = catalogEntriesNeedingPreviewCss([], first.fingerprints, {
    mounted: first.keep,
    catalog,
  })
  assert.deepEqual(leftTab.changed, [])

  const after = entry({
    id: 'removed',
    status: 'uninstalled',
    installedPath: undefined,
    disabledPath: undefined,
    installedFingerprint: 'b'.repeat(64),
    sourceFingerprint: 'a'.repeat(64),
    updatedAt: 9,
  })
  const nextCatalog = [kept, after]
  const updated = catalogEntriesNeedingPreviewCss([], leftTab.fingerprints, {
    mounted: leftTab.keep,
    catalog: nextCatalog,
  })
  assert.deepEqual(updated.changed.map((item) => item.id), ['removed'])
  assert.equal(updated.keep.has('kept'), true)
  assert.equal(updated.keep.has('removed'), true)
  assert.notEqual(updated.fingerprints.get('removed'), first.fingerprints.get('removed'))
  assert.equal(updated.fingerprints.get('kept'), first.fingerprints.get('kept'))
})

test('deleting a cached font drops its retained preview CSS', () => {
  const kept = entry({ id: 'kept' })
  const removed = entry({ id: 'removed' })
  const first = catalogEntriesNeedingPreviewCss([kept, removed], new Map(), { catalog: [kept, removed] })
  const gone = catalogEntriesNeedingPreviewCss([], first.fingerprints, {
    mounted: first.keep,
    catalog: [kept],
  })
  assert.deepEqual([...gone.keep], ['kept'])
  assert.deepEqual(gone.changed, [])
  assert.equal(gone.fingerprints.has('removed'), false)
})

test('sliding the window with a live catalog keeps already-loaded CSS', () => {
  const catalog = Array.from({ length: 30 }, (_, index) => entry({ id: `f${index}` }))
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
  assert.equal(scrolled.keep.has('f3'), true)
  assert.equal(scrolled.fingerprints.get('f0'), first.fingerprints.get('f0'))
})

test('retained off-screen preview CSS is LRU-capped', () => {
  const catalog = Array.from({ length: 200 }, (_, index) => entry({ id: `cap-${index}` }))
  const first = catalogEntriesNeedingPreviewCss(catalog.slice(0, 180), new Map(), { catalog })
  const windowed = catalogEntriesNeedingPreviewCss(catalog.slice(180, 188), first.fingerprints, {
    mounted: first.keep,
    catalog,
  })
  assert.equal(windowed.keep.size, 8 + PREVIEW_CSS_RETAIN_EXTRA)
  assert.equal(windowed.keep.has('cap-187'), true)
  assert.equal(windowed.keep.has('cap-0'), false)
})

test('leaving the Fonts tab keeps the full already-mounted preview CSS set', () => {
  const catalog = Array.from({ length: 180 }, (_, index) => entry({ id: `cap-${index}` }))
  const first = catalogEntriesNeedingPreviewCss(catalog.slice(0, 180), new Map(), { catalog })
  assert.equal(first.keep.size, 180)
  const leftTab = catalogEntriesNeedingPreviewCss([], first.fingerprints, {
    mounted: first.keep,
    catalog,
  })
  assert.equal(leftTab.keep.size, 180)
  assert.deepEqual(leftTab.changed, [])
  assert.equal(leftTab.keep.has('cap-0'), true)
  const back = catalogEntriesNeedingPreviewCss(catalog.slice(0, 10), leftTab.fingerprints, {
    mounted: leftTab.keep,
    catalog,
  })
  assert.deepEqual(back.changed, [])
  assert.equal(back.keep.has('cap-0'), true)
})

test('system preview CSS stays cached when leaving the System tab', () => {
  const ttc = '/System/Library/Fonts/Collection.ttc'
  const other = '/System/Library/Fonts/Other.ttf'
  const regular = { path: ttc, weight: 400, italic: false, isVariable: false }
  const bold = { path: ttc, weight: 700, italic: false, isVariable: false }
  const extra = { path: other, weight: 400, italic: false, isVariable: false }
  const catalog = [regular, bold, extra]
  const first = systemFacesNeedingPreviewCss([regular, bold], new Map(), { catalog })
  assert.deepEqual([...first.keep], [systemPreviewCssKey(regular)])
  const leftTab = systemFacesNeedingPreviewCss([], first.fingerprints, {
    mounted: first.keep,
    catalog,
  })
  assert.deepEqual(leftTab.changed, [])
  assert.deepEqual([...leftTab.keep], [systemPreviewCssKey(regular)])
  const back = systemFacesNeedingPreviewCss([regular, bold], leftTab.fingerprints, {
    mounted: leftTab.keep,
    catalog,
  })
  assert.deepEqual(back.changed, [])
})

test('system path fingerprints cover every TTC/OTC face on the shared file', () => {
  const ttc = '/System/Library/Fonts/Collection.ttc'
  const regular = { path: ttc, weight: 400, italic: false, isVariable: false }
  const bold = { path: ttc, weight: 700, italic: false, isVariable: false }
  const italic = { path: ttc, weight: 400, italic: true, isVariable: false }
  assert.equal(
    systemPathPreviewFingerprint([regular, bold]),
    systemPathPreviewFingerprint([bold, regular]),
  )
  assert.notEqual(
    systemPathPreviewFingerprint([regular, bold]),
    systemPathPreviewFingerprint([regular, italic]),
  )
  const rules = catalogFontFaceRules('sys-ttc', '/api/system-font?path=Collection.ttc', [regular, bold])
  assert.equal(rules.length, 2)
  assert.match(rules[0]!, /font-weight:400/)
  assert.match(rules[1]!, /font-weight:700/)
})

test('systemFacesNeedingPreviewCss keeps the full path group instead of clobbering TTC faces', () => {
  const ttc = '/System/Library/Fonts/Collection.ttc'
  const other = '/System/Library/Fonts/Other.ttf'
  const regular = { path: ttc, weight: 400, italic: false, isVariable: false }
  const bold = { path: ttc, weight: 700, italic: false, isVariable: false }
  const extra = { path: other, weight: 400, italic: false, isVariable: false }
  const first = systemFacesNeedingPreviewCss([regular, bold, extra], new Map())
  assert.deepEqual(
    [...first.keep].sort(),
    [systemPreviewCssKey(extra), systemPreviewCssKey(regular)].sort(),
  )
  const collection = first.changed.find((group) => group.path === ttc)
  assert.ok(collection)
  assert.equal(collection.faces.length, 2)
  assert.deepEqual(
    collection.faces.map((face) => face.weight).sort(),
    [400, 700],
  )
  assert.equal(
    first.fingerprints.get(systemPreviewCssKey(regular)),
    systemPathPreviewFingerprint([regular, bold]),
  )

  const second = systemFacesNeedingPreviewCss([regular, bold, extra], first.fingerprints, {
    mounted: first.keep,
  })
  assert.deepEqual(second.changed, [])

  const heavier = { path: other, weight: 700, italic: false, isVariable: false }
  const third = systemFacesNeedingPreviewCss([regular, bold, heavier], first.fingerprints, {
    mounted: first.keep,
  })
  assert.equal(third.changed.length, 1)
  assert.equal(third.changed[0]!.path, other)
  assert.equal(
    third.fingerprints.get(systemPreviewCssKey(regular)),
    first.fingerprints.get(systemPreviewCssKey(regular)),
  )
})

test('shared TTC families keep separate cached preview CSS when scrolling', () => {
  const ttc = '/System/Library/Fonts/Collection.ttc'
  const displayRegular = {
    path: ttc,
    familyName: 'Collection Display',
    weight: 400,
    italic: false,
    isVariable: false,
  }
  const displayBold = {
    path: ttc,
    familyName: 'Collection Display',
    weight: 700,
    italic: false,
    isVariable: false,
  }
  const textRegular = {
    path: ttc,
    familyName: 'Collection Text',
    weight: 400,
    italic: false,
    isVariable: false,
  }
  const textItalic = {
    path: ttc,
    familyName: 'Collection Text',
    weight: 400,
    italic: true,
    isVariable: false,
  }
  const catalog = [displayRegular, displayBold, textRegular, textItalic]
  const displayKey = systemPreviewCssKey(displayRegular)
  const textKey = systemPreviewCssKey(textRegular)
  assert.notEqual(displayKey, textKey)
  assert.equal(displayKey.startsWith(`${ttc}\t`), true)

  const first = systemFacesNeedingPreviewCss([displayRegular, displayBold], new Map(), { catalog })
  assert.deepEqual([...first.keep], [displayKey])
  assert.equal(first.changed.length, 1)
  assert.equal(first.changed[0]!.key, displayKey)
  assert.deepEqual(
    first.changed[0]!.faces.map((face) => face.weight).sort(),
    [400, 700],
  )

  const scrolled = systemFacesNeedingPreviewCss([textRegular, textItalic], first.fingerprints, {
    mounted: first.keep,
    catalog,
  })
  assert.deepEqual(
    scrolled.changed.map((group) => group.key),
    [textKey],
  )
  assert.equal(scrolled.keep.has(displayKey), true)
  assert.equal(scrolled.keep.has(textKey), true)
  assert.equal(scrolled.fingerprints.get(displayKey), first.fingerprints.get(displayKey))
  assert.notEqual(scrolled.fingerprints.get(textKey), scrolled.fingerprints.get(displayKey))

  const back = systemFacesNeedingPreviewCss([displayRegular, displayBold], scrolled.fingerprints, {
    mounted: scrolled.keep,
    catalog,
  })
  assert.deepEqual(back.changed, [])
  assert.equal(back.fingerprints.get(displayKey), first.fingerprints.get(displayKey))
})

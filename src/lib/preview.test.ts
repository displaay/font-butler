import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogFontUrl, catalogFontFaceRules, catalogPreviewFingerprint, catalogPreviewFingerprintSet, catalogPreviewRevision, catalogPreviewWhich, cachedSignedCatalogFontUrl, catalogEntriesNeedingPreviewCss, previewStylesFingerprint, signedCatalogFontUrl, systemFacesNeedingPreviewCss, systemPathPreviewFingerprint, systemPreviewFingerprintSet } from './preview.ts'
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
  assert.deepEqual([...first.keep].sort(), [other, ttc].sort())
  const collection = first.changed.find((group) => group.path === ttc)
  assert.ok(collection)
  assert.equal(collection.faces.length, 2)
  assert.deepEqual(
    collection.faces.map((face) => face.weight).sort(),
    [400, 700],
  )
  assert.equal(first.fingerprints.get(ttc), systemPathPreviewFingerprint([regular, bold]))

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
  assert.equal(third.fingerprints.get(ttc), first.fingerprints.get(ttc))
})

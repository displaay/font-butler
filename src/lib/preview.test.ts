import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogFontUrl, catalogFontFaceRules, catalogPreviewRevision, catalogPreviewWhich, signedCatalogFontUrl } from './preview.ts'
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
  assert.match(rules[0]!, /src:url\("\/api\/font-file\/pack"\)/)
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

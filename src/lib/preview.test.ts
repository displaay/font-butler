import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogFontUrl, catalogPreviewRevision } from './preview.ts'
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

test('installed preview URLs version from the installed revision, not the source mtime', () => {
  const installed = entry()
  const sourceChanged = entry({ sourceMtimeMs: 99, sourceSize: 999 })
  assert.equal(catalogPreviewRevision(installed), catalogPreviewRevision(sourceChanged))
  assert.equal(catalogFontUrl(installed), catalogFontUrl(sourceChanged))
  const reinstalled = entry({ installedSnapshotMtimeMs: 2, updatedAt: 5 })
  assert.notEqual(catalogFontUrl(installed), catalogFontUrl(reinstalled))
  assert.match(catalogFontUrl(reinstalled), /[?&]v=/)
})

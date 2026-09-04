import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertNotWebFont,
  assertSingleInstallableFormat,
  installedFormatConflict,
  isWebFontFile,
  uniqueFormats,
} from './formats.ts'
import type { CatalogEntry } from './types.ts'

function entry(partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'format'>): CatalogEntry {
  return {
    sourcePath: `/tmp/${partial.id}.${partial.format}`,
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'uninstalled',
    faces: [{ familyName: 'Family', styleName: 'Regular', fullName: 'Family Regular', postscriptName: 'Family-Regular', isVariable: false, instanceCount: 1, instanceNames: [], weight: 400, italic: false }],
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

test('isWebFontFile rejects woff and woff2', () => {
  assert.equal(isWebFontFile('/tmp/Family.woff'), true)
  assert.equal(isWebFontFile('/tmp/Family.WOFF2'), true)
  assert.equal(isWebFontFile('/tmp/Family.otf'), false)
})

test('assertNotWebFont explains the rejection', () => {
  assert.throws(() => assertNotWebFont('/tmp/Family.woff2'), /WOFF files cannot be installed/)
  assert.doesNotThrow(() => assertNotWebFont('/tmp/Family.ttf'))
})

test('assertSingleInstallableFormat blocks mixed desktop formats', () => {
  assert.throws(
    () =>
      assertSingleInstallableFormat([
        entry({ id: 'a', format: 'otf' }),
        entry({ id: 'b', format: 'ttf' }),
      ]),
    /one font format/,
  )
  assert.doesNotThrow(() =>
    assertSingleInstallableFormat([
      entry({ id: 'a', format: 'otf' }),
      entry({ id: 'b', format: 'otf' }),
    ]),
  )
})

test('installedFormatConflict finds another active format in the family', () => {
  const otf = entry({ id: 'a', format: 'otf', status: 'installed' })
  const ttf = entry({ id: 'b', format: 'ttf' })
  assert.equal(installedFormatConflict(ttf, [otf, ttf])?.id, 'a')
  assert.equal(installedFormatConflict(ttf, [ttf]), undefined)
})

test('uniqueFormats normalizes extensions', () => {
  assert.deepEqual(
    uniqueFormats([entry({ id: 'a', format: 'OTF' }), entry({ id: 'b', format: 'otf' })]),
    ['otf'],
  )
})

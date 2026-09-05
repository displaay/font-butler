import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  conflictInstanceNames,
  countFormats,
  formatFromName,
  formatLabel,
  isInstallableFormat,
  isWebFormat,
  listFormatConflicts,
  preferredFormat,
  uniqueEntryFormats,
} from './formats.ts'
import type { CatalogEntry } from './types.ts'

function entry(partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'format'>): CatalogEntry {
  return {
    sourcePath: `/tmp/${partial.id}.${partial.format}`,
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'uninstalled',
    faces: [
      {
        familyName: 'Family',
        styleName: 'Regular',
        fullName: 'Family Regular',
        postscriptName: 'Family-Regular',
        isVariable: false,
        instanceCount: 1,
        instanceNames: [],
        weight: 400,
        italic: false,
      },
    ],
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

test('formatFromName reads desktop and web extensions', () => {
  assert.equal(formatFromName('Family-Bold.otf'), 'otf')
  assert.equal(formatFromName('/tmp/Family.TTF'), 'ttf')
  assert.equal(formatFromName('Family.woff2'), 'woff2')
  assert.equal(formatFromName('notes.txt'), 'txt')
  assert.equal(formatFromName('Desktop package'), null)
})

test('isInstallableFormat rejects woff', () => {
  assert.equal(isInstallableFormat('otf'), true)
  assert.equal(isInstallableFormat('woff'), false)
  assert.equal(isInstallableFormat('woff2'), false)
})

test('isWebFormat only matches woff', () => {
  assert.equal(isWebFormat('woff2'), true)
  assert.equal(isWebFormat('otf'), false)
})

test('countFormats ignores web formats and keeps desktop order', () => {
  assert.deepEqual(countFormats(['ttf', 'otf', 'woff2', 'ttf', 'otf', 'otf']), [
    { format: 'otf', count: 3 },
    { format: 'ttf', count: 2 },
  ])
})

test('uniqueEntryFormats keeps desktop order', () => {
  assert.deepEqual(
    uniqueEntryFormats([
      entry({ id: 'b', format: 'ttf' }),
      entry({ id: 'a', format: 'otf' }),
      entry({ id: 'c', format: 'ttf' }),
    ]),
    ['otf', 'ttf'],
  )
})

test('preferredFormat prefers OpenType', () => {
  assert.equal(preferredFormat(['ttf', 'otf']), 'otf')
  assert.equal(formatLabel('otf'), 'OpenType')
})

test('listFormatConflicts matches the same instance in another format', () => {
  const otf = entry({ id: 'a', format: 'otf', status: 'installed' })
  const ttf = entry({ id: 'b', format: 'ttf' })
  const conflicts = listFormatConflicts([ttf], [otf, ttf])
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].existing.id, 'a')
  assert.deepEqual(conflictInstanceNames(conflicts), ['Family Regular'])
})

test('listFormatConflicts ignores a different style', () => {
  const otf = entry({ id: 'a', format: 'otf', status: 'installed' })
  const ttf = entry({
    id: 'b',
    format: 'ttf',
    faces: [
      {
        familyName: 'Family',
        styleName: 'Bold',
        fullName: 'Family Bold',
        postscriptName: 'Family-Bold',
        isVariable: false,
        instanceCount: 1,
        instanceNames: [],
        weight: 700,
        italic: false,
      },
    ],
  })
  assert.deepEqual(listFormatConflicts([ttf], [otf, ttf]), [])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  conflictInstanceNames,
  countFormats,
  formatFromName,
  formatLabel,
  hasMixedInstalledFormats,
  occupyingDestinationIds,
  occupyingFormats,
  occupyingIdsForFormat,
  mixedFormatWarning,
  isInstallableFormat,
  isWebFormat,
  listFormatConflicts,
  preferredFormat,
  uniqueEntryFormats,
  uniqueStyleCount,
  formatSwap,
  formatSwapLabel,
  instanceFormatSwap,
  instanceSwapLabel,
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

test('countFormats keeps desktop order and includes web formats', () => {
  assert.deepEqual(countFormats(['ttf', 'otf', 'woff2', 'ttf', 'otf', 'otf']), [
    { format: 'otf', count: 3 },
    { format: 'ttf', count: 2 },
    { format: 'woff2', count: 1 },
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

test('occupyingFormats ignores catalog-only copies', () => {
  const otf = entry({ id: 'a', format: 'otf', status: 'installed' })
  const ttf = entry({ id: 'b', format: 'ttf', status: 'uninstalled' })
  assert.deepEqual(occupyingFormats([otf, ttf]), ['otf'])
  assert.equal(hasMixedInstalledFormats([otf, ttf]), false)
})

test('mixed installed OTF and TTF expose both occupying formats', () => {
  const otf = entry({ id: 'a', format: 'otf', status: 'installed' })
  const ttf = entry({ id: 'b', format: 'ttf', status: 'outdated' })
  assert.deepEqual(occupyingFormats([otf, ttf]), ['otf', 'ttf'])
  assert.equal(hasMixedInstalledFormats([otf, ttf]), true)
  assert.deepEqual(occupyingIdsForFormat([otf, ttf], 'ttf'), ['b'])
  assert.equal(mixedFormatWarning(['otf', 'ttf']), 'OTF and TTF installed')
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

test('uniqueStyleCount collapses the same style in two formats', () => {
  const otf = entry({ id: 'a', format: 'otf', status: 'installed' })
  const ttf = entry({ id: 'b', format: 'ttf', status: 'uninstalled' })
  assert.equal(uniqueStyleCount([otf, ttf]), 1)
})

test('occupyingDestinationIds follow Mac and Adobe copies of the live format', () => {
  const otf = entry({
    id: 'a',
    format: 'otf',
    status: 'installed',
    installedPath: '/tmp/a.otf',
    installations: [
      { destinationId: 'macos', path: '/tmp/a.otf', verification: 'file-present' },
      { destinationId: 'adobe-shared', path: '/tmp/adobe/a.otf', verification: 'file-present' },
    ],
  })
  const ttf = entry({ id: 'b', format: 'ttf', status: 'uninstalled' })
  assert.deepEqual(occupyingDestinationIds([otf, ttf], 'otf'), ['macos', 'adobe-shared'])
  assert.deepEqual(occupyingDestinationIds([otf, ttf], 'ttf'), ['macos'])
})

test('formatSwap offers replacing the live format with the catalog copy', () => {
  const otf = entry({ id: 'a', format: 'otf', status: 'installed' })
  const ttf = entry({ id: 'b', format: 'ttf', status: 'uninstalled' })
  assert.deepEqual(formatSwap([otf, ttf]), {
    from: 'otf',
    to: 'ttf',
    incomingIds: ['b'],
    occupying: true,
  })
  assert.equal(formatSwapLabel(formatSwap([otf, ttf])!), 'Swap OTF for TTF')
  assert.deepEqual(instanceFormatSwap(ttf, [otf, ttf]), {
    from: 'otf',
    to: 'ttf',
    incomingIds: ['b'],
    occupying: true,
  })
  assert.deepEqual(instanceFormatSwap(otf, [otf, ttf]), {
    from: 'otf',
    to: 'ttf',
    incomingIds: ['b'],
    occupying: true,
  })
  assert.equal(instanceSwapLabel(instanceFormatSwap(ttf, [otf, ttf])!, 'b'), 'Swap with OTF')
  assert.equal(instanceSwapLabel(instanceFormatSwap(otf, [otf, ttf])!, 'a'), 'Swap for TTF')
})

test('formatSwap stays hidden when the other format is missing styles', () => {
  const otf = entry({ id: 'a', format: 'otf', status: 'installed' })
  const ttf = entry({
    id: 'b',
    format: 'ttf',
    status: 'uninstalled',
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
  assert.equal(formatSwap([otf, ttf]), null)
})

test('formatSwap offers installing the other format while a copy is parked', () => {
  const otf = entry({ id: 'a', format: 'otf', status: 'deactivated' })
  const ttf = entry({ id: 'b', format: 'ttf', status: 'uninstalled' })
  assert.deepEqual(formatSwap([otf, ttf]), {
    from: 'otf',
    to: 'ttf',
    incomingIds: ['b'],
    occupying: false,
  })
  assert.equal(formatSwapLabel(formatSwap([otf, ttf])!), 'Install TTF')
})

test('formatSwap offers the non-preferred parked format when both are deactivated', () => {
  const otf = entry({ id: 'a', format: 'otf', status: 'deactivated' })
  const ttf = entry({ id: 'b', format: 'ttf', status: 'deactivated' })
  assert.deepEqual(formatSwap([otf, ttf]), {
    from: 'otf',
    to: 'ttf',
    incomingIds: ['b'],
    occupying: false,
  })
  assert.equal(formatSwapLabel(formatSwap([otf, ttf])!), 'Install TTF')
})

test('instanceFormatSwap stays hidden for a partial collection replacement', () => {
  const collection = entry({
    id: 'collection',
    format: 'ttc',
    status: 'installed',
    faces: [
      entry({ id: 'regular', format: 'ttc' }).faces[0]!,
      {
        ...entry({ id: 'bold', format: 'ttc' }).faces[0]!,
        styleName: 'Bold',
        fullName: 'Family Bold',
        postscriptName: 'Family-Bold',
      },
    ],
  })
  const regular = entry({ id: 'regular-otf', format: 'otf', status: 'uninstalled' })
  assert.equal(instanceFormatSwap(regular, [collection, regular]), null)
})

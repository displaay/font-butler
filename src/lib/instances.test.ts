import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogInstanceRows, systemInstanceRows, variationSettings } from './instances.ts'
import { groupCatalog } from './group.ts'
import type { CatalogEntry, FamilyGroup, FontFaceInfo, SystemFace } from './types.ts'

function vfFace(): FontFaceInfo {
  return {
    familyName: 'Recoleta',
    styleName: 'Regular',
    fullName: 'Recoleta Regular',
    postscriptName: 'Recoleta-Regular',
    isVariable: true,
    instanceCount: 3,
    instanceNames: ['Light', 'Regular', 'Bold'],
    namedInstances: [
      { name: 'Light', coordinates: { wght: 300 } },
      { name: 'Regular', coordinates: { wght: 400 } },
      { name: 'Bold', coordinates: { wght: 700 } },
    ],
    weight: 400,
    italic: false,
  }
}

function group(face: FontFaceInfo): FamilyGroup {
  const entry: CatalogEntry = {
    id: 'vf',
    sourcePath: '/tmp/Recoleta.ttf',
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'uninstalled',
    faces: [face],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
  }
  return {
    key: 'Recoleta',
    familyName: 'Recoleta',
    entries: [entry],
    faces: [face],
    isVariable: true,
    instanceCount: 3,
    status: 'uninstalled',
    previewEntryId: 'vf',
    addedAt: 1,
  }
}

test('variationSettings serializes axis tags for CSS', () => {
  assert.equal(variationSettings({ wght: 300, opsz: 12 }), "'wght' 300, 'opsz' 12")
  assert.equal(variationSettings({}), undefined)
})

test('variable-font instance rows carry named-instance variation settings', () => {
  const rows = catalogInstanceRows(group(vfFace()))
  assert.equal(rows.length, 3)
  assert.deepEqual(
    rows.map((row) => row.variation),
    ["'wght' 300", "'wght' 400", "'wght' 700"],
  )
  assert.deepEqual(
    rows.map((row) => row.weight),
    [300, 400, 700],
  )
  assert.deepEqual(
    rows.map((row) => [row.format, row.installState, row.hasSource, row.macosCopy, row.adobeCopy]),
    [
      [undefined, undefined, true, undefined, undefined],
      [undefined, undefined, true, undefined, undefined],
      [undefined, undefined, true, undefined, undefined],
    ],
  )
})

function staticFace(familyName: string, styleName: string, italic = false): FontFaceInfo {
  return {
    familyName,
    styleName,
    fullName: `${familyName} ${styleName}`,
    postscriptName: `${familyName}-${styleName.replace(/\s+/g, '')}`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: italic ? 400 : styleName.toLowerCase().includes('bold') ? 700 : 400,
    italic,
  }
}

function staticEntry(
  id: string,
  styleName: string,
  status: CatalogEntry['status'],
  extra: Partial<CatalogEntry> = {},
): CatalogEntry {
  const italic = /italic/i.test(styleName)
  return {
    id,
    sourcePath: `/tmp/${id}.otf`,
    sourceMtimeMs: 1,
    sourceSize: 1,
    status,
    faces: [staticFace('Plex', styleName, italic)],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

test('instance rows carry the family preview sample', () => {
  const groups = groupCatalog([
    staticEntry('on', 'Regular', 'installed', { previewSample: 'א' }),
  ])
  assert.equal(catalogInstanceRows(groups[0]!)[0]?.previewSample, 'א')
})

test('catalog instance rows keep live vs inactive styles when the source is missing', () => {
  const groups = groupCatalog([
    staticEntry('on', 'Regular', 'installed', { sourceAvailability: 'missing' }),
    staticEntry('off', 'Italic', 'deactivated', { sourceAvailability: 'missing' }),
    staticEntry('gone', 'Bold', 'source-missing', { sourceAvailability: 'missing' }),
  ])
  assert.equal(groups.length, 1)
  const rows = catalogInstanceRows(groups[0]!)
  assert.deepEqual(
    rows.map((row) => [row.label, row.installState, row.macosCopy, row.adobeCopy]),
    [
      ['Regular', 'installed', true, false],
      ['Italic', 'deactivated', false, false],
      ['Bold', 'uninstalled', false, false],
    ],
  )
  assert.deepEqual(
    rows.map((row) => row.format),
    ['otf', 'otf', 'otf'],
  )
  assert.deepEqual(
    rows.map((row) => row.hasSource),
    [true, true, false],
  )
})

test('retail-synced instance rows carry the Displaay source instead of a disk source', () => {
  const groups = groupCatalog([
    staticEntry('retail', 'Regular', 'installed', {
      retailRelativePath: 'Plex/Plex-Regular.otf',
      retailFamilyName: 'Plex',
      sourcePresent: false,
      installedPath: '/tmp/Fonts/Plex-Regular.otf',
    }),
  ])
  const rows = catalogInstanceRows(groups[0]!)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.retailSynced, true)
  assert.equal(rows[0]?.hasSource, false)
})

test('system variable-font instance rows omit format and computer tags', () => {
  const face: SystemFace = {
    path: '/System/RecoletaVF.ttf',
    familyName: 'Recoleta',
    styleName: 'Regular',
    fullName: 'Recoleta Regular',
    postscriptName: 'Recoleta-Regular',
    isVariable: true,
    instanceCount: 2,
    instanceNames: ['Light', 'Bold'],
    weight: 400,
    italic: false,
    format: 'ttf',
    protected: false,
    writable: true,
    deactivated: false,
  }
  const rows = systemInstanceRows({
    key: 'Recoleta',
    familyName: 'Recoleta',
    faces: [face],
    isVariable: true,
    instanceCount: 2,
    protected: false,
    writable: true,
  })
  assert.deepEqual(
    rows.map((row) => [row.label, row.format, row.installState, row.macosCopy]),
    [
      ['Light', undefined, undefined, undefined],
      ['Bold', undefined, undefined, undefined],
    ],
  )
})

test('system instance rows mark deactivated faces separately from live ones', () => {
  const face = (styleName: string, deactivated = false): SystemFace => ({
    path: `/System/${styleName}.otf`,
    familyName: 'System Sans',
    styleName,
    fullName: `System Sans ${styleName}`,
    postscriptName: `SystemSans-${styleName}`,
    isVariable: false,
    instanceCount: 1,
    weight: 400,
    italic: false,
    format: 'otf',
    protected: false,
    writable: true,
    deactivated,
  })
  const rows = systemInstanceRows({
    key: 'System Sans',
    familyName: 'System Sans',
    faces: [face('Regular'), face('Light', true)],
    isVariable: false,
    instanceCount: 2,
    protected: false,
    writable: true,
  })
  assert.deepEqual(
    rows.map((row) => [row.label, row.installState, row.format, row.macosCopy]),
    [
      ['Regular', 'installed', 'otf', true],
      ['Light', 'deactivated', 'otf', false],
    ],
  )
})

test('catalog instance rows tag each file format', () => {
  const groups = groupCatalog([
    staticEntry('otf', 'Regular', 'installed', {
      format: 'otf',
      sourcePath: '/tmp/otf.otf',
      installedPath: '/Library/Fonts/otf.otf',
    }),
    staticEntry('ttf', 'Regular', 'installed', {
      format: 'ttf',
      sourcePath: '/tmp/ttf.ttf',
      faces: [staticFace('Plex', 'Regular')],
      installedPath: '/Library/Fonts/ttf.ttf',
      installations: [
        { destinationId: 'macos', path: '/Library/Fonts/ttf.ttf', verification: 'file-present' },
        {
          destinationId: 'adobe-shared',
          path: '/tmp/adobe/ttf.ttf',
          verification: 'file-present',
        },
      ],
    }),
  ])
  const rows = catalogInstanceRows(groups[0]!)
  assert.deepEqual(
    rows.map((row) => [row.label, row.format, row.installState, row.macosCopy, row.adobeCopy]),
    [
      ['Regular', 'otf', 'installed', true, false],
      ['Regular', 'ttf', 'installed', true, true],
    ],
  )
})

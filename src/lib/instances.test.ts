import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogInstanceRows, variationSettings } from './instances.ts'
import type { CatalogEntry, FamilyGroup, FontFaceInfo } from './types.ts'

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
})

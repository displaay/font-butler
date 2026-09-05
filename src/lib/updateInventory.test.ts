import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CatalogEntry, FontFaceInfo } from './types.ts'
import {
  allUpdateGroups,
  updateGroupsForIds,
  visibleUpdateGroups,
} from './updateInventory.ts'

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

function entry(id: string, familyName: string, status: CatalogEntry['status']): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.ttf`,
    sourceMtimeMs: 1,
    sourceSize: 1,
    status,
    faces: [face(familyName)],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
  }
}

test('search filters displayed update rows but not the inventory', () => {
  const entries = [
    entry('inter', 'Inter', 'outdated'),
    entry('ibm', 'IBM Plex', 'outdated'),
    entry('keep', 'Keep', 'installed'),
  ]
  const all = allUpdateGroups(entries, 'name')
  assert.deepEqual(
    all.map((group) => group.familyName),
    ['IBM Plex', 'Inter'],
  )
  const visible = visibleUpdateGroups(all, 'IBM')
  assert.deepEqual(
    visible.map((group) => group.familyName),
    ['IBM Plex'],
  )
  assert.equal(all.length, 2)
  const tray = updateGroupsForIds(all, ['inter'])
  assert.equal(tray.length, 1)
  assert.equal(tray[0]?.familyName, 'Inter')
})

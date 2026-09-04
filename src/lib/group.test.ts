import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupCatalog, isInactiveEntry, isLibraryEntry, sortFamilyGroups } from './group.ts'
import type { CatalogEntry, FontFaceInfo } from './types.ts'

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

function entry(
  id: string,
  familyName: string,
  addedAt: number,
  status: CatalogEntry['status'] = 'installed',
): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.otf`,
    sourceMtimeMs: addedAt,
    sourceSize: 1000,
    status,
    faces: [face(familyName)],
    format: 'otf',
    addedAt,
    updatedAt: addedAt,
  }
}

test('groupCatalog records the newest addedAt on a family', () => {
  const groups = groupCatalog([
    entry('old', 'Zed', 10),
    entry('new', 'Zed', 50),
    entry('solo', 'Able', 20),
  ])
  const zed = groups.find((group) => group.familyName === 'Zed')
  const able = groups.find((group) => group.familyName === 'Able')
  assert.equal(zed?.addedAt, 50)
  assert.equal(able?.addedAt, 20)
})

test('sortFamilyGroups orders alphabetically or by install date', () => {
  const groups = groupCatalog([
    entry('c', 'Courier', 100),
    entry('a', 'Arial', 300),
    entry('b', 'Baskerville', 200),
  ])
  assert.deepEqual(
    sortFamilyGroups(groups, 'name').map((group) => group.familyName),
    ['Arial', 'Baskerville', 'Courier'],
  )
  assert.deepEqual(
    sortFamilyGroups(groups, 'installed').map((group) => group.familyName),
    ['Arial', 'Baskerville', 'Courier'],
  )
})

test('sortFamilyGroups by installed date puts newer families first', () => {
  const groups = groupCatalog([
    entry('old', 'Old Style', 1),
    entry('mid', 'Mid Style', 50),
    entry('new', 'New Style', 90),
  ])
  assert.deepEqual(
    sortFamilyGroups(groups, 'installed').map((group) => group.familyName),
    ['New Style', 'Mid Style', 'Old Style'],
  )
})

test('deactivated fonts belong on Fonts, not Uninstalled', () => {
  const deactivated = entry('off', 'Off', 1, 'deactivated')
  const uninstalled = entry('gone', 'Gone', 2, 'uninstalled')
  assert.equal(isLibraryEntry(deactivated), true)
  assert.equal(isInactiveEntry(deactivated), false)
  assert.equal(isLibraryEntry(uninstalled), false)
  assert.equal(isInactiveEntry(uninstalled), true)
})

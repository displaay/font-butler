import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  countLibraryFilters,
  entryHasTrackedSource,
  familyStatusSummary,
  groupCatalog,
  hasTrackedSource,
  isForgettableOnlyGroup,
  isUninstallableGroup,
  matchesLibraryFilter,
  sortFamilyGroups,
} from './group.ts'
import type { CatalogEntry, FontFaceInfo } from './types.ts'

function face(
  familyName: string,
  styleName = 'Regular',
  italic = false,
): FontFaceInfo {
  return {
    familyName,
    styleName,
    fullName: `${familyName} ${styleName}`,
    postscriptName: `${familyName}-${styleName.replace(/\s+/g, '')}`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic,
  }
}

function entry(
  id: string,
  familyName: string,
  addedAt: number,
  status: CatalogEntry['status'] = 'installed',
  styleName = 'Regular',
  italic = false,
): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.otf`,
    sourceMtimeMs: addedAt,
    sourceSize: 1000,
    status,
    faces: [face(familyName, styleName, italic)],
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

test('sortFamilyGroups orders alphabetically or by date added', () => {
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
    sortFamilyGroups(groups, 'added').map((group) => group.familyName),
    ['Arial', 'Baskerville', 'Courier'],
  )
})

test('sortFamilyGroups by date added puts newer families first', () => {
  const groups = groupCatalog([
    entry('old', 'Old Style', 1),
    entry('mid', 'Mid Style', 50),
    entry('new', 'New Style', 90),
  ])
  assert.deepEqual(
    sortFamilyGroups(groups, 'added').map((group) => group.familyName),
    ['New Style', 'Mid Style', 'Old Style'],
  )
})

test('matchesLibraryFilter treats empty as all and maps related statuses', () => {
  const installed = entry('in', 'In', 1, 'installed')
  const outdated = entry('old', 'Old', 2, 'outdated')
  const deactivated = entry('off', 'Off', 3, 'deactivated')
  const uninstalled = entry('gone', 'Gone', 4, 'uninstalled')
  const missing = entry('lost', 'Lost', 5, 'source-missing')
  assert.equal(matchesLibraryFilter(deactivated, []), true)
  assert.equal(matchesLibraryFilter(installed, ['installed']), true)
  assert.equal(matchesLibraryFilter(outdated, ['installed']), true)
  assert.equal(matchesLibraryFilter(deactivated, ['installed']), false)
  assert.equal(matchesLibraryFilter(deactivated, ['deactivated']), true)
  assert.equal(matchesLibraryFilter(uninstalled, ['uninstalled']), true)
  assert.equal(matchesLibraryFilter(missing, ['uninstalled']), true)
  assert.equal(matchesLibraryFilter(installed, ['uninstalled']), false)
  assert.equal(matchesLibraryFilter(outdated, ['installed', 'deactivated']), true)
})

test('countLibraryFilters totals families per filter and can count one family twice', () => {
  const installed = entry('in', 'In', 1, 'installed')
  const vf = entry('vf', 'Variable', 2, 'uninstalled')
  vf.faces[0]!.isVariable = true
  vf.sourcePresent = true
  const bootonOn = entry('br', 'Booton', 3, 'installed')
  const bootonOff = entry('bi', 'Booton', 4, 'uninstalled')
  assert.deepEqual(countLibraryFilters([installed, vf, bootonOn, bootonOff]), {
    installed: 2,
    deactivated: 0,
    uninstalled: 2,
    vf: 1,
    static: 2,
    source: 3,
    'no-source': 0,
  })
})

test('matchesLibraryFilter combines status, kind, and source dimensions', () => {
  const vf = entry('vf', 'Variable', 1, 'installed')
  vf.faces[0]!.isVariable = true
  vf.sourcePresent = true
  const statik = entry('st', 'Static', 2, 'installed')
  statik.installedPath = statik.sourcePath
  statik.sourcePresent = true
  assert.equal(matchesLibraryFilter(vf, ['vf']), true)
  assert.equal(matchesLibraryFilter(statik, ['vf']), false)
  assert.equal(matchesLibraryFilter(statik, ['static']), true)
  assert.equal(matchesLibraryFilter(vf, ['source']), true)
  assert.equal(matchesLibraryFilter(statik, ['source']), false)
  assert.equal(matchesLibraryFilter(statik, ['no-source']), true)
  assert.equal(matchesLibraryFilter(vf, ['installed', 'vf', 'source']), true)
  assert.equal(matchesLibraryFilter(statik, ['installed', 'vf']), false)
  assert.equal(matchesLibraryFilter(vf, ['uninstalled', 'vf']), false)
})

test('Delete uninstalls installed families and forgets the rest', () => {
  assert.equal(isUninstallableGroup({ status: 'deactivated' }), true)
  assert.equal(isUninstallableGroup({ status: 'uninstalled' }), false)
  assert.equal(isForgettableOnlyGroup({ status: 'uninstalled' }), true)
  assert.equal(isForgettableOnlyGroup({ status: 'source-missing' }), true)
  assert.equal(isForgettableOnlyGroup({ status: 'installed' }), false)
})

test('groupCatalog merges installed and uninstalled styles onto one Fonts card', () => {
  const groups = groupCatalog([
    entry('regular', 'Booton', 1, 'installed', 'Regular', false),
    entry('italic', 'Booton', 2, 'uninstalled', 'Italic', true),
  ])
  assert.equal(groups.length, 1)
  const booton = groups[0]
  assert.ok(booton)
  assert.equal(booton.familyName, 'Booton')
  assert.equal(booton.status, 'installed')
  assert.equal(booton.instanceCount, 2)
  assert.equal(familyStatusSummary(booton), '1/2 installed')
  assert.equal(isUninstallableGroup(booton), true)
})

test('entryHasTrackedSource prefers the stored flag and falls back to status', () => {
  const tracked = entry('on', 'On', 1, 'installed')
  tracked.sourcePresent = true
  const installedMissing = entry('off', 'Off', 2, 'installed')
  installedMissing.sourcePresent = false
  const orphan = entry('lost', 'Lost', 3, 'source-missing')
  const adopted = entry('mine', 'Mine', 4, 'installed')
  adopted.installedPath = adopted.sourcePath
  adopted.sourcePresent = true
  const renamed = entry('as', 'As', 5, 'installed')
  renamed.customFamilyName = 'As'
  renamed.sourcePresent = true
  assert.equal(entryHasTrackedSource(tracked), true)
  assert.equal(entryHasTrackedSource(installedMissing), false)
  assert.equal(entryHasTrackedSource(orphan), false)
  assert.equal(entryHasTrackedSource(adopted), false)
  assert.equal(entryHasTrackedSource(renamed), false)
  assert.equal(hasTrackedSource({ entries: [tracked, installedMissing] }), true)
})

test('groupCatalog keeps typographic family styles on one card', () => {
  const groups = groupCatalog([
    entry('regular', 'Booton', 1, 'installed', 'Regular', false),
    entry('italic', 'Booton', 2, 'installed', 'Italic', true),
    entry('el', 'Booton', 3, 'installed', 'ExtraLight', false),
    entry('eli', 'Booton', 4, 'installed', 'ExtraLight Italic', true),
    entry('heavy', 'Booton', 5, 'installed', 'Heavy', false),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.familyName, 'Booton')
  assert.equal(groups[0]?.instanceCount, 5)
  assert.equal(groups[0]?.previewEntryId, 'regular')
})

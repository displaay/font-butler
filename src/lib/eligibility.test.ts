import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  activatableIds,
  deactivatableIds,
  familyHasAction,
  installableIds,
  reinstallableIds,
  uninstallableIds,
} from './eligibility.ts'
import type { CatalogEntry, FamilyGroup, FontFaceInfo } from './types.ts'

function face(familyName: string, styleName = 'Regular'): FontFaceInfo {
  return {
    familyName,
    styleName,
    fullName: `${familyName} ${styleName}`,
    postscriptName: `${familyName}-${styleName}`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function entry(id: string, status: CatalogEntry['status'], styleName = 'Regular'): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.ttf`,
    sourceMtimeMs: 1,
    sourceSize: 1,
    status,
    faces: [face('Mixed', styleName)],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
  }
}

function group(entries: CatalogEntry[]): FamilyGroup {
  return {
    key: 'Mixed',
    familyName: 'Mixed',
    entries,
    faces: entries.flatMap((item) => item.faces),
    isVariable: false,
    instanceCount: entries.length,
    status: entries[0]!.status,
    previewEntryId: entries[0]!.id,
    addedAt: 1,
  }
}

test('family actions use entry-level eligibility for mixed styles', () => {
  const mixed = group([entry('on', 'installed', 'Regular'), entry('off', 'uninstalled', 'Bold')])
  assert.deepEqual(installableIds(mixed), ['off'])
  assert.deepEqual(deactivatableIds(mixed), ['on'])
  assert.deepEqual(activatableIds(mixed), [])
  assert.deepEqual(reinstallableIds(mixed), [])
  assert.deepEqual(uninstallableIds(mixed), ['on'])
  assert.equal(familyHasAction(mixed, 'install'), true)
  assert.equal(familyHasAction(mixed, 'deactivate'), true)
  assert.equal(familyHasAction(mixed, 'reinstall'), false)
})

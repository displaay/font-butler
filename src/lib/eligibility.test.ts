import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  activatableIds,
  adobeInstallableIds,
  deactivatableIds,
  familyHasAction,
  installableIds,
  reinstallableIds,
  repairableIds,
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

test('a collection file is one eligible install/deactivate target', () => {
  const collection = group([
    {
      ...entry('pack', 'installed'),
      format: 'ttc',
      faces: [face('Pack', 'Regular'), face('Pack', 'Bold')],
    },
  ])
  collection.faces = collection.entries[0]!.faces
  collection.instanceCount = 2
  assert.deepEqual(deactivatableIds(collection), ['pack'])
  assert.deepEqual(uninstallableIds(collection), ['pack'])
  assert.deepEqual(installableIds(collection), [])
  assert.equal(familyHasAction(collection, 'deactivate'), true)
})

test('preview-only fonts are excluded from install and update actions', () => {
  const web = group([
    {
      ...entry('web', 'uninstalled'),
      previewOnly: true,
      format: 'woff',
    },
  ])
  assert.deepEqual(installableIds(web), [])
  assert.deepEqual(reinstallableIds(web), [])
  assert.equal(familyHasAction(web, 'install'), false)
})

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

test('an all-uninstalled family is installable and never deactivatable', () => {
  const off = group([entry('light', 'uninstalled', 'Light'), entry('bold', 'uninstalled', 'Bold')])
  assert.deepEqual(installableIds(off), ['light', 'bold'])
  assert.deepEqual(deactivatableIds(off), [])
  assert.deepEqual(uninstallableIds(off), [])
  assert.equal(familyHasAction(off, 'install'), true)
  assert.equal(familyHasAction(off, 'deactivate'), false)
})

test('repair is hidden unless a managed copy is missing', () => {
  const healthy = group([
    {
      ...entry('ok', 'installed'),
      installedPath: '/tmp/ok.ttf',
      previousRevisionId: 'abc',
    },
  ])
  const missing = group([
    {
      ...entry('gone', 'installed'),
      previousRevisionId: 'abc',
    },
  ])
  const adobeGone = group([
    {
      ...entry('adobe', 'installed'),
      installedPath: '/tmp/adobe.ttf',
      installations: [
        { destinationId: 'macos', path: '/tmp/adobe.ttf', verification: 'file-present' },
        { destinationId: 'adobe-shared', path: '/tmp/adobe-dest.ttf', verification: 'unavailable' },
      ],
    },
  ])
  assert.deepEqual(repairableIds(healthy), [])
  assert.deepEqual(repairableIds(missing), ['gone'])
  assert.deepEqual(repairableIds(adobeGone), ['adobe'])
})

test('Adobe install is offered until a testing-folder copy is present', () => {
  const missing = group([entry('plain', 'installed')])
  const placed = group([
    {
      ...entry('placed', 'installed'),
      installations: [
        { destinationId: 'adobe-shared', path: '/tmp/adobe-dest.ttf', verification: 'file-present' },
      ],
    },
  ])
  const unavailable = group([
    {
      ...entry('gone', 'installed'),
      installations: [
        { destinationId: 'adobe-shared', path: '/tmp/adobe-dest.ttf', verification: 'unavailable' },
      ],
    },
  ])
  const web = group([
    {
      ...entry('web', 'uninstalled'),
      previewOnly: true,
      format: 'woff',
    },
  ])
  assert.deepEqual(adobeInstallableIds(missing), ['plain'])
  assert.deepEqual(adobeInstallableIds(placed), [])
  assert.deepEqual(adobeInstallableIds(unavailable), ['gone'])
  assert.deepEqual(adobeInstallableIds(web), [])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  actionLabel,
  catalogBatchPlan,
  catalogBatchSummary,
  familyCardPlan,
  hasCatalogBatchActions,
  hasSystemBatchActions,
  systemBatchPlan,
  systemBatchSummary,
} from './batch.ts'
import { displayStateParts, isNotInstalledLabel } from './state.ts'
import { groupCatalog, groupSystem, familyBadgeEntry } from './group.ts'
import type { CatalogEntry, FontFaceInfo, SystemFace } from './types.ts'

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
  status: CatalogEntry['status'],
): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.otf`,
    sourceMtimeMs: 1,
    sourceSize: 1000,
    status,
    faces: [face(familyName)],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
  }
}

function systemFace(familyName: string, writable: boolean): SystemFace {
  return {
    path: `/Library/Fonts/${familyName}.otf`,
    familyName,
    styleName: 'Regular',
    fullName: `${familyName} Regular`,
    postscriptName: `${familyName}-Regular`,
    isVariable: false,
    instanceCount: 1,
    format: 'otf',
    protected: !writable,
    writable,
  }
}

test('catalogBatchPlan uses entry-level eligibility for a mixed family', () => {
  const groups = groupCatalog([
    entry('on', 'Mixed', 'installed'),
    entry('off', 'Mixed', 'uninstalled'),
  ])
  assert.deepEqual(catalogBatchPlan(groups), {
    count: 1,
    install: 1,
    installMissing: true,
    adobeInstall: 2,
    activate: 0,
    deactivate: 1,
    uninstall: 1,
    uninstallAndRemove: 1,
    reinstall: 0,
    repair: 0,
    forget: 1,
    deleteFiles: 1,
  })
})

test('familyCardPlan keeps honest mixed actions when the family is partly installed', () => {
  const groups = groupCatalog([
    entry('light', 'Gellix', 'uninstalled'),
    entry('bold', 'Gellix', 'installed'),
  ])
  const gellix = groups[0]!
  const plan = familyCardPlan(gellix)
  assert.equal(gellix.previewEntryId, 'light')
  assert.equal(displayStateParts(gellix.entries[0]!).includes('Not installed'), true)
  assert.equal(displayStateParts(familyBadgeEntry(gellix)).includes('Not installed'), false)
  assert.equal(plan.install, 1)
  assert.equal(plan.installMissing, true)
  assert.equal(plan.deactivate, 1)
})

test('familyCardPlan never offers Deactivate on a not-installed family card', () => {
  const groups = groupCatalog([
    entry('light', 'Gellix', 'uninstalled'),
    entry('bold', 'Gellix', 'uninstalled'),
  ])
  const gellix = groups[0]!
  const plan = familyCardPlan(gellix)
  assert.equal(isNotInstalledLabel(familyBadgeEntry(gellix)), true)
  assert.equal(plan.install, 2)
  assert.equal(plan.deactivate, 0)
  assert.equal(plan.uninstall, 0)
  assert.equal(plan.activate, 0)
  assert.equal(plan.reinstall, 0)
})

test('familyCardPlan still deactivates an installed family', () => {
  const groups = groupCatalog([entry('a', 'Able', 'installed')])
  const plan = familyCardPlan(groups[0]!)
  assert.equal(plan.install, 0)
  assert.equal(plan.deactivate, 1)
})

test('catalogBatchPlan counts each action by family status', () => {
  const groups = groupCatalog([
    entry('a', 'Able', 'uninstalled'),
    entry('b', 'Baker', 'deactivated'),
    entry('c', 'Cage', 'installed'),
    entry('d', 'Dada', 'outdated'),
    entry('e', 'Echo', 'source-missing'),
  ])
  assert.deepEqual(catalogBatchPlan(groups), {
    count: 5,
    install: 1,
    installMissing: false,
    adobeInstall: 5,
    activate: 1,
    deactivate: 2,
    uninstall: 3,
    uninstallAndRemove: 3,
    reinstall: 1,
    repair: 0,
    forget: 2,
    deleteFiles: 1,
  })
})

test('catalogBatchSummary lists mixed statuses', () => {
  const groups = groupCatalog([
    entry('a', 'Able', 'installed'),
    entry('b', 'Baker', 'uninstalled'),
    entry('c', 'Cage', 'uninstalled'),
  ])
  assert.equal(catalogBatchSummary(groups), '1 installed · 2 uninstalled')
})

test('systemBatchPlan only counts writable families', () => {
  const groups = groupSystem([
    systemFace('Helvetica', false),
    systemFace('Inter', true),
    systemFace('Recoleta', true),
  ])
  assert.deepEqual(systemBatchPlan(groups), {
    count: 3,
    deactivate: 2,
    uninstall: 2,
  })
  assert.equal(systemBatchSummary(groups), '2 removable · 1 system')
  assert.equal(hasSystemBatchActions(systemBatchPlan(groups)), true)
  assert.equal(hasSystemBatchActions(systemBatchPlan(groups.slice(0, 1))), false)
})

test('hasCatalogBatchActions is false for an empty selection', () => {
  assert.equal(hasCatalogBatchActions(catalogBatchPlan([])), false)
})

test('catalogBatchPlan counts Adobe installs only when a copy is not present', () => {
  const groups = groupCatalog([
    {
      ...entry('a', 'Able', 'installed'),
      installations: [
        { destinationId: 'adobe-shared', path: '/tmp/able-adobe.otf', verification: 'file-present' },
      ],
    },
    entry('b', 'Baker', 'installed'),
  ])
  const plan = catalogBatchPlan(groups)
  assert.equal(plan.adobeInstall, 1)
  assert.equal(hasCatalogBatchActions(plan), true)
})

test('actionLabel adds a count for multi-select', () => {
  assert.equal(actionLabel('Install', 1, false), 'Install')
  assert.equal(actionLabel('Install', 1, true), 'Install 1 font')
  assert.equal(actionLabel('Uninstall', 4, true), 'Uninstall 4 fonts')
  assert.equal(actionLabel('Install update', 1, false), 'Install update')
  assert.equal(actionLabel('Install update', 2, true), 'Install 2 updates')
  assert.equal(actionLabel('Install missing', 3, true), 'Install 3 missing styles')
  assert.equal(actionLabel('Deactivate', 2, true), 'Deactivate 2 styles')
  assert.equal(actionLabel('Install to Adobe testing folder', 1, false), 'Install to Adobe testing folder')
  assert.equal(actionLabel('Install to Adobe testing folder', 3, true), 'Install 3 to Adobe testing folder')
})

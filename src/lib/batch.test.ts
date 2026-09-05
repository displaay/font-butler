import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  actionLabel,
  catalogBatchPlan,
  catalogBatchSummary,
  hasCatalogBatchActions,
  hasSystemBatchActions,
  systemBatchPlan,
  systemBatchSummary,
} from './batch.ts'
import { groupCatalog, groupSystem } from './group.ts'
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
    activate: 1,
    deactivate: 2,
    uninstall: 3,
    uninstallAndRemove: 3,
    reinstall: 1,
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

test('actionLabel adds a count for multi-select', () => {
  assert.equal(actionLabel('Install', 1, false), 'Install')
  assert.equal(actionLabel('Install', 1, true), 'Install 1 font')
  assert.equal(actionLabel('Uninstall', 4, true), 'Uninstall 4 fonts')
})

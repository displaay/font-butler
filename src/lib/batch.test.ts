import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  actionLabel,
  activateActionLabel,
  deactivateActionLabel,
  catalogBatchPlan,
  catalogBatchSummary,
  catalogBatchSummaryParts,
  catalogKeysForStatus,
  deleteSourcesLabel,
  familyCardPlan,
  forgetSourcesLabel,
  hasCatalogBatchActions,
  hasSystemBatchActions,
  installActionLabel,
  systemBatchPlan,
  systemBatchSummary,
  systemBatchSummaryParts,
  systemKeysForKind,
} from './batch.ts'
import { displayStateParts, isNotInstalledLabel } from './state.ts'
import { groupCatalog, groupSystem, familyBadgeEntry, familyStatusSummary } from './group.ts'
import type { CatalogEntry, FontFaceInfo, SystemFace } from './types.ts'

function face(familyName: string, styleName = 'Regular'): FontFaceInfo {
  return {
    familyName,
    styleName,
    fullName: `${familyName} ${styleName}`,
    postscriptName: `${familyName}-${styleName.replace(/\s+/g, '')}`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: /italic/i.test(styleName),
  }
}

function entry(
  id: string,
  familyName: string,
  status: CatalogEntry['status'],
  styleName = 'Regular',
): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.otf`,
    sourceMtimeMs: 1,
    sourceSize: 1000,
    status,
    faces: [face(familyName, styleName)],
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
    entry('on', 'Mixed', 'installed', 'Regular'),
    entry('off', 'Mixed', 'uninstalled', 'Bold'),
  ])
  assert.deepEqual(catalogBatchPlan(groups), {
    count: 1,
    install: 1,
    installFonts: 1,
    installMissing: true,
    adobeInstall: 2,
    adobeUninstall: 0,
    activate: 0,
    partialActiveStyles: 1,
    deactivate: 1,
    uninstall: 1,
    uninstallAndRemove: 1,
    reinstall: 0,
    repair: 0,
    forget: 0,
    deleteFiles: 1,
  })
})

test('familyCardPlan keeps honest mixed actions when the family is partly installed', () => {
  const groups = groupCatalog([
    entry('light', 'Gellix', 'uninstalled', 'Light'),
    entry('bold', 'Gellix', 'installed', 'Bold'),
  ])
  const gellix = groups[0]!
  const plan = familyCardPlan(gellix)
  assert.equal(gellix.previewEntryId, 'light')
  assert.equal(displayStateParts(gellix.entries[0]!).includes('Not installed'), true)
  assert.equal(displayStateParts(familyBadgeEntry(gellix)).includes('Not installed'), false)
  assert.equal(plan.install, 1)
  assert.equal(plan.installMissing, true)
  assert.equal(plan.deactivate, 1)
  assert.equal(plan.partialActiveStyles, 1)
  assert.equal(deactivateActionLabel(plan), 'Deactivate 1 style')
  assert.equal(plan.forget, 0)
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
  assert.equal(plan.uninstallAndRemove, 0)
  assert.equal(plan.activate, 0)
  assert.equal(plan.reinstall, 0)
})

test('catalogBatchPlan does not uninstall-and-delete a not-installed family', () => {
  const groups = groupCatalog([
    entry('light', 'Jokker', 'uninstalled', 'Light'),
    entry('bold', 'Jokker', 'uninstalled', 'Bold'),
  ])
  const plan = catalogBatchPlan(groups)
  assert.equal(isNotInstalledLabel(familyBadgeEntry(groups[0]!)), true)
  assert.equal(plan.uninstall, 0)
  assert.equal(plan.uninstallAndRemove, 0)
  assert.equal(plan.deleteFiles, 1)
  assert.equal(plan.forget, 1)
  assert.equal(plan.install > 0, true)
})

test('familyCardPlan still deactivates an installed family', () => {
  const groups = groupCatalog([entry('a', 'Able', 'installed')])
  const plan = familyCardPlan(groups[0]!)
  assert.equal(plan.install, 0)
  assert.equal(plan.deactivate, 1)
  assert.equal(deactivateActionLabel(plan), 'Deactivate')
})

test('catalogBatchPlan keeps only actions every selected family can take', () => {
  const groups = groupCatalog([
    entry('a', 'Able', 'uninstalled'),
    entry('b', 'Baker', 'deactivated'),
    entry('c', 'Cage', 'installed'),
    entry('d', 'Dada', 'outdated'),
    entry('e', 'Echo', 'source-missing'),
  ])
  assert.deepEqual(catalogBatchPlan(groups), {
    count: 5,
    install: 0,
    installFonts: 0,
    installMissing: false,
    adobeInstall: 5,
    adobeUninstall: 0,
    activate: 0,
    deactivate: 0,
    uninstall: 0,
    uninstallAndRemove: 0,
    reinstall: 0,
    repair: 0,
    forget: 0,
    deleteFiles: 0,
  })
})

test('catalogBatchPlan hides subset actions on a mixed installed/deactivated/uninstalled selection', () => {
  const groups = groupCatalog([
    entry('a', 'Able', 'installed'),
    entry('b', 'Baker', 'installed'),
    entry('c', 'Cage', 'deactivated'),
    entry('d', 'Dada', 'deactivated'),
    entry('e', 'Echo', 'uninstalled'),
    entry('f', 'Fenul', 'uninstalled'),
    entry('g', 'Gellix', 'uninstalled'),
    entry('h', 'Hatch', 'uninstalled'),
  ])
  const plan = catalogBatchPlan(groups)
  assert.equal(plan.count, 8)
  assert.equal(plan.install, 0)
  assert.equal(plan.activate, 0)
  assert.equal(plan.deactivate, 0)
  assert.equal(plan.uninstall, 0)
  assert.equal(plan.repair, 0)
  assert.equal(plan.forget, 0)
})

test('catalogBatchPlan counts installs across matching families', () => {
  const groups = groupCatalog([
    entry('a', 'Able', 'uninstalled'),
    entry('b', 'Baker', 'uninstalled', 'Bold'),
  ])
  const plan = catalogBatchPlan(groups)
  assert.equal(plan.install, 2)
  assert.equal(plan.installFonts, 2)
  assert.equal(plan.forget, 2)
  assert.equal(plan.deactivate, 0)
  assert.equal(plan.uninstall, 0)
})

test('catalogBatchSummary lists mixed statuses', () => {
  const groups = groupCatalog([
    entry('a', 'Able', 'installed'),
    entry('b', 'Baker', 'uninstalled'),
    entry('c', 'Cage', 'uninstalled'),
  ])
  assert.equal(catalogBatchSummary(groups), '1 installed · 2 uninstalled')
  assert.deepEqual(catalogBatchSummaryParts(groups), [
    { status: 'installed', count: 1, label: 'installed' },
    { status: 'uninstalled', count: 2, label: 'uninstalled' },
  ])
  assert.deepEqual(catalogKeysForStatus(groups, 'uninstalled'), ['Baker', 'Cage'])
  assert.deepEqual(catalogKeysForStatus(groups, 'deactivated'), [])
})

test('systemBatchPlan only counts writable families', () => {
  const groups = groupSystem([
    systemFace('Helvetica', false),
    systemFace('Inter', true),
    systemFace('Recoleta', true),
  ])
  assert.deepEqual(systemBatchPlan(groups), {
    count: 3,
    deactivate: 0,
    uninstall: 0,
  })
  assert.equal(systemBatchSummary(groups), '2 removable · 1 system')
  assert.deepEqual(systemBatchSummaryParts(groups), [
    { kind: 'removable', count: 2, label: 'removable' },
    { kind: 'system', count: 1, label: 'system' },
  ])
  assert.deepEqual(systemKeysForKind(groups, 'removable'), ['Inter', 'Recoleta'])
  assert.deepEqual(systemKeysForKind(groups, 'system'), ['Helvetica'])
  assert.equal(hasSystemBatchActions(systemBatchPlan(groups)), false)
  assert.equal(hasSystemBatchActions(systemBatchPlan(groups.slice(0, 1))), false)
  assert.equal(hasSystemBatchActions(systemBatchPlan(groups.slice(1))), true)
})

test('catalogBatchPlan does not count an alt-format copy as missing styles', () => {
  const live = entry('otf', 'Fenul', 'installed')
  const kept = {
    ...entry('ttf', 'Fenul', 'uninstalled'),
    format: 'ttf' as const,
    sourcePath: '/tmp/ttf.ttf',
  }
  const plan = catalogBatchPlan(groupCatalog([live, kept]))
  assert.equal(plan.install, 0)
  assert.equal(plan.installMissing, false)
  assert.equal(plan.adobeInstall, 1)
  assert.equal(plan.forget, 0)
})

test('catalogBatchPlan does not count a parked alt-format copy as missing styles', () => {
  const parked = {
    ...entry('otf', 'Fenul', 'deactivated'),
    format: 'otf' as const,
    sourcePath: '/tmp/otf.otf',
  }
  const kept = {
    ...entry('ttf', 'Fenul', 'uninstalled'),
    format: 'ttf' as const,
    sourcePath: '/tmp/ttf.ttf',
  }
  const plan = catalogBatchPlan(groupCatalog([parked, kept]))
  assert.equal(plan.install, 0)
  assert.equal(plan.installMissing, false)
  assert.equal(plan.activate, 1)
  assert.equal(plan.activateFormat, 'otf')
  assert.equal(activateActionLabel(plan), 'Activate OTF')
  assert.equal(deactivateActionLabel(plan), 'Deactivate')
})

test('partial family context labels say remaining and count active styles', () => {
  const live = entry('otf-reg', 'Fenul', 'installed', 'Regular')
  const parked = {
    ...entry('otf-bold', 'Fenul', 'deactivated', 'Bold'),
    format: 'otf' as const,
    sourcePath: '/tmp/otf-bold.otf',
  }
  const keptRegular = {
    ...entry('ttf-reg', 'Fenul', 'uninstalled', 'Regular'),
    format: 'ttf' as const,
    sourcePath: '/tmp/ttf-reg.ttf',
  }
  const keptBold = {
    ...entry('ttf-bold', 'Fenul', 'uninstalled', 'Bold'),
    format: 'ttf' as const,
    sourcePath: '/tmp/ttf-bold.ttf',
  }
  const plan = familyCardPlan(groupCatalog([live, parked, keptRegular, keptBold])[0]!)
  assert.equal(plan.partialActiveStyles, 1)
  assert.equal(plan.activateFormat, 'otf')
  assert.equal(activateActionLabel(plan), 'Activate remaining OTF')
  assert.equal(deactivateActionLabel(plan), 'Deactivate 1 style')

  const threeLive = ['Light', 'Regular', 'Bold'].map((style, index) =>
    entry(`live-${index}`, 'Reckless', 'installed', style),
  )
  const remaining = Array.from({ length: 21 }, (_, index) =>
    entry(`parked-${index}`, 'Reckless', 'deactivated', `Style${index}`),
  )
  const recklessGroup = groupCatalog([...threeLive, ...remaining])[0]!
  const reckless = familyCardPlan(recklessGroup)
  assert.equal(familyStatusSummary(recklessGroup), '3 of 24 styles active')
  assert.equal(reckless.partialActiveStyles, 3)
  assert.equal(reckless.activateFormat, 'otf')
  assert.equal(activateActionLabel(reckless), 'Activate remaining OTF')
  assert.equal(deactivateActionLabel(reckless), 'Deactivate 3 styles')
  assert.equal(activateActionLabel(reckless, true), 'Activate OTF')
  assert.equal(deactivateActionLabel(reckless, true), 'Deactivate')
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
  assert.equal(plan.adobeInstall, 0)
  assert.equal(hasCatalogBatchActions(plan), true)
  assert.equal(catalogBatchPlan(groups, false).adobeInstall, 0)
})

test('catalogBatchPlan counts Activate by family, not files', () => {
  const groups = groupCatalog([
    entry('a-reg', 'Able', 'deactivated', 'Regular'),
    entry('a-bold', 'Able', 'deactivated', 'Bold'),
    entry('a-black', 'Able', 'deactivated', 'Black'),
    entry('b', 'Baker', 'deactivated'),
    entry('c', 'Cage', 'installed'),
  ])
  const plan = catalogBatchPlan(groups)
  assert.equal(plan.count, 3)
  assert.equal(plan.activate, 0)
  assert.equal(plan.uninstall > 0, true)
})

test('catalogBatchPlan counts Adobe uninstalls only when a Mac copy would remain', () => {
  const both = {
    ...entry('a', 'Able', 'installed'),
    installedPath: '/Library/Fonts/Able.otf',
    installations: [
      { destinationId: 'macos' as const, path: '/Library/Fonts/Able.otf', verification: 'file-present' as const },
      { destinationId: 'adobe-shared' as const, path: '/tmp/able-adobe.otf', verification: 'file-present' as const },
    ],
  }
  const adobeOnly = {
    ...entry('b', 'Baker', 'installed'),
    installations: [
      { destinationId: 'adobe-shared' as const, path: '/tmp/baker-adobe.otf', verification: 'file-present' as const },
    ],
  }
  assert.equal(catalogBatchPlan(groupCatalog([both])).adobeUninstall, 1)
  assert.equal(catalogBatchPlan(groupCatalog([adobeOnly])).adobeUninstall, 0)
})

test('Install label counts families, not styles', () => {
  const groups = groupCatalog([
    entry('a1', 'Able', 'uninstalled', 'Regular'),
    entry('a2', 'Able', 'uninstalled', 'Bold'),
    entry('a3', 'Able', 'uninstalled', 'Light'),
    entry('b1', 'Baker', 'uninstalled', 'Regular'),
    entry('b2', 'Baker', 'uninstalled', 'Italic'),
  ])
  const plan = catalogBatchPlan(groups)
  assert.equal(plan.count, 2)
  assert.equal(plan.install, 5)
  assert.equal(plan.installFonts, 2)
  assert.equal(installActionLabel(plan, true), 'Install 2 fonts')
  assert.equal(installActionLabel(plan, false), 'Install 2 fonts')
})

test('actionLabel adds a count for multi-select', () => {
  assert.equal(actionLabel('Install', 1, false), 'Install')
  assert.equal(actionLabel('Install', 1, true), 'Install 1 font')
  assert.equal(actionLabel('Uninstall', 4, true), 'Uninstall')
  assert.equal(actionLabel('Uninstall', 1, false), 'Uninstall')
  assert.equal(actionLabel('Install update', 1, false), 'Install update')
  assert.equal(actionLabel('Install update', 2, true), 'Install 2 updates')
  assert.equal(actionLabel('Install missing', 3, true), 'Install 3 missing styles')
  assert.equal(actionLabel('Deactivate', 2, true), 'Deactivate')
  assert.equal(actionLabel('Deactivate', 1, false), 'Deactivate')
  assert.equal(activateActionLabel({ activate: 1 }), 'Activate')
  assert.equal(activateActionLabel({ activate: 12 }, true), 'Activate 12 fonts')
  assert.equal(activateActionLabel({ activate: 1, activateFormat: 'otf' }), 'Activate OTF')
  assert.equal(actionLabel('Install to Adobe folder', 1, false), 'Install to Adobe folder')
  assert.equal(actionLabel('Install to Adobe folder', 3, true), 'Install to Adobe folder')
  assert.equal(actionLabel('Uninstall from Adobe folder', 1, false), 'Uninstall from Adobe folder')
  assert.equal(actionLabel('Uninstall and delete sources', 1, false), 'Uninstall and delete sources')
  assert.equal(
    actionLabel('Uninstall and delete sources', 2, true),
    'Uninstall and delete sources of 2 fonts',
  )
  assert.equal(forgetSourcesLabel(1, false), 'Remove from list')
  assert.equal(forgetSourcesLabel(1, true), 'Remove 1 source from list')
  assert.equal(forgetSourcesLabel(3, true), 'Remove 3 sources from list')
  assert.equal(deleteSourcesLabel(1, false), 'Delete source files')
  assert.equal(deleteSourcesLabel(1, true), 'Delete 1 source file')
  assert.equal(deleteSourcesLabel(2, true), 'Delete 2 source files')
})

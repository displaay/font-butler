import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  catalogRevealEntry,
  catalogEntriesMatch,
  catalogPatchFromResult,
  mergeCatalogEntries,
  countFamilyNames,
  countLibraryFilters,
  entryHasPreviewFile,
  entryHasTrackedSource,
  familyBadgeEntry,
  familyStatusSummary,
  forgettableIds,
  groupCatalog,
  hasManagedInstall,
  hasRetailSyncedSource,
  hasTrackedSource,
  isForgettableOnlyGroup,
  isUninstallableGroup,
  matchesLibraryFilter,
  retailFamiliesToOptOut,
  sortFamilyGroups,
  uniquePaths,
} from './group.ts'
import { displayStateParts } from './state.ts'
import type { CatalogEntry, FontFaceInfo, SystemFace } from './types.ts'

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
  installed.installations = [
    { destinationId: 'macos', path: '/tmp/Fonts/In.otf', verification: 'file-present' },
  ]
  const vf = entry('vf', 'Variable', 2, 'uninstalled')
  vf.faces[0]!.isVariable = true
  vf.sourcePresent = true
  const bootonOn = entry('br', 'Booton', 3, 'installed')
  bootonOn.installations = [
    { destinationId: 'macos', path: '/tmp/Fonts/Booton.otf', verification: 'file-present' },
  ]
  const bootonOff = entry('bi', 'Booton', 4, 'uninstalled')
  assert.deepEqual(countLibraryFilters([installed, vf, bootonOn, bootonOff]), {
    installed: 2,
    deactivated: 0,
    uninstalled: 2,
    vf: 1,
    static: 2,
    source: 3,
    'no-source': 0,
    computer: 2,
    adobe: 0,
    'no-destination': 2,
    otf: 3,
    ttf: 0,
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

test('matchesLibraryFilter filters destination and format independently', () => {
  const mac = entry('mac', 'Able', 1, 'installed')
  mac.installedPath = mac.sourcePath
  const adobe = {
    ...entry('adb', 'Baker', 2, 'installed'),
    installations: [
      {
        destinationId: 'adobe-shared' as const,
        path: '/tmp/baker-adobe.otf',
        verification: 'file-present' as const,
      },
    ],
  }
  const nowhere = entry('off', 'Cage', 3, 'uninstalled')
  const ttf = { ...entry('tt', 'Dada', 4, 'installed'), format: 'ttf' as const, sourcePath: '/tmp/tt.ttf' }
  assert.equal(matchesLibraryFilter(mac, ['computer']), true)
  assert.equal(matchesLibraryFilter(mac, ['adobe']), false)
  assert.equal(matchesLibraryFilter(mac, ['no-destination']), false)
  assert.equal(matchesLibraryFilter(adobe, ['adobe']), true)
  assert.equal(matchesLibraryFilter(adobe, ['computer']), false)
  assert.equal(matchesLibraryFilter(nowhere, ['no-destination']), true)
  assert.equal(matchesLibraryFilter(nowhere, ['computer']), false)
  assert.equal(matchesLibraryFilter(mac, ['otf']), true)
  assert.equal(matchesLibraryFilter(ttf, ['ttf']), true)
  assert.equal(matchesLibraryFilter(ttf, ['otf']), false)
  assert.equal(matchesLibraryFilter(mac, ['computer', 'otf']), true)
  assert.equal(matchesLibraryFilter(ttf, ['adobe', 'ttf']), false)
  assert.equal(matchesLibraryFilter(nowhere, ['no-destination', 'otf']), true)
})

test('Delete uninstalls installed families and forgets the rest', () => {
  assert.equal(isUninstallableGroup({ status: 'deactivated' }), true)
  assert.equal(isUninstallableGroup({ status: 'uninstalled' }), false)
  assert.equal(isForgettableOnlyGroup({ status: 'uninstalled' }), true)
  assert.equal(isForgettableOnlyGroup({ status: 'source-missing' }), true)
  assert.equal(isForgettableOnlyGroup({ status: 'installed' }), false)
})

test('Displaay retail listings cannot be forgotten', () => {
  const retail = {
    ...entry('retail', 'Reckless', 1, 'uninstalled'),
    retailRelativePath: 'Reckless/RecklessVF.otf',
    retailFamilyName: 'Reckless',
  }
  const active = { enabled: true as const, fonts: [{ familyName: 'Reckless', enabled: true }], disabledGlyphsFiles: [] }
  assert.deepEqual(forgettableIds({ entries: [retail] }), [])
  assert.equal(isForgettableOnlyGroup({ status: 'uninstalled', entries: [retail] }), false)
  assert.equal(entryHasTrackedSource(retail), false)
  assert.equal(hasRetailSyncedSource({ entries: [retail] }), false)
  assert.equal(hasRetailSyncedSource({ entries: [retail] }, active), true)
  assert.equal(hasTrackedSource({ entries: [retail] }), false)
  assert.deepEqual(retailFamiliesToOptOut([retail]), [])
  assert.deepEqual(retailFamiliesToOptOut([retail], active), ['Reckless'])
  assert.deepEqual(
    retailFamiliesToOptOut([retail], { enabled: true, fonts: [{ familyName: 'Reckless', enabled: false }], disabledGlyphsFiles: ['Reckless'] }),
    [],
  )
  assert.deepEqual(
    retailFamiliesToOptOut([retail], { enabled: false, fonts: [{ familyName: 'Reckless', enabled: true }], disabledGlyphsFiles: [] }),
    [],
  )
  assert.deepEqual(
    retailFamiliesToOptOut([retail], { enabled: true, fonts: [], disabledGlyphsFiles: [] }),
    [],
  )
  assert.deepEqual(retailFamiliesToOptOut([entry('local', 'Reckless', 1)], active), [])
})

test('groupCatalog prefers an entry with preview bytes over a file-less retail stub', () => {
  const stub = {
    ...entry('stub', 'Reckless', 1, 'uninstalled', 'Regular'),
    sourcePath: '',
    sourcePresent: false,
    retailRelativePath: 'Reckless/Reckless-Regular.otf',
    retailFamilyName: 'Reckless',
  }
  const installed = {
    ...entry('on', 'Reckless', 2, 'installed', 'Bold'),
    installedPath: '/Library/Fonts/Reckless-Bold.otf',
    installations: [
      {
        destinationId: 'macos' as const,
        path: '/Library/Fonts/Reckless-Bold.otf',
        verification: 'file-present' as const,
      },
    ],
  }
  assert.equal(entryHasPreviewFile(stub), false)
  assert.equal(entryHasPreviewFile(installed), true)
  const stale = {
    ...entry('stale', 'Reckless', 1, 'uninstalled', 'Regular'),
    sourcePath: '',
    sourcePresent: false,
    installedPath: '/Library/Fonts/Reckless-Regular.otf',
    installations: [
      {
        destinationId: 'macos' as const,
        path: '/Library/Fonts/Reckless-Regular.otf',
        verification: 'unavailable' as const,
      },
    ],
    retailRelativePath: 'Reckless/Reckless-Regular.otf',
    retailFamilyName: 'Reckless',
  }
  assert.equal(entryHasPreviewFile(stale), false)
  const groups = groupCatalog([stub, stale, installed])
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.previewEntryId, 'on')
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
  assert.equal(familyStatusSummary(booton), '1 of 2 styles active')
  assert.equal(isUninstallableGroup(booton), true)
})

test('familyBadgeEntry follows family status, not an uninstalled preview face', () => {
  const groups = groupCatalog([
    entry('light', 'Gellix', 1, 'uninstalled', 'Light', false),
    entry('bold', 'Gellix', 2, 'installed', 'Bold', false),
  ])
  const gellix = groups[0]
  assert.ok(gellix)
  assert.equal(gellix.previewEntryId, 'light')
  assert.equal(gellix.status, 'installed')
  assert.equal(familyBadgeEntry(gellix).id, 'bold')
  assert.equal(familyStatusSummary(gellix), '1 of 2 styles active')
  assert.equal(displayStateParts(familyBadgeEntry(gellix)).includes('Not installed'), false)
  assert.equal(displayStateParts(gellix.entries[0]!).includes('Not installed'), true)
})

test('familyBadgeEntry stays on the preview when the family is not installed', () => {
  const groups = groupCatalog([
    entry('light', 'Gellix', 1, 'uninstalled', 'Light', false),
    entry('bold', 'Gellix', 2, 'uninstalled', 'Bold', false),
  ])
  const gellix = groups[0]
  assert.ok(gellix)
  assert.equal(gellix.status, 'uninstalled')
  assert.equal(familyBadgeEntry(gellix).id, 'light')
  assert.equal(familyStatusSummary(gellix), null)
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

test('uniquePaths dedupes system face paths in first-seen order', () => {
  const faces = (paths: string[]) => paths.map((path) => ({ path }) as SystemFace)
  assert.deepEqual(uniquePaths(faces(['/A.otf', '/B.otf', '/A.otf'])), ['/A.otf', '/B.otf'])
})

test('catalogRevealEntry prefers selected install, else any install or tracked source', () => {
  const installed = entry('in', 'Booton', 1, 'installed')
  installed.installedPath = '/Library/Fonts/Booton.otf'
  const parked = entry('off', 'Booton', 2, 'deactivated')
  parked.disabledPath = '/Library/Fonts/Booton-Italic.otf'
  const sourceOnly = entry('src', 'Booton', 3, 'uninstalled')
  sourceOnly.sourcePresent = true
  const adobeOnly = entry('adobe', 'Booton', 4, 'installed')
  adobeOnly.installedPath = undefined
  adobeOnly.installations = [{
    destinationId: 'adobe-shared',
    path: '/Library/Application Support/Adobe/Fonts/Booton.otf',
    verification: 'file-present',
  }]
  const selfSourced = entry('self', 'Booton', 5, 'installed')
  selfSourced.installedPath = selfSourced.sourcePath
  const group = groupCatalog([sourceOnly, installed, parked, adobeOnly, selfSourced])[0]!
  assert.equal(catalogRevealEntry(group, parked, 'installed')?.id, 'off')
  assert.equal(catalogRevealEntry(group, sourceOnly, 'installed')?.id, 'in')
  assert.equal(catalogRevealEntry(group, adobeOnly, 'installed')?.id, 'adobe')
  assert.equal(catalogRevealEntry(group, sourceOnly, 'source')?.id, 'src')
  assert.equal(catalogRevealEntry(group, selfSourced, 'source')?.id, 'src')
})

test('Show in Finder is enabled for an Adobe-only row and targets it', () => {
  const adobeOnly = entry('adobe', 'Booton', 1, 'installed')
  adobeOnly.installedPath = undefined
  adobeOnly.installations = [{
    destinationId: 'adobe-shared',
    path: '/Library/Application Support/Adobe/Fonts/Booton.otf',
    verification: 'file-present',
  }]
  const sourceOnly = entry('src', 'Booton', 2, 'uninstalled')
  sourceOnly.installedPath = undefined
  assert.equal(hasManagedInstall(adobeOnly), true)
  assert.equal(hasManagedInstall(sourceOnly), false)
  const group = groupCatalog([adobeOnly])[0]!
  assert.equal(group.entries.some(hasManagedInstall), true)
  assert.equal(catalogRevealEntry(group, undefined, 'installed')?.id, 'adobe')
})

test('groupCatalog keeps retail VF families on their own cards', () => {
  const roman = entry('roman', 'Aguzzo', 1)
  roman.retailRelativePath = 'Aguzzo/Aguzzo-Regular.otf'
  roman.retailFamilyName = 'Aguzzo'
  const vf = entry('vf', 'Aguzzo', 2)
  vf.retailRelativePath = 'Aguzzo/AguzzoVF.ttf'
  vf.retailFamilyName = 'Aguzzo VF'
  vf.faces[0]!.isVariable = true
  const italicVf = entry('italic-vf', 'Aguzzo Italic', 3)
  italicVf.retailRelativePath = 'Aguzzo Italic/AguzzoItalicVF.ttf'
  italicVf.retailFamilyName = 'Aguzzo Italic VF'
  italicVf.faces[0]!.isVariable = true
  const groups = groupCatalog([roman, vf, italicVf])
  assert.deepEqual(
    groups.map((group) => group.familyName).sort(),
    ['Aguzzo', 'Aguzzo Italic VF', 'Aguzzo VF'],
  )
  assert.equal(groups.find((group) => group.familyName === 'Aguzzo VF')?.entries[0]?.id, 'vf')
  assert.equal(groups.find((group) => group.familyName === 'Aguzzo Italic VF')?.entries[0]?.id, 'italic-vf')
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

test('groupCatalog counts OTF and TTF copies of the same styles once', () => {
  const otfRegular = entry('otf-r', 'Fenul', 1, 'installed', 'Regular')
  const ttfRegular = entry('ttf-r', 'Fenul', 2, 'uninstalled', 'Regular')
  ttfRegular.format = 'ttf'
  ttfRegular.sourcePath = '/tmp/ttf-r.ttf'
  const otfItalic = entry('otf-i', 'Fenul', 3, 'installed', 'Italic', true)
  const ttfItalic = entry('ttf-i', 'Fenul', 4, 'uninstalled', 'Italic', true)
  ttfItalic.format = 'ttf'
  ttfItalic.sourcePath = '/tmp/ttf-i.ttf'
  const groups = groupCatalog([otfRegular, ttfRegular, otfItalic, ttfItalic])
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.instanceCount, 2)
  assert.equal(familyStatusSummary(groups[0]!), null)
})

test('countFamilyNames matches groupCatalog length', () => {
  const entries = [entry('old', 'Zed', 10), entry('new', 'Zed', 50), entry('solo', 'Able', 20)]
  assert.equal(countFamilyNames(entries), groupCatalog(entries).length)
})

test('catalogEntriesMatch treats Adobe copies and parked paths as catalog changes', () => {
  const a = [entry('a', 'Able', 1)]
  const parked = [{ ...a[0]!, disabledPath: '/tmp/parked.otf' }]
  assert.equal(catalogEntriesMatch(a, parked), false)
  const adobe = [
    {
      ...a[0]!,
      installations: [{ destinationId: 'adobe-shared' as const, path: '/tmp/adobe.otf', verification: 'file-present' as const }],
    },
  ]
  assert.equal(catalogEntriesMatch(a, adobe), false)
})

test('catalogPatchFromResult merges single entries and batch payloads', () => {
  const installed = entry('a', 'Able', 1)
  assert.deepEqual(catalogPatchFromResult(installed).map((item) => item.id), ['a'])
  assert.deepEqual(catalogPatchFromResult({ entries: [installed] }).map((item) => item.id), ['a'])
  assert.deepEqual(catalogPatchFromResult({ ok: true }), [])
})

test('mergeCatalogEntries updates by id and appends new rows', () => {
  const current = [entry('a', 'Able', 1), entry('b', 'Bane', 2)]
  const patched = mergeCatalogEntries(current, [{ ...current[0]!, status: 'deactivated' }])
  assert.equal(patched[0]!.status, 'deactivated')
  assert.equal(patched[1]!.id, 'b')
  const added = mergeCatalogEntries(current, [entry('c', 'Cave', 3)])
  assert.equal(added[2]!.id, 'c')
})

test('catalogEntriesMatch ignores array identity when revision fields are equal', () => {
  const a = [entry('a', 'Able', 1), entry('z', 'Zed', 2)]
  const b = [entry('a', 'Able', 1), entry('z', 'Zed', 2)]
  assert.equal(catalogEntriesMatch(a, b), true)
  assert.equal(catalogEntriesMatch(a, [entry('a', 'Able', 1, 'outdated'), entry('z', 'Zed', 2)]), false)
  const renamed = [entry('a', 'Able', 1), entry('z', 'Zed', 2)]
  renamed[0]!.retailFamilyName = 'Aguzzo VF'
  assert.equal(catalogEntriesMatch(a, renamed), false)
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { loadCatalog, saveCatalog } from './catalog.ts'
import { applyRetailTrialDefault, persistFamilyTagPresence, persistNewFamilyTag } from './family-tags.ts'
import { noopFontNative, setFontNative } from './native.ts'
import { buildPaths } from './paths.ts'
import type { AppPaths } from './paths.ts'
import { checkRetail, configureRetailSync, resetRetailCache } from './service-retail.ts'
import type { CatalogEntry, CatalogFile } from './types.ts'
import {
  addFamilyTag,
  ensureSeedTags,
  entryHasFamilyTag,
  nextCustomTagColor,
  reconcileRetailTrialTags,
  deleteFamilyTag,
  renameFamilyTag,
  setFamilyTagPresent,
  TAG_COLOR_CHOICES,
  updateFamilyTag,
  tagIdsForFamily,
  type FamilyTagAssignment,
} from '../shared/family-tags.ts'
import type { RetailManifest } from '../shared/retail.ts'

function face(familyName: string) {
  return {
    familyName,
    styleName: 'Regular',
    fullName: `${familyName} Regular`,
    postscriptName: `${familyName}-Regular`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [] as string[],
    weight: 400,
    italic: false,
  }
}

function entry(partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'id'>): CatalogEntry {
  return {
    sourcePath: `/tmp/${partial.id}.otf`,
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'uninstalled',
    faces: [face('Local')],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

function catalog(entries: CatalogEntry[], familyTags: FamilyTagAssignment[] = []): CatalogFile {
  return {
    version: 1,
    entries,
    tags: ensureSeedTags(undefined),
    familyTags,
  }
}

function ids(file: { familyTags?: FamilyTagAssignment[] }, familyKey: string): string[] {
  return tagIdsForFamily(file.familyTags, familyKey)
}

test('no worker token applies Trial only to Displaay retail families', () => {
  const file = catalog([
    entry({
      id: 'retail',
      retailRelativePath: 'Reckless/RecklessVF.otf',
      retailFamilyName: 'Reckless',
      faces: [face('Parsed Overwrite')],
    }),
    entry({
      id: 'named-like-trial',
      sourcePath: '/Fonts/Matter-TRIAL-Regular.otf',
      faces: [face('Matter TRIAL')],
    }),
  ])
  assert.equal(reconcileRetailTrialTags(file, { hasWorkerToken: false }), true)
  assert.deepEqual(ids(file, 'Reckless'), ['trial'])
  assert.deepEqual(file.familyTags?.find((row) => row.familyKey === 'Reckless')?.autoTagIds, ['trial'])
  assert.deepEqual(ids(file, 'Matter TRIAL'), [])
  assert.equal(entryHasFamilyTag(file, file.entries[0]!, { seed: 'trial' }), true)
  assert.equal(entryHasFamilyTag(file, file.entries[1]!, { seed: 'trial' }), false)
  assert.equal(reconcileRetailTrialTags(file, { hasWorkerToken: false }), false)
})

test('a saved worker token clears automatic Trial and leaves manual tags', () => {
  const file = catalog(
    [
      entry({
        id: 'retail',
        retailRelativePath: 'Reckless/Reckless-TRIAL-VF.otf',
        retailFamilyName: 'Reckless',
      }),
      entry({ id: 'local', faces: [face('GT America')] }),
    ],
    [
      { familyKey: 'Reckless', tagIds: ['trial', 'licensed'], autoTagIds: ['trial'] },
      { familyKey: 'GT America', tagIds: ['open-source', 'trial'] },
    ],
  )
  assert.equal(reconcileRetailTrialTags(file, { hasWorkerToken: true }), true)
  assert.deepEqual(ids(file, 'Reckless'), ['licensed'])
  assert.equal(file.familyTags?.find((row) => row.familyKey === 'Reckless')?.autoTagIds, undefined)
  assert.deepEqual(ids(file, 'GT America'), ['open-source', 'trial'])
  assert.equal(reconcileRetailTrialTags(file, { hasWorkerToken: true }), false)
})

test('a manual Trial on a retail family is not removed when a worker token is entered', () => {
  const file = catalog(
    [
      entry({
        id: 'retail',
        retailRelativePath: 'Reckless/RecklessVF.otf',
        retailFamilyName: 'Reckless',
      }),
    ],
    [{ familyKey: 'Reckless', tagIds: ['trial'] }],
  )
  assert.equal(reconcileRetailTrialTags(file, { hasWorkerToken: true }), false)
  assert.deepEqual(ids(file, 'Reckless'), ['trial'])
})

test('clearing the token puts automatic Trial back without dropping other tags', () => {
  const file = catalog(
    [
      entry({
        id: 'retail',
        retailRelativePath: 'Reckless/RecklessVF.otf',
        retailFamilyName: 'Reckless',
      }),
      entry({ id: 'local', faces: [face('GT America')] }),
    ],
    [
      { familyKey: 'Reckless', tagIds: ['licensed'] },
      { familyKey: 'GT America', tagIds: ['unlicensed'] },
    ],
  )
  assert.equal(reconcileRetailTrialTags(file, { hasWorkerToken: false }), true)
  assert.deepEqual(ids(file, 'Reckless'), ['licensed', 'trial'])
  assert.deepEqual(file.familyTags?.find((row) => row.familyKey === 'Reckless')?.autoTagIds, ['trial'])
  assert.deepEqual(ids(file, 'GT America'), ['unlicensed'])
})

test('renaming the Trial seed keeps the default on that tag', () => {
  const file = catalog([
    entry({
      id: 'retail',
      retailRelativePath: 'Reckless/RecklessVF.otf',
      retailFamilyName: 'Reckless',
    }),
  ])
  renameFamilyTag(file, 'trial', 'Evaluation')
  reconcileRetailTrialTags(file, { hasWorkerToken: false })
  assert.equal(file.tags?.find((tag) => tag.seed === 'trial')?.name, 'Evaluation')
  assert.deepEqual(ids(file, 'Reckless'), ['trial'])
  assert.equal(entryHasFamilyTag(file, file.entries[0]!, { name: 'Evaluation' }), true)
  assert.equal(entryHasFamilyTag(file, file.entries[0]!, { name: 'Trial' }), false)
  assert.equal(entryHasFamilyTag(file, file.entries[0]!, { id: 'trial' }), true)
})

test('deleting a tag clears every family, and a deleted seed is not reapplied', () => {
  const file = catalog(
    [
      entry({
        id: 'retail',
        faces: [face('Reckless')],
        retailRelativePath: 'Reckless/RecklessVF.otf',
        retailFamilyName: 'Reckless',
      }),
    ],
    [{ familyKey: 'Reckless', tagIds: ['trial', 'licensed'], autoTagIds: ['trial'] }],
  )
  deleteFamilyTag(file, 'trial')
  assert.equal(file.tags?.some((tag) => tag.id === 'trial' || tag.seed === 'trial'), false)
  assert.deepEqual(file.retiredTagSeeds, ['trial'])
  assert.deepEqual(ids(file, 'Reckless'), ['licensed'])
  assert.equal(file.familyTags?.find((row) => row.familyKey === 'Reckless')?.autoTagIds, undefined)
  reconcileRetailTrialTags(file, { hasWorkerToken: false })
  assert.equal(file.tags?.some((tag) => tag.seed === 'trial'), false)
  assert.deepEqual(ids(file, 'Reckless'), ['licensed'])
})

test('creating a tag stores the chosen color', () => {
  const file = catalog([])
  const chosen = '#c45c8a'
  const tag = addFamilyTag(file, 'Client', 'client', chosen)
  assert.equal(tag.color, chosen)
  assert.equal(file.tags?.find((item) => item.id === 'client')?.color, chosen)
})

test('creating a tag without a color uses the next custom color', () => {
  const file = catalog([])
  const tag = addFamilyTag(file, 'Client', 'client')
  assert.equal(tag.color, nextCustomTagColor(ensureSeedTags(undefined)))
  assert.equal(tag.color, '#7c5cbf')
})

test('editing a tag changes its name and color and keeps the id', () => {
  const file = catalog([])
  updateFamilyTag(file, 'licensed', { name: 'Owned', color: '#3b6fd8' })
  const tag = file.tags?.find((item) => item.id === 'licensed')
  assert.equal(tag?.name, 'Owned')
  assert.equal(tag?.color, '#3b6fd8')
  assert.equal(tag?.seed, 'licensed')
})

test('a manual tag edit stops the Trial default from owning that tag', () => {
  const file = catalog([
    entry({
      id: 'retail',
      retailRelativePath: 'Reckless/RecklessVF.otf',
      retailFamilyName: 'Reckless',
    }),
  ])
  reconcileRetailTrialTags(file, { hasWorkerToken: false })
  setFamilyTagPresent(file, ['Reckless'], 'trial', true)
  assert.equal(file.familyTags?.[0]?.autoTagIds, undefined)
  reconcileRetailTrialTags(file, { hasWorkerToken: true })
  assert.deepEqual(ids(file, 'Reckless'), ['trial'])
})

function setup(): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-family-tags-'))
  const paths = buildPaths({ override: dataRoot, mac: false })
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  fs.mkdirSync(paths.userFontsDir, { recursive: true })
  setFontNative(noopFontNative())
  resetRetailCache()
  return paths
}

function trialManifest(): RetailManifest {
  return {
    mode: 'trial',
    generatedAt: '2026-01-01T00:00:00.000Z',
    collections: [
      {
        glyphsFile: 'Reckless',
        revisionId: 'rev-1',
        lastRegeneratedAt: '2026-01-01T00:00:00.000Z',
        files: [
          {
            key: 'Reckless/rev-1-TRIALS/Reckless-TRIAL-VF.otf',
            relativePath: 'Reckless/Reckless-TRIAL-VF.otf',
            size: 4,
            etag: 't1',
            uploaded: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ],
    skipped: [],
  }
}

test('retail check and token changes set Trial only when no worker token is saved', async () => {
  const paths = setup()
  try {
    saveCatalog(
      paths,
      catalog(
        [entry({ id: 'local', faces: [face('GT America')] })],
        [{ familyKey: 'GT America', tagIds: ['open-source'] }],
      ),
    )
    await configureRetailSync(paths, { enabled: true, acceptEula: true })
    await checkRetail(paths, {
      fetchManifest: async () => trialManifest(),
      fetchFile: async () => new Uint8Array(4),
    })

    let saved = loadCatalog(paths)
    assert.deepEqual(ids(saved, 'Reckless'), ['trial'])
    assert.deepEqual(saved.familyTags?.find((row) => row.familyKey === 'Reckless')?.autoTagIds, ['trial'])
    assert.deepEqual(ids(saved, 'GT America'), ['open-source'])
    assert.equal(
      saved.entries.some((row) => row.retailRelativePath === 'Reckless/Reckless-TRIAL-VF.otf'),
      true,
    )

    await persistFamilyTagPresence(paths, ['Reckless'], 'licensed', true)
    await persistFamilyTagPresence(paths, ['GT America'], 'trial', true)
    await configureRetailSync(paths, { token: 'worker-token' })

    saved = loadCatalog(paths)
    assert.deepEqual(ids(saved, 'Reckless'), ['licensed'])
    assert.deepEqual(ids(saved, 'GT America'), ['open-source', 'trial'])

    await checkRetail(paths, {
      fetchManifest: async () => trialManifest(),
      fetchFile: async () => new Uint8Array(4),
    })
    saved = loadCatalog(paths)
    assert.deepEqual(ids(saved, 'Reckless'), ['licensed'])
    assert.equal(ids(saved, 'Reckless').includes('trial'), false)
    assert.deepEqual(ids(saved, 'GT America'), ['open-source', 'trial'])
    assert.equal(entryHasFamilyTag(saved, { faces: [face('GT America')] }, { seed: 'open-source' }), true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('removing a worker token applies Trial again and keeps unrelated tags', async () => {
  const paths = setup()
  try {
    saveCatalog(
      paths,
      catalog([
        entry({
          id: 'retail',
          retailRelativePath: 'Reckless/RecklessVF.otf',
          retailFamilyName: 'Reckless',
        }),
        entry({ id: 'local', faces: [face('GT America')] }),
      ], [
        { familyKey: 'GT America', tagIds: ['unlicensed'] },
      ]),
    )
    await configureRetailSync(paths, { enabled: true, acceptEula: true, token: 'worker-token' })
    let saved = loadCatalog(paths)
    assert.deepEqual(ids(saved, 'Reckless'), [])
    assert.deepEqual(ids(saved, 'GT America'), ['unlicensed'])

    await configureRetailSync(paths, { token: '' })
    saved = loadCatalog(paths)
    assert.deepEqual(ids(saved, 'Reckless'), ['trial'])
    assert.deepEqual(ids(saved, 'GT America'), ['unlicensed'])
    assert.equal(await applyRetailTrialDefault(paths), false)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('creating a tag saves the chosen color on the catalog', async () => {
  const paths = setup()
  try {
    saveCatalog(paths, catalog([]))
    const chosen = '#C45C8A'
    await persistNewFamilyTag(paths, 'Client', ['GT America'], chosen)
    const saved = loadCatalog(paths)
    const tag = saved.tags?.find((item) => item.name === 'Client')
    assert.ok(tag)
    assert.equal(tag.color, chosen.toLowerCase())
    assert.deepEqual(ids(saved, 'GT America'), [tag.id])

    await persistNewFamilyTag(paths, 'Studio', [], TAG_COLOR_CHOICES[0])
    const again = loadCatalog(paths)
    assert.equal(again.tags?.find((item) => item.name === 'Studio')?.color, TAG_COLOR_CHOICES[0])
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { loadCatalog, saveCatalog } from './catalog.ts'
import {
  applyLibraryImportPlan,
  buildLibraryImportPlan,
  parseFontBookCollectionBuffer,
  parseLibraryImportBuffer,
  parseBinaryPlist,
  unarchiveKeyed,
} from './library-import.ts'
import { loadProjects, saveProjects } from './projects.ts'
import { tempPaths } from './test-util.ts'
import type { CatalogEntry } from './types.ts'
import { ensureSeedTags, type FamilyTag } from '../shared/family-tags.ts'
import type { LibraryImportFileInput, ParsedLibrary } from '../shared/library-import.ts'

const fixtureDir = path.join(import.meta.dirname, 'fixtures', 'library-import')

function fixture(name: string): LibraryImportFileInput {
  const buffer = fs.readFileSync(path.join(fixtureDir, name))
  const textLike = name.endsWith('.collection') && buffer.toString('utf8', 0, 1) === '<'
  return {
    name,
    content: textLike ? buffer.toString('utf8') : '',
    ...(textLike ? {} : { contentBase64: buffer.toString('base64') }),
  }
}

function fixtureBuffer(name: string): Buffer {
  return fs.readFileSync(path.join(fixtureDir, name))
}

function face(familyName: string, postscriptName: string, styleName = 'Regular') {
  return {
    familyName,
    styleName,
    fullName: `${familyName} ${styleName}`,
    postscriptName,
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
    faces: [face('Acme Sans', 'AcmeSans-Regular')],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

const entries: CatalogEntry[] = [
  entry({
    id: 'sans-regular',
    sourcePath: '/Users/designer/Fonts/Acme/AcmeSans-Regular.otf',
    sourceFingerprint: 'fingerprint-sans-regular',
    faces: [face('Acme Sans', 'AcmeSans-Regular')],
  }),
  entry({
    id: 'sans-bold',
    sourcePath: '/Users/designer/Fonts/Acme/AcmeSans-Bold.otf',
    faces: [face('Acme Sans', 'AcmeSans-Bold', 'Bold')],
  }),
  entry({
    id: 'serif',
    sourcePath: '/Users/designer/Fonts/Acme/AcmeSerif-Regular.otf',
    faces: [face('Acme Serif', 'AcmeSerif-Regular')],
  }),
  entry({
    id: 'serif-italic',
    sourcePath: '/Users/designer/Fonts/Acme/AcmeSerif-Italic.otf',
    faces: [face('Acme Serif', 'AcmeSerif-Italic', 'Italic')],
  }),
]

test('binary plist + keyed archive resolution reads the Font Book fixture graph', () => {
  const root = parseBinaryPlist(fixtureBuffer('Client Work.collection'))
  const dictionary = unarchiveKeyed(root, 'NSFontCollectionDictionary')
  assert.ok(dictionary)
  assert.ok(Array.isArray(dictionary.NSFontCollectionFontDescriptors))
})

test('Font Book manual collection parses descriptors, exclusions and built-in flag', () => {
  const parsed = parseFontBookCollectionBuffer('Client Work.collection', fixtureBuffer('Client Work.collection'))
  assert.equal(parsed.sourceApp, 'font-book')
  assert.equal(parsed.sets[0]?.name, 'Client Work')
  assert.deepEqual(parsed.sets[0]?.members, [
    'AcmeSans-Regular',
    'AcmeSans-Bold',
    'Acme Serif',
    'Missing Family',
  ])
  assert.deepEqual(parsed.sets[0]?.excluded, ['AcmeSerif-Italic'])
  assert.equal(parsed.sets[0]?.isBuiltIn, undefined)

  const builtIn = parseFontBookCollectionBuffer('Web.collection', fixtureBuffer('Web.collection'))
  assert.equal(builtIn.sets[0]?.isBuiltIn, true)
})

test('Font Book smart collection is named in the report, not translated', () => {
  const parsed = parseFontBookCollectionBuffer('Sans Text.collection', fixtureBuffer('Sans Text.collection'))
  assert.deepEqual(parsed.sets, [])
  assert.ok(
    parsed.unsupported.some(
      (item) => item.concept === 'smart-sets' && item.detail === 'Sans Text',
    ),
  )
  assert.ok(parsed.unsupported.some((item) => item.concept === 'labels'))
  assert.deepEqual(parsed.ratings, [])
  assert.deepEqual(parsed.comments, [])
})

test('Font Book plan matches faces and families, drops excluded styles, built-ins start unchecked', () => {
  const parsed = parseFontBookCollectionBuffer('Client Work.collection', fixtureBuffer('Client Work.collection'))
  const plan = buildLibraryImportPlan([parsed], entries, [], ensureSeedTags(undefined))
  const set = plan.sets[0]!
  // Acme Serif family pulls in Regular only; the negative descriptor drops Italic.
  assert.deepEqual(set.memberAssetIds, ['sans-regular', 'sans-bold', 'serif'])
  assert.equal(set.unresolved.length, 1)
  assert.equal(set.unresolved[0]?.familyName, 'Missing Family')

  const builtInPlan = buildLibraryImportPlan(
    [parseFontBookCollectionBuffer('Web.collection', fixtureBuffer('Web.collection'))],
    entries,
    [],
    [],
  )
  assert.equal(builtInPlan.sets[0]?.isBuiltIn, true)
  assert.equal(builtInPlan.sets[0]?.defaultChoice, 'skip')
})

test('FontExplorer database parses sets, smart sets, colour labels, ratings and comments', () => {
  const parsed = parseLibraryImportBuffer(fixture('FontExplorer X.fexdb'))
  assert.equal(parsed.sourceApp, 'font-explorer-x')
  const manual = parsed.sets.find((set) => set.name === 'Clients / Client Work')
  assert.ok(manual, 'nested folder set is flattened')
  assert.deepEqual(manual.members, ['AcmeSans-Regular', 'AcmeSans-Bold', 'AcmeSerif-Regular'])

  const smart = parsed.sets.find((set) => set.name === 'Acme Active')
  assert.ok(smart?.rules, 'translatable smart set keeps rules')
  assert.deepEqual(
    smart.rules.rules.map((rule) => `${rule.field}:${rule.operator}:${rule.value}`),
    ['query:contains:Acme', 'status:is:installed'],
  )
  assert.equal(smart.rules.match, 'all')

  const unsupported = parsed.sets.find((set) => set.name === 'Maker Picks')
  assert.equal(unsupported?.rules, undefined)
  assert.deepEqual(unsupported?.unsupportedRules, ['Manufacturer contains'])

  assert.ok(!parsed.sets.some((set) => set.name === 'Activated Fonts'), 'built-in smart sets skipped')

  assert.deepEqual(
    parsed.labels.map((label) => [label.label, label.members]),
    [
      ['Red', ['AcmeSerif-Regular']],
      ['Blue', ['AcmeSans-Regular']],
    ],
  )
  assert.deepEqual(parsed.ratings, [
    { member: 'AcmeSans-Regular', stars: 5 },
    { member: 'AcmeSerif-Regular', stars: 3 },
  ])
  assert.deepEqual(parsed.comments, [
    { member: 'AcmeSans-Regular', text: 'Hero sans' },
    { member: '/Users/designer/Fonts/Acme/AcmeSerif-Regular.otf', text: 'File note' },
  ])
  assert.ok(!parsed.unsupported.some((item) => item.concept === 'ratings'))
  assert.ok(!parsed.unsupported.some((item) => item.concept === 'comments'))
})

test('FontExplorer backup ZIP yields the same library as the database', () => {
  const fromBackup = parseLibraryImportBuffer(fixture('Library.fexbackup'))
  const fromDb = parseLibraryImportBuffer(fixture('FontExplorer X.fexdb'))
  assert.deepEqual(
    fromBackup.sets.map((set) => set.name),
    fromDb.sets.map((set) => set.name),
  )
  assert.deepEqual(fromBackup.labels, fromDb.labels)
})

test('a non-library SQLite file is reported, not parsed', () => {
  const parsed = parseLibraryImportBuffer({
    name: 'Random.fexdb',
    content: '',
    contentBase64: Buffer.from('SQLite format 3\0not-a-real-db').toString('base64'),
  })
  assert.deepEqual(parsed.sets, [])
  assert.ok(parsed.unsupported.some((item) => item.concept === 'file'))
})

test('plan defaults: same-named set merges, disabled smart set skips, labels reuse colour tags', () => {
  const paths = tempPaths('library-import-plan-')
  try {
    const blue: FamilyTag = { id: 'tag-blue', name: 'Blue', color: '#0000ff' }
    saveCatalog(paths, {
      version: 1,
      entries,
      tags: [...ensureSeedTags(undefined), blue],
      familyTags: [],
    })
    saveProjects(paths, [
      {
        id: 'existing-1',
        name: 'Clients / Client Work',
        members: [{ assetId: 'sans-regular' }],
        desiredActive: false,
        unresolved: [],
      },
    ])
    const parsed = parseLibraryImportBuffer(fixture('FontExplorer X.fexdb'))
    const plan = buildLibraryImportPlan([parsed], entries, loadProjects(paths), loadCatalog(paths).tags ?? [])
    const manual = plan.sets.find((set) => set.name === 'Clients / Client Work')!
    assert.equal(manual.collision, true)
    assert.equal(manual.defaultChoice, 'merge')
    assert.deepEqual(manual.alreadyMemberAssetIds, ['sans-regular'])

    const disabled = plan.sets.find((set) => set.name === 'Maker Picks')!
    assert.equal(disabled.disabled, true)
    assert.equal(disabled.defaultChoice, 'skip')
    assert.deepEqual(disabled.untranslatableRules, ['Manufacturer contains'])

    const blueLabel = plan.labels.find((label) => label.name === 'Blue')!
    assert.equal(blueLabel.existingTagId, 'tag-blue')
    assert.deepEqual(blueLabel.familyKeys, ['Acme Sans'])
    const redLabel = plan.labels.find((label) => label.name === 'Red')!
    assert.equal(redLabel.existingTagId, null)
    assert.deepEqual(redLabel.familyKeys, ['Acme Serif'])
    assert.equal(plan.summary.ratings, 2)
    assert.equal(plan.summary.comments, 2)
    assert.deepEqual(
      plan.ratings.map((rating) => [rating.familyKey, rating.stars, rating.existingRating]),
      [
        ['Acme Sans', 5, null],
        ['Acme Serif', 3, null],
      ],
    )

    const result = applyLibraryImportPlan(paths, plan, {})
    assert.deepEqual(result.mergedProjects, ['Clients / Client Work'])
    assert.deepEqual(result.skippedSets, ['Maker Picks'])
    assert.deepEqual(result.createdProjects, ['Acme Active'])
    assert.deepEqual(result.reusedTags, ['Blue'])
    assert.deepEqual(result.createdTags, ['Red'])

    const projects = loadProjects(paths)
    const merged = projects.find((project) => project.id === 'existing-1')!
    assert.deepEqual(
      merged.members.map((member) => member.assetId).sort(),
      ['sans-bold', 'sans-regular', 'serif'],
    )
    const smart = projects.find((project) => project.name === 'Acme Active')!
    assert.equal(smart.kind, 'smart')
    assert.ok(!projects.some((project) => project.name === 'Maker Picks'))

    const saved = loadCatalog(paths)
    assert.deepEqual(
      (saved.familyTags ?? []).find((row) => row.familyKey === 'Acme Sans')?.tagIds,
      ['tag-blue'],
    )
    const red = (saved.tags ?? []).find((tag) => tag.name === 'Red')!
    assert.deepEqual(
      (saved.familyTags ?? []).find((row) => row.familyKey === 'Acme Serif')?.tagIds,
      [red.id],
    )
    // Ratings and comments landed per family; entries themselves are untouched.
    assert.deepEqual(saved.familyDetails, [
      { familyKey: 'Acme Sans', rating: 5, comment: 'Hero sans' },
      { familyKey: 'Acme Serif', comment: 'File note', rating: 3 },
    ])
    assert.ok(!('rating' in (saved.entries[0] as unknown as Record<string, unknown>)))
    assert.equal(result.ratedFamilies, 2)
    assert.equal(result.commentedFamilies, 2)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('fingerprint identifiers win over name matches', () => {
  const parsed: ParsedLibrary = {
    sourceApp: 'font-book',
    sourceName: 'Fingerprints.collection',
    sets: [{ name: 'Pinned', kind: 'set', members: ['fingerprint-sans-regular'] }],
    labels: [],
    ratings: [],
    comments: [],
    unsupported: [],
    warnings: [],
  }
  const plan = buildLibraryImportPlan([parsed], entries, [], [])
  assert.deepEqual(plan.sets[0]?.memberAssetIds, ['sans-regular'])
})

test('import keeps a stored rating and comment instead of overwriting them', () => {
  const paths = tempPaths('library-import-keep-details-')
  try {
    saveCatalog(paths, {
      version: 1,
      entries,
      tags: ensureSeedTags(undefined),
      familyTags: [],
      familyDetails: [{ familyKey: 'Acme Sans', rating: 2, comment: 'Keep me' }],
    })
    saveProjects(paths, [])
    const parsed = parseLibraryImportBuffer(fixture('FontExplorer X.fexdb'))
    const plan = buildLibraryImportPlan(
      [parsed],
      entries,
      [],
      [],
      loadCatalog(paths).familyDetails ?? [],
    )
    const sansRating = plan.ratings.find((rating) => rating.familyKey === 'Acme Sans')!
    assert.equal(sansRating.existingRating, 2)
    const result = applyLibraryImportPlan(paths, plan, {})
    assert.equal(result.ratedFamilies, 1)
    assert.equal(result.commentedFamilies, 1)
    assert.deepEqual(loadCatalog(paths).familyDetails, [
      { familyKey: 'Acme Sans', rating: 2, comment: 'Keep me' },
      { familyKey: 'Acme Serif', rating: 3, comment: 'File note' },
    ])
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('apply creates a Font Book project exactly as planned, unresolved names kept', () => {
  const paths = tempPaths('library-import-apply-')
  try {
    saveCatalog(paths, { version: 1, entries, tags: ensureSeedTags(undefined), familyTags: [] })
    saveProjects(paths, [])
    const parsed = parseFontBookCollectionBuffer('Client Work.collection', fixtureBuffer('Client Work.collection'))
    const plan = buildLibraryImportPlan([parsed], entries, [], [])
    const result = applyLibraryImportPlan(paths, plan, {})
    assert.deepEqual(result.createdProjects, ['Client Work'])
    const project = loadProjects(paths)[0]!
    assert.deepEqual(
      project.members.map((member) => member.assetId),
      ['sans-regular', 'sans-bold', 'serif'],
    )
    assert.equal(project.unresolved?.[0]?.familyName, 'Missing Family')
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

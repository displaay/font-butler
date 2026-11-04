import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadCatalog, saveCatalog } from './catalog.ts'
import { projectActivationMembers, projectActivationState } from './projects.ts'
import { withService } from './test-util.ts'
import type { CatalogEntry } from './types.ts'
import { ensureSeedTags, familyTagRulePredicate } from '../shared/family-tags.ts'
import {
  emptySmartRuleSet,
  entryMatchesSmartRules,
  matchingSmartEntries,
  matchingSmartFamilyCount,
  normalizeSmartRuleSet,
  smartProjectSnapshot,
  type SmartMatchEntry,
  type SmartRule,
  type SmartRuleSet,
} from '../shared/smart-projects.ts'

function face(partial: {
  familyName: string
  styleName?: string
  isVariable?: boolean
  fullName?: string
}): SmartMatchEntry['faces'] {
  const style = partial.styleName ?? 'Regular'
  return [
    {
      familyName: partial.familyName,
      styleName: style,
      fullName: partial.fullName ?? `${partial.familyName} ${style}`,
      postscriptName: `${partial.familyName}-${style}`,
      isVariable: partial.isVariable ?? false,
    },
  ]
}

function font(partial: Partial<SmartMatchEntry> & Pick<SmartMatchEntry, 'id'>): SmartMatchEntry {
  return {
    status: 'installed',
    format: 'otf',
    sourcePath: `/Fonts/${partial.id}.otf`,
    installedPath: `/Library/Fonts/${partial.id}.otf`,
    sourcePresent: true,
    sourceAvailability: 'present',
    faces: face({ familyName: partial.id }),
    ...partial,
  }
}

function rule(partial: Partial<SmartRule> & Pick<SmartRule, 'field' | 'value'>): SmartRule {
  return {
    id: partial.id ?? partial.field,
    operator: partial.operator ?? (partial.field === 'query' ? 'contains' : 'is'),
    ...partial,
  }
}

function rules(match: 'all' | 'any', list: SmartRule[]): SmartRuleSet {
  return { match, rules: list }
}

function catalogEntry(
  partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'sourcePath'>,
): CatalogEntry {
  return {
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'installed',
    faces: [
      {
        familyName: 'Trial',
        styleName: 'Regular',
        fullName: 'Trial Regular',
        postscriptName: 'Trial-Regular',
        isVariable: false,
        instanceCount: 1,
        instanceNames: [],
        weight: 400,
        italic: false,
      },
    ],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

test('smart rules match All and Any across filter-chip fields', () => {
  const trialVf = font({
    id: 'trial-vf',
    format: 'ttf',
    faces: face({ familyName: 'Trial Sans', isVariable: true }),
    installations: [{ destinationId: 'macos', verification: 'file-present' }],
  })
  const staticInstalled = font({
    id: 'static',
    faces: face({ familyName: 'Retail Text', isVariable: false }),
    installations: [{ destinationId: 'adobe-shared', verification: 'file-present' }],
  })
  const deactivated = font({
    id: 'off',
    status: 'deactivated',
    disabledPath: '/Library/Fonts/off.otf.disabled',
    faces: face({ familyName: 'Paused', isVariable: false }),
  })
  const missing = font({
    id: 'gone',
    status: 'source-missing',
    sourcePresent: false,
    sourceAvailability: 'missing',
    installedPath: undefined,
    faces: face({ familyName: 'Gone', isVariable: false }),
  })
  const retail = font({
    id: 'retail',
    retailRelativePath: 'Trial/Trial-VF.otf',
    sourcePath: '/Library/Fonts/Trial-VF.otf',
    installedPath: '/Library/Fonts/Trial-VF.otf',
    faces: face({ familyName: 'Trial VF', isVariable: true }),
    installations: [{ destinationId: 'macos', verification: 'file-present' }],
  })

  const allTrialVf = rules('all', [
    rule({ field: 'status', value: 'installed' }),
    rule({ field: 'variable', value: 'vf' }),
    rule({ field: 'query', value: 'trial' }),
  ])
  assert.deepEqual(
    matchingSmartEntries([trialVf, staticInstalled, deactivated, missing, retail], allTrialVf).map(
      (entry) => entry.id,
    ),
    ['trial-vf', 'retail'],
  )

  const anyOffOrStatic = rules('any', [
    rule({ field: 'status', value: 'deactivated' }),
    rule({ field: 'variable', value: 'static' }),
  ])
  assert.deepEqual(
    matchingSmartEntries([trialVf, staticInstalled, deactivated, retail], anyOffOrStatic).map(
      (entry) => entry.id,
    ),
    ['static', 'off'],
  )

  assert.equal(
    entryMatchesSmartRules(deactivated, rules('all', [rule({ field: 'status', operator: 'isNot', value: 'installed' })])),
    true,
  )
  assert.equal(
    entryMatchesSmartRules(trialVf, rules('all', [rule({ field: 'status', operator: 'isNot', value: 'installed' })])),
    false,
  )
  assert.equal(
    entryMatchesSmartRules(
      staticInstalled,
      rules('all', [rule({ field: 'destination', value: 'adobe' }), rule({ field: 'format', value: 'otf' })]),
    ),
    true,
  )
  assert.equal(
    entryMatchesSmartRules(trialVf, rules('all', [rule({ field: 'format', value: 'otf' })])),
    false,
  )
  assert.equal(
    entryMatchesSmartRules(trialVf, rules('all', [rule({ field: 'source', value: 'source' })])),
    true,
  )
  assert.equal(
    entryMatchesSmartRules(retail, rules('all', [rule({ field: 'source', value: 'no-source' })])),
    true,
  )
  assert.equal(
    entryMatchesSmartRules(missing, rules('all', [rule({ field: 'status', value: 'uninstalled' })])),
    true,
  )
  assert.equal(
    entryMatchesSmartRules(retail, rules('all', [rule({ field: 'folder', value: '__retail__' })])),
    true,
  )
  assert.equal(
    entryMatchesSmartRules(
      trialVf,
      rules('all', [rule({ field: 'folder', value: '/Fonts' })]),
    ),
    true,
  )
  assert.equal(
    entryMatchesSmartRules(trialVf, rules('all', [rule({ field: 'folder', operator: 'isNot', value: '/Fonts' })])),
    false,
  )
  assert.equal(
    entryMatchesSmartRules(
      staticInstalled,
      rules('all', [rule({ field: 'query', operator: 'notContains', value: 'trial' })]),
    ),
    true,
  )
  assert.equal(entryMatchesSmartRules(trialVf, emptySmartRuleSet()), false)
  assert.equal(entryMatchesSmartRules(trialVf, rules('any', [])), false)
})

test('a tag rule is stored and stays unmatched until a predicate is supplied', () => {
  const normalized = normalizeSmartRuleSet({
    match: 'all',
    rules: [
      { id: 'keep', field: 'tag', operator: 'isNot', value: '  Trial  ' },
      { id: 'drop-op', field: 'tag', operator: 'contains', value: 'Trial' },
      { id: 'drop-field', field: 'foundry', operator: 'is', value: 'Displaay' },
      { field: 'status', operator: 'is', value: 'nope' },
      { id: 'status', field: 'status', operator: 'is', value: 'installed' },
    ],
  })
  assert.equal(normalized.match, 'all')
  assert.deepEqual(
    normalized.rules.map((item) => [item.id, item.field, item.operator, item.value]),
    [
      ['keep', 'tag', 'isNot', 'Trial'],
      ['status', 'status', 'is', 'installed'],
    ],
  )

  const licensed = font({ id: 'licensed', tags: ['licensed'] } as SmartMatchEntry & { tags: string[] })
  const trial = font({ id: 'trial', tags: ['trial'] } as SmartMatchEntry & { tags: string[] })
  const tagRule = rules('all', [rule({ field: 'tag', operator: 'is', value: 'licensed' })])
  assert.deepEqual(matchingSmartEntries([licensed, trial], tagRule), [])
  assert.deepEqual(
    matchingSmartEntries([licensed, trial], tagRule, {
      predicates: {
        tag: (entry, item) => ((entry as { tags?: string[] }).tags ?? []).includes(item.value),
      },
    }).map((entry) => entry.id),
    ['licensed'],
  )
  const excluded = rules('all', [rule({ field: 'tag', operator: 'isNot', value: 'trial' })])
  assert.deepEqual(
    matchingSmartEntries([licensed, trial], excluded, {
      predicates: {
        tag: (entry, item) => ((entry as { tags?: string[] }).tags ?? []).includes(item.value),
      },
    }).map((entry) => entry.id),
    ['licensed'],
  )
})

test('a tag rule matches family tags by id or current name', () => {
  const tags = ensureSeedTags(undefined).map((tag) =>
    tag.seed === 'trial' ? { ...tag, name: 'Evaluation' } : tag,
  )
  const catalog = {
    tags,
    familyTags: [
      { familyKey: 'Reckless', tagIds: ['trial'] },
      { familyKey: 'GT America', tagIds: ['open-source'] },
    ],
  }
  const options = { predicates: { tag: familyTagRulePredicate(catalog) } }
  const reckless = font({ id: 'reckless', faces: face({ familyName: 'Reckless' }) })
  const gt = font({ id: 'gt', faces: face({ familyName: 'GT America' }) })
  const namedLikeTrial = font({
    id: 'filename',
    sourcePath: '/Fonts/Matter-TRIAL-Regular.otf',
    faces: face({ familyName: 'Matter TRIAL' }),
  })
  const byName = rules('all', [rule({ field: 'tag', operator: 'is', value: 'Evaluation' })])
  const byId = rules('all', [rule({ field: 'tag', operator: 'is', value: 'open-source' })])
  const notTrial = rules('all', [rule({ field: 'tag', operator: 'isNot', value: 'trial' })])
  assert.deepEqual(matchingSmartEntries([reckless, gt, namedLikeTrial], byName).map((entry) => entry.id), [])
  assert.deepEqual(
    matchingSmartEntries([reckless, gt, namedLikeTrial], byName, options).map((entry) => entry.id),
    ['reckless'],
  )
  assert.deepEqual(
    matchingSmartEntries([reckless, gt, namedLikeTrial], byId, options).map((entry) => entry.id),
    ['gt'],
  )
  assert.deepEqual(
    matchingSmartEntries([reckless, gt, namedLikeTrial], notTrial, options).map((entry) => entry.id),
    ['gt', 'filename'],
  )
  assert.deepEqual(
    matchingSmartEntries(
      [reckless],
      rules('all', [rule({ field: 'tag', operator: 'is', value: 'Trial' })]),
      options,
    ),
    [],
  )

  const project = {
    id: 'smart',
    name: 'Evaluation families',
    kind: 'smart' as const,
    members: [],
    desiredActive: false,
    rules: byName,
  }
  const entries = [
    catalogEntry({
      id: 'reckless',
      sourcePath: '/Fonts/Reckless.otf',
      faces: [
        {
          familyName: 'Reckless',
          styleName: 'Regular',
          fullName: 'Reckless Regular',
          postscriptName: 'Reckless-Regular',
          isVariable: false,
          instanceCount: 1,
          instanceNames: [],
          weight: 400,
          italic: false,
        },
      ],
    }),
  ]
  assert.deepEqual(projectActivationMembers(project, entries), [])
  assert.deepEqual(
    projectActivationMembers(project, entries, catalog).map((member) => member.assetId),
    ['reckless'],
  )
})

test('a snapshot copies the current match into a manual member list', () => {
  const entries = [
    font({ id: 'trial', faces: face({ familyName: 'Trial Sans', isVariable: true }) }),
    font({ id: 'other', faces: face({ familyName: 'Other' }) }),
  ]
  const set = rules('all', [
    rule({ field: 'query', value: 'Trial' }),
    rule({ field: 'variable', value: 'vf' }),
  ])
  const snapshot = smartProjectSnapshot({ name: 'Client' }, entries, set)
  assert.deepEqual(snapshot, { name: 'Client snapshot', memberIds: ['trial'] })
  assert.equal('rules' in snapshot, false)
  assert.deepEqual(smartProjectSnapshot({ name: 'Client snapshot' }, entries, set).name, 'Client snapshot')
  assert.deepEqual(smartProjectSnapshot({ name: 'Empty' }, entries, emptySmartRuleSet()).memberIds, [])
})

test('smart project activation state follows rules, not a stored member list', () => {
  const entries = [
    catalogEntry({
      id: 'trial',
      sourcePath: '/Fonts/Trial.otf',
      installedPath: '/Library/Fonts/Trial.otf',
      status: 'installed',
    }),
  ]
  const project = {
    id: 'smart',
    name: 'Trials',
    kind: 'smart' as const,
    members: [{ assetId: 'stale' }],
    desiredActive: true,
    rules: rules('all', [rule({ field: 'query', value: 'Trial' })]),
  }
  assert.equal(projectActivationState(project, entries), 'active')
  assert.equal(
    projectActivationState({ ...project, desiredActive: false }, entries),
    'inactive',
  )
})

test('snapshot and activation owners follow a smart project without storing members', async () => {
  await withService(async (service, paths) => {
    const trial = catalogEntry({
      id: 'trial',
      sourcePath: '/Library/Fonts/Trial.otf',
      installedPath: '/Library/Fonts/Trial.otf',
      status: 'installed',
      activationOwners: [{ kind: 'manual' }],
      faces: [
        {
          familyName: 'Trial Sans',
          styleName: 'Regular',
          fullName: 'Trial Sans Regular',
          postscriptName: 'TrialSans-Regular',
          isVariable: true,
          instanceCount: 1,
          instanceNames: [],
          weight: 400,
          italic: false,
        },
      ],
    })
    const other = catalogEntry({
      id: 'other',
      sourcePath: '/Library/Fonts/Other.otf',
      installedPath: '/Library/Fonts/Other.otf',
      status: 'installed',
      faces: [
        {
          familyName: 'Other Sans',
          styleName: 'Regular',
          fullName: 'Other Sans Regular',
          postscriptName: 'OtherSans-Regular',
          isVariable: false,
          instanceCount: 1,
          instanceNames: [],
          weight: 400,
          italic: false,
        },
      ],
    })
    const catalog = loadCatalog(paths)
    catalog.entries.push(trial, other)
    saveCatalog(paths, catalog)

    const smart = await service.createProject('Client', ['ignored'], {
      kind: 'smart',
      rules: rules('all', [rule({ field: 'query', value: 'Trial' })]),
    })
    assert.equal(smart.kind, 'smart')
    assert.deepEqual(smart.members, [])

    const activated = await service.activateProject(smart.id)
    assert.equal(activated.failed, 0)
    const afterActivate = service.listCatalog()
    const trialAfter = afterActivate.find((entry) => entry.id === 'trial')!
    const otherAfter = afterActivate.find((entry) => entry.id === 'other')!
    assert.equal(
      trialAfter.activationOwners?.some((owner) => owner.kind === 'project' && owner.projectId === smart.id),
      true,
    )
    assert.equal(
      trialAfter.activationOwners?.some((owner) => owner.kind === 'manual'),
      true,
    )
    assert.equal(
      Boolean(otherAfter.activationOwners?.some((owner) => owner.projectId === smart.id)),
      false,
    )
    assert.equal(service.listProjects().find((item) => item.id === smart.id)?.members.length, 0)

    const snapshot = await service.snapshotProject(smart.id)
    assert.equal(snapshot.kind, undefined)
    assert.equal(snapshot.desiredActive, false)
    assert.deepEqual(
      snapshot.members.map((member) => member.assetId),
      ['trial'],
    )
    assert.equal(snapshot.rules, undefined)

    await service.updateProject(smart.id, {
      rules: rules('all', [rule({ field: 'query', value: 'Other' })]),
    })
    const retargeted = service.listCatalog()
    const trialRetargeted = retargeted.find((entry) => entry.id === 'trial')!
    const otherRetargeted = retargeted.find((entry) => entry.id === 'other')!
    assert.equal(
      trialRetargeted.activationOwners?.some((owner) => owner.projectId === smart.id),
      false,
    )
    assert.equal(trialRetargeted.status, 'installed')
    assert.equal(
      otherRetargeted.activationOwners?.some((owner) => owner.projectId === smart.id),
      true,
    )
    assert.equal(service.listProjects().find((item) => item.id === smart.id)?.desiredActive, true)

    await assert.rejects(
      service.updateProject(smart.id, { memberIds: ['trial'] }),
      /membership comes from its rules/,
    )
    await assert.rejects(service.snapshotProject(snapshot.id), /smart project/)
  })
})

function styledFamily(
  id: string,
  family: string,
  styles: string[],
  classification: string | null,
): SmartMatchEntry {
  return font({
    id,
    faces: styles.map((style) => ({
      familyName: family,
      styleName: style,
      fullName: `${family} ${style}`,
      postscriptName: `${family}-${style}`,
      isVariable: false,
      classification,
    })),
  })
}

test('number of styles is more than 5 counts a family across its files', () => {
  const first = styledFamily('a', 'Reckless', ['Regular', 'Bold', 'Light'], 'serif')
  const second = styledFamily('b', 'Reckless', ['Medium', 'Black', 'Thin'], 'serif')
  const short = styledFamily('c', 'Short', ['Regular', 'Bold', 'Light', 'Medium', 'Black'], 'serif')
  const set = rules('all', [rule({ field: 'styleCount', operator: 'isMoreThan', value: '5' })])
  assert.equal(matchingSmartFamilyCount([first, second, short], set), 1)
  assert.deepEqual(
    matchingSmartEntries([first, second, short], set).map((entry) => entry.id),
    ['a', 'b'],
  )
})

test('classification is Serif, and an unclassified family matches neither is nor is not', () => {
  const serif = styledFamily('serif', 'Reckless', ['Regular'], 'serif')
  const blank = styledFamily('blank', 'Plain', ['Regular'], null)
  const isSerif = rules('all', [rule({ field: 'classification', operator: 'is', value: 'Serif' })])
  const isNotSerif = rules('all', [rule({ field: 'classification', operator: 'isNot', value: 'serif' })])
  assert.deepEqual(matchingSmartEntries([serif, blank], isSerif).map((entry) => entry.id), ['serif'])
  assert.deepEqual(matchingSmartEntries([serif, blank], isNotSerif).map((entry) => entry.id), [])
})

test('all of the rules and any of the rules combine style count with classification', () => {
  const wide = styledFamily('wide', 'Reckless', ['Regular', 'Bold', 'Light', 'Medium', 'Black', 'Thin'], 'serif')
  const narrow = styledFamily('narrow', 'Chronicle', ['Regular'], 'serif')
  const grotesk = styledFamily(
    'grotesk',
    'Grotesk',
    ['Regular', 'Bold', 'Light', 'Medium', 'Black', 'Thin', 'Italic', 'Bold Italic'],
    'sans-serif',
  )
  const manyStyles = rule({ field: 'styleCount', operator: 'isMoreThan', value: '5' })
  const serif = rule({ id: 'class', field: 'classification', operator: 'is', value: 'serif' })
  const entries = [wide, narrow, grotesk]
  assert.deepEqual(
    matchingSmartEntries(entries, rules('all', [manyStyles, serif])).map((entry) => entry.id),
    ['wide'],
  )
  assert.deepEqual(
    matchingSmartEntries(entries, rules('any', [manyStyles, serif])).map((entry) => entry.id).sort(),
    ['grotesk', 'narrow', 'wide'],
  )
  assert.equal(matchingSmartFamilyCount(entries, rules('all', [manyStyles, serif])), 1)
  assert.equal(matchingSmartFamilyCount(entries, rules('any', [manyStyles, serif])), 3)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addSearchToken,
  applySearchSuggestion,
  cardPreviewFromRequest,
  familyMatchesLibrarySearch,
  previewRequestFromTokens,
  searchFilterSuggestions,
  searchTokenById,
  type SearchFamily,
} from '../shared/library-search.ts'

const variableSans: SearchFamily = {
  familyName: 'Review Sans',
  tagNames: ['display'],
  faces: [
    {
      familyName: 'Review Sans',
      styleName: 'Regular',
      fullName: 'Review Sans Regular',
      postscriptName: 'ReviewSans-Regular',
      isVariable: true,
      classification: 'sans-serif',
      foundry: 'Displaay',
      designer: 'Daniel Quisek',
      weight: 400,
      features: ['tnum'],
      instanceNames: ['Regular', 'Bold', 'Condensed Bold'],
    },
  ],
}

test('search words combine across name, foundry, designer, traits, and tags', () => {
  assert.equal(familyMatchesLibrarySearch(variableSans, 'variable sans'), true)
  assert.equal(familyMatchesLibrarySearch(variableSans, 'variable serif'), false)
  assert.equal(familyMatchesLibrarySearch(variableSans, 'displaay'), true)
  assert.equal(familyMatchesLibrarySearch(variableSans, 'daniel'), true)
  assert.equal(familyMatchesLibrarySearch(variableSans, 'vetica'), false)
  assert.equal(familyMatchesLibrarySearch(variableSans, 'display'), true)
  assert.equal(familyMatchesLibrarySearch(variableSans, 'review bold'), true)
})

const tags = ['Trial', 'Licensed', 'Unlicensed', 'Open Source']

function tagged(name: string, tagNames: string[], classification: string): SearchFamily {
  return {
    familyName: name,
    tagNames,
    faces: [
      {
        familyName: name,
        styleName: 'Regular',
        classification,
      },
    ],
  }
}

test('a tag word matches that tag, and tag is not a trait', () => {
  const trialSans = tagged('Reckless', ['Trial'], 'sans-serif')
  const licensed = tagged('Chronicle', ['Licensed'], 'serif')
  const unlicensed = tagged('Unlicensed Sans', ['Unlicensed'], 'sans-serif')
  const open = tagged('Reckless', ['Open Source'], 'serif')
  assert.equal(familyMatchesLibrarySearch(trialSans, 'Trial', [], tags), true)
  assert.equal(familyMatchesLibrarySearch(trialSans, 'trial sans', [], tags), true)
  assert.equal(familyMatchesLibrarySearch(trialSans, 'trial serif', [], tags), false)
  assert.equal(familyMatchesLibrarySearch(licensed, 'Licensed', [], tags), true)
  assert.equal(familyMatchesLibrarySearch(unlicensed, 'Licensed', [], tags), false)
  assert.equal(familyMatchesLibrarySearch(unlicensed, 'Unlicensed', [], tags), true)
  assert.equal(familyMatchesLibrarySearch(trialSans, 'tag', [], tags), false)
  assert.equal(familyMatchesLibrarySearch(open, 'open source', [], tags), true)
  assert.equal(familyMatchesLibrarySearch(open, 'open', [], tags), false)
  assert.equal(familyMatchesLibrarySearch(tagged('Trial Sans', [], 'sans-serif'), 'trial sans', [], tags), false)
})

test('a preview token filters and restyles, and a second weight replaces the first', () => {
  const bold = searchTokenById('bold')!
  const tabular = searchTokenById('tabular')!
  const tokens = addSearchToken(addSearchToken([bold], 'tabular'), 'semibold')
  assert.deepEqual(
    tokens.map((token) => token.id),
    ['tabular', 'semibold'],
  )
  const request = previewRequestFromTokens(tokens)
  assert.equal(request.weight, 600)
  assert.equal(request.tabular, true)
  assert.equal(familyMatchesLibrarySearch(variableSans, '', tokens), false)
  assert.equal(familyMatchesLibrarySearch(variableSans, '', [tabular, bold]), true)
  const choice = cardPreviewFromRequest(
    [
      { weight: 400, italic: false, label: 'Regular' },
      { weight: 700, italic: false, label: 'Bold' },
    ],
    previewRequestFromTokens([bold, tabular]),
  )
  assert.equal(choice?.weight, 700)
  assert.equal(choice?.label, 'Bold')
  assert.match(choice?.featureSettings ?? '', /tnum/)
  assert.equal(cardPreviewFromRequest([{ label: 'Regular' }], previewRequestFromTokens([searchTokenById('variable')!])), null)
  assert.deepEqual(
    addSearchToken([searchTokenById('condensed')!], 'extended').map((token) => token.id),
    ['extended'],
  )
})

const filterCatalog = {
  tags: [
    { id: 'trial', name: 'Trial' },
    { id: 'open-source', name: 'Open Source' },
  ],
  foundries: ['Displaay', 'Font Bureau'],
}

test('search suggestions keep filters whose names the trailing letters begin', () => {
  const labels = (typed: string) => searchFilterSuggestions(typed, filterCatalog).map((item) => item.label)

  assert.deepEqual(labels('b'), [])
  const bo = labels('bo')
  assert.deepEqual(bo.slice(0, 3), ['Semibold', 'Bold', 'Extra Bold'])
  assert.equal(bo.length, 11)
  assert.equal(bo.includes('Bosnian'), true)
  assert.ok(labels('bold').includes('Bold'))
  assert.ok(labels('bold').includes('Extra Bold'))
  assert.deepEqual(labels('fig'), ['Tabular Figures', 'Old-Style Figures'])
  assert.deepEqual(labels('ital'), ['Italic', 'Italian'])
  assert.deepEqual(labels('old style'), ['Old-Style Figures'])
  assert.deepEqual(labels('sans'), ['Sans Serif', 'Sanskrit'])
  assert.deepEqual(labels('serif'), ['Serif'])
  assert.equal(labels('serif').includes('Sans Serif'), false)
  assert.deepEqual(labels('mono'), ['Monospaced'])
  assert.deepEqual(labels('hand'), ['Script'])
  assert.deepEqual(labels('disp'), ['Ornamental', 'Displaay'])
  assert.deepEqual(labels('tri'), ['Trial'])
  assert.deepEqual(labels('open'), ['Open Source'])
  assert.equal(labels('source').includes('Open Source'), false)
  assert.deepEqual(labels('wei').filter((label) => label !== 'Sans Serif'), [
    'Thin',
    'Extra Light',
    'Light',
    'Regular',
    'Medium',
    'Semibold',
    'Bold',
    'Extra Bold',
    'Black',
  ])

  const taken = searchFilterSuggestions('bold', { ...filterCatalog, chosenTokenIds: ['bold'] }).map((item) => item.label)
  assert.equal(taken.includes('Bold'), false)
  assert.equal(taken.includes('Extra Bold'), true)

  const sans = searchFilterSuggestions('review sans', filterCatalog).find((item) => item.label === 'Sans Serif')
  assert.equal(sans?.query, 'review')
  const italic = searchFilterSuggestions('Inter ital', filterCatalog).find((item) => item.label === 'Italic')
  assert.equal(italic?.query, 'Inter')
  const trial = searchFilterSuggestions('Inter tri', filterCatalog).find((item) => item.label === 'Trial')
  assert.equal(trial?.query, 'Inter Trial')
  const open = searchFilterSuggestions('Keep open sou', filterCatalog).find((item) => item.label === 'Open Source')
  assert.equal(open?.query, 'Keep Open Source')
})

test('choosing a suggestion applies that filter and keeps the rest of the query', () => {
  const italic = searchFilterSuggestions('Inter ital', filterCatalog).find((item) => item.kind === 'style')!
  const styled = applySearchSuggestion(italic, [], [])
  assert.equal(styled.text, 'Inter')
  assert.deepEqual(styled.tokens.map((token) => token.id), ['italic'])
  assert.deepEqual(styled.libraryFilters, [])

  const sans = searchFilterSuggestions('review sans', filterCatalog).find((item) => item.kind === 'classification')!
  const classified = applySearchSuggestion(sans, styled.tokens, [])
  assert.equal(classified.text, 'review')
  assert.deepEqual(classified.libraryFilters, ['classification:sans-serif'])
  assert.deepEqual(classified.tokens.map((token) => token.id), ['italic'])

  const foundry = searchFilterSuggestions('disp', filterCatalog).find((item) => item.kind === 'foundry')!
  const withFoundry = applySearchSuggestion(foundry, [], classified.libraryFilters)
  assert.equal(withFoundry.text, '')
  assert.deepEqual(withFoundry.libraryFilters, ['classification:sans-serif', 'foundry:Displaay'])

  const trial = searchFilterSuggestions('Keep tri', filterCatalog).find((item) => item.kind === 'tag')!
  const tagged = applySearchSuggestion(trial, styled.tokens, withFoundry.libraryFilters)
  assert.equal(tagged.text, 'Keep Trial')
  assert.deepEqual(tagged.tokens.map((token) => token.id), ['italic'])
  assert.deepEqual(tagged.libraryFilters, withFoundry.libraryFilters)

  const again = applySearchSuggestion(sans, [], classified.libraryFilters)
  assert.deepEqual(again.libraryFilters, ['classification:sans-serif'])
})

test('language and script suggestions follow the same filter tokens as classification', () => {
  const czech = searchFilterSuggestions('cze').find((item) => item.kind === 'language')
  assert.equal(czech?.label, 'Czech')
  assert.equal(czech?.filterId, 'language:ces')
  const chosen = applySearchSuggestion(czech!, [], [])
  assert.equal(chosen.text, '')
  assert.deepEqual(chosen.libraryFilters, ['language:ces'])
  const hidden = searchFilterSuggestions('czech', { chosenFilters: ['language:ces'] })
  assert.equal(hidden.some((item) => item.filterId === 'language:ces'), false)

  const german = searchFilterSuggestions('deutsch').find((item) => item.label === 'German')
  assert.equal(german?.filterId, 'language:deu')
  const cyrillic = searchFilterSuggestions('cyrillic').find((item) => item.kind === 'script')
  assert.equal(cyrillic?.label, 'Cyrillic')
  assert.equal(cyrillic?.filterId, 'script:Cyrillic')

  const many = searchFilterSuggestions('ch').filter((item) => item.kind === 'language')
  assert.ok(many.length >= 1)
  assert.ok(many.length <= 8)

  const covered: SearchFamily = {
    familyName: 'Reckless',
    faces: [{ familyName: 'Reckless', styleName: 'Regular', languages: ['ces'] }],
  }
  assert.equal(familyMatchesLibrarySearch(covered, 'czech'), true)
  assert.equal(familyMatchesLibrarySearch(covered, 'german'), false)
  assert.equal(familyMatchesLibrarySearch({ familyName: 'Czech Grotesk', faces: [] }, 'czech'), true)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addSearchToken,
  cardPreviewFromRequest,
  familyMatchesLibrarySearch,
  previewRequestFromTokens,
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
})

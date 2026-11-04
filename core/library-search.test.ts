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

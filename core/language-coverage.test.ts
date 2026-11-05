import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  COVERAGE_LANGUAGES,
  HYPERGLOT_VERSION,
  isCoverageLanguageId,
  isCoverageScript,
  languageIdForSearchTerm,
  coverageIgnoresOutline,
  mergeFaceLanguages,
  orthographyRequirements,
  supportedCoverage,
  supportedLanguageIds,
} from '../shared/language-coverage.ts'
import { isLibraryFilter } from '../shared/library-filters.ts'

test('the language list is Cicero’s Hyperglot 0.8.1 export', () => {
  assert.equal(HYPERGLOT_VERSION, '0.8.1')
  assert.equal(COVERAGE_LANGUAGES.length, 780)
  assert.equal(isCoverageLanguageId('eng'), true)
  assert.equal(isCoverageLanguageId('ces'), true)
  assert.equal(isCoverageLanguageId('nope'), false)
  assert.equal(isCoverageScript('Cyrillic'), true)
  assert.equal(isCoverageScript('Latin'), true)
  assert.equal(isLibraryFilter('language:ces'), true)
  assert.equal(isLibraryFilter('language:nope'), false)
  assert.equal(isLibraryFilter('script:Cyrillic'), true)
  assert.equal(isLibraryFilter('script:Not A Script'), false)
})

test('a language is supported when any orthography’s base characters and marks are present', () => {
  const [english] = orthographyRequirements('eng')
  assert.ok(english && english.length > 20)
  assert.equal(supportedLanguageIds(new Set(english)).includes('eng'), true)
  const missingLetter = new Set(english)
  missingLetter.delete(65)
  assert.equal(supportedLanguageIds(missingLetter).includes('eng'), false)

  const [latin, greek] = orthographyRequirements('aat')
  assert.ok(latin && greek && greek.length > 0)
  assert.equal(supportedLanguageIds(new Set(latin)).includes('aat'), true)
  assert.equal(supportedLanguageIds(new Set(greek)).includes('aat'), true)
  assert.deepEqual(supportedCoverage(new Set(latin)).scripts, ['Latin'])
  assert.deepEqual(supportedCoverage(new Set(greek)).scripts, ['Greek'])
  const neither = new Set(latin)
  neither.delete(latin[0]!)
  for (const code of greek) neither.delete(code)
  assert.equal(supportedLanguageIds(neither).includes('aat'), false)
})

test('an English base set does not cover Czech, and the search term is the language name', () => {
  const [english] = orthographyRequirements('eng')
  assert.ok(english)
  const supported = supportedLanguageIds(new Set(english))
  assert.equal(supported.includes('ces'), false)
  assert.equal(languageIdForSearchTerm('Czech'), 'ces')
  assert.equal(languageIdForSearchTerm('deutsch'), 'deu')
  assert.equal(languageIdForSearchTerm('cze'), undefined)
})

test('joiners and viramas count without an outline, letters do not', () => {
  assert.equal(coverageIgnoresOutline(0x20), true)
  assert.equal(coverageIgnoresOutline(0x200c), true)
  assert.equal(coverageIgnoresOutline(0x200d), true)
  assert.equal(coverageIgnoresOutline(0x094d), true)
  assert.equal(coverageIgnoresOutline(0x0b4d), true)
  assert.equal(coverageIgnoresOutline(0x2800), true)
  assert.equal(coverageIgnoresOutline(0x41), false)
  assert.equal(coverageIgnoresOutline(0x010d), false)
})

test('mergeFaceLanguages fills faces that have not been read yet', () => {
  const faces: { postscriptName: string; languages?: string[]; scripts?: string[] }[] = [
    { postscriptName: 'A-Regular' },
    { postscriptName: 'B-Regular', languages: ['eng'] },
  ]
  assert.equal(
    mergeFaceLanguages(faces, [{ postscriptName: 'A-Regular', languages: ['ces', 'deu'], scripts: ['Latin'] }]),
    true,
  )
  assert.deepEqual(faces[0]?.languages, ['ces', 'deu'])
  assert.deepEqual(faces[0]?.scripts, ['Latin'])
  assert.deepEqual(faces[1]?.languages, ['eng'])
  assert.equal(mergeFaceLanguages(faces, [{ postscriptName: 'A-Regular', languages: ['lat'] }]), false)
})

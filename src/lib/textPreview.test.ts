import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_TEXT_PREVIEW,
  DEFAULT_TEXT_PREVIEW_LANGUAGE,
  TEXT_PREVIEW_LANGUAGES,
  applyTextPreviewLanguage,
  estimateTextPreviewLines,
  textPreviewLanguage,
} from './textPreview.ts'

function includesLetters(text: string, letters: string) {
  const folded = text.normalize('NFC').toLocaleLowerCase('en')
  for (const letter of letters.normalize('NFC')) {
    assert.ok(
      folded.includes(letter.toLocaleLowerCase('en')),
      `${letter} missing from ${text}`,
    )
  }
}

test('the default sample is the English pangram', () => {
  assert.equal(TEXT_PREVIEW_LANGUAGES[0]?.id, DEFAULT_TEXT_PREVIEW_LANGUAGE)
  assert.equal(DEFAULT_TEXT_PREVIEW, 'The quick brown fox jumps over the lazy dog.')
  includesLetters(DEFAULT_TEXT_PREVIEW, 'abcdefghijklmnopqrstuvwxyz')
  assert.equal(applyTextPreviewLanguage('missing').id, 'en')
  assert.equal(applyTextPreviewLanguage('missing').text, DEFAULT_TEXT_PREVIEW)
})

test('each sample language has one real pangram, English first and the rest alphabetical', () => {
  const ids = TEXT_PREVIEW_LANGUAGES.map((language) => language.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(TEXT_PREVIEW_LANGUAGES.length >= 50)
  for (const language of TEXT_PREVIEW_LANGUAGES) {
    assert.ok(language.text.trim().length > 8, language.label)
    assert.equal(textPreviewLanguage(language.id).text, language.text)
  }
  const labels = TEXT_PREVIEW_LANGUAGES.slice(1).map((language) => language.label)
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, 'en')))
})

test('well-known pangrams keep the letters those alphabets need', () => {
  const text = (id: string) => textPreviewLanguage(id).text
  includesLetters(text('de'), 'abcdefghijklmnopqrstuvwxyzäöüß')
  includesLetters(text('cs'), 'abcdefghijklmnopqrstuvwxyzáčďéěíňóřšťúůýž')
  includesLetters(text('pl'), 'aąbcćdeęfghijklłmnńoóprsśtuwyzźż')
  includesLetters(text('es'), 'abcdefghijklmnopqrstuvwxyzáéíñóúü')
  includesLetters(text('tr'), 'abcçdefgğhıijklmnoöprsştuüvyz')
  includesLetters(text('da'), 'abcdefghijklmnopqrstuvwxyzæøå')
  includesLetters(text('fr'), 'abcdefghijklmnopqrstuvwxyz')
  includesLetters(text('it'), 'abcdefghilmnopqrstuvz')
  includesLetters(text('ru'), 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя')
  includesLetters(text('el'), 'αβγδεζηθκλμνξοπρστυφχψωί')
  assert.match(text('ja'), /いろはにほへと/)
  assert.match(text('ar'), /نص حكيم/)
  assert.equal(applyTextPreviewLanguage('fr').text, text('fr'))
})

test('longer samples estimate more text-preview rows', () => {
  assert.equal(estimateTextPreviewLines('Hi', 4), 1)
  assert.ok(estimateTextPreviewLines(DEFAULT_TEXT_PREVIEW.repeat(8), 4) > 1)
  assert.ok(estimateTextPreviewLines('字'.repeat(80), 6) > estimateTextPreviewLines('Hi', 6))
  assert.ok(estimateTextPreviewLines(DEFAULT_TEXT_PREVIEW, 6) >= estimateTextPreviewLines(DEFAULT_TEXT_PREVIEW, 2))
})

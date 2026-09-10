import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyLatinPreviewSample,
  DEFAULT_LATIN_PREVIEW_TEXT,
  isLatinDefaultSample,
  latinPreviewText,
  LATIN_PREVIEW_MAX_LENGTH,
  normalizeLatinPreviewCustom,
  parseLatinPreview,
} from './latinPreview.ts'

test('latinPreviewText uses presets and falls back to Aa', () => {
  assert.equal(latinPreviewText(undefined), 'Aa')
  assert.equal(latinPreviewText(null), 'Aa')
  assert.equal(latinPreviewText({ preset: 'Ag', custom: 'Hi' }), 'Ag')
  assert.equal(latinPreviewText({ preset: 'Ta', custom: '' }), 'Ta')
  assert.equal(latinPreviewText({ preset: 'ag', custom: '' }), 'ag')
  assert.equal(latinPreviewText({ preset: 'Aa', custom: 'Ag' }), 'Aa')
})

test('latinPreviewText uses trimmed custom and falls back when empty', () => {
  assert.equal(latinPreviewText({ preset: 'custom', custom: '  Ag  ' }), 'Ag')
  assert.equal(latinPreviewText({ preset: 'custom', custom: '' }), DEFAULT_LATIN_PREVIEW_TEXT)
  assert.equal(latinPreviewText({ preset: 'custom', custom: '   ' }), DEFAULT_LATIN_PREVIEW_TEXT)
})

test('normalizeLatinPreviewCustom trims, collapses whitespace, and caps length', () => {
  assert.equal(normalizeLatinPreviewCustom('  A  g  '), 'A g')
  assert.equal(normalizeLatinPreviewCustom('abcdefghijk'), 'abcdefgh'.slice(0, LATIN_PREVIEW_MAX_LENGTH))
  assert.equal(normalizeLatinPreviewCustom(12), '')
})

test('parseLatinPreview ignores junk and keeps custom when switching presets', () => {
  assert.equal(parseLatinPreview(null), undefined)
  assert.equal(parseLatinPreview({ preset: 'nope', custom: 'Hi' }), undefined)
  assert.deepEqual(parseLatinPreview({ preset: 'Ag' }), { preset: 'Ag', custom: '' })
  assert.deepEqual(parseLatinPreview({ preset: 'custom', custom: '  Hello world  ' }), {
    preset: 'custom',
    custom: 'Hello wo',
  })
})

test('applyLatinPreviewSample substitutes Latin defaults only', () => {
  assert.equal(applyLatinPreviewSample('Aa', 'Ag'), 'Ag')
  assert.equal(applyLatinPreviewSample('AA', 'Ta'), 'Ta')
  assert.equal(applyLatinPreviewSample('aa', 'ag'), 'ag')
  assert.equal(applyLatinPreviewSample(undefined, 'Ag'), 'Ag')
  assert.equal(applyLatinPreviewSample('', 'Ag'), 'Ag')
  assert.equal(applyLatinPreviewSample('א', 'Ag'), 'א')
  assert.equal(applyLatinPreviewSample('ع', 'Ag'), 'ع')
  assert.equal(applyLatinPreviewSample('동', 'Ag'), '동')
})

test('isLatinDefaultSample matches catalog Latin samples', () => {
  assert.equal(isLatinDefaultSample('Aa'), true)
  assert.equal(isLatinDefaultSample('AA'), true)
  assert.equal(isLatinDefaultSample('aa'), true)
  assert.equal(isLatinDefaultSample('Ag'), false)
  assert.equal(isLatinDefaultSample('א'), false)
})

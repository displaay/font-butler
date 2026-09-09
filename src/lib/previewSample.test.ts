import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PREVIEW_SAMPLE, previewSampleFromCoverage } from './previewSample.ts'

function codes(...chars: string[]): number[] {
  return chars.flatMap((text) => [...text].map((char) => char.codePointAt(0)!))
}

function latin(): number[] {
  return codes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz')
}

test('Latin coverage uses Aa, or AA when the font is caps-only', () => {
  assert.equal(previewSampleFromCoverage(latin()), 'Aa')
  assert.equal(previewSampleFromCoverage(codes('A')), 'AA')
  assert.equal(previewSampleFromCoverage(codes('a')), 'aa')
  assert.equal(previewSampleFromCoverage([]), DEFAULT_PREVIEW_SAMPLE)
  assert.equal(previewSampleFromCoverage(undefined), DEFAULT_PREVIEW_SAMPLE)
})

test('Hebrew coverage uses Alef even when Latin is also present', () => {
  assert.equal(previewSampleFromCoverage(codes('אבגדהו')), 'א')
  assert.equal(previewSampleFromCoverage([...latin(), ...codes('אבגדהו')]), 'א')
})

test('Arabic coverage uses Ain even when Latin is also present', () => {
  assert.equal(previewSampleFromCoverage(codes('ابتجدرسعلمني')), 'ع')
  assert.equal(previewSampleFromCoverage([...latin(), ...codes('ابتجدرسعلمني')]), 'ع')
})

test('Hangul coverage uses 동', () => {
  assert.equal(previewSampleFromCoverage(codes('동가나다라마바사아자하')), '동')
  assert.equal(previewSampleFromCoverage([...latin(), ...codes('동가나다라마바사아자하')]), '동')
})

test('emoji coverage uses the grinning face', () => {
  assert.equal(previewSampleFromCoverage(codes('😀')), '😀')
  assert.equal(previewSampleFromCoverage([...latin(), ...codes('😀')]), '😀')
})

test('symbol coverage uses Font Book-style ornament glyphs', () => {
  assert.equal(previewSampleFromCoverage(codes('☎☺★')), '☎☺')
  assert.equal(previewSampleFromCoverage([0xf000, 0xf0a8]), '\uF000')
})

test('Thai, Bengali, Devanagari, Braille, and CJK pick Font Book representatives', () => {
  assert.equal(previewSampleFromCoverage(codes('กขคงจดตทนบม')), 'ก')
  assert.equal(previewSampleFromCoverage(codes('কখগঘঙচজটডন')), 'ক')
  assert.equal(previewSampleFromCoverage(codes('कखगघङचजटडण')), 'क')
  assert.equal(previewSampleFromCoverage(codes('⠓⠁⠃⠉⠙⠑')), '⠓')
  assert.equal(previewSampleFromCoverage(codes('永漢一二三人日')), '永')
  assert.equal(previewSampleFromCoverage(codes('あいうえおアイウエオ')), 'あ')
})

test('multi-script pan-Unicode fonts keep Latin Aa as the primary', () => {
  assert.equal(
    previewSampleFromCoverage([
      ...latin(),
      ...codes('אבגדהו'),
      ...codes('ابتجدرسعلمني'),
      ...codes('동가나다라마바사아자하'),
    ]),
    'Aa',
  )
})

test('Greek and Cyrillic ride with Latin instead of replacing Aa', () => {
  assert.equal(previewSampleFromCoverage([...latin(), ...codes('ΑαΒβΓγΟο'), ...codes('АаБбВвОо')]), 'Aa')
  assert.equal(previewSampleFromCoverage(codes('ΑαΒβΓγΟο')), 'Αα')
})

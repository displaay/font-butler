import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_PREVIEW_SAMPLE,
  previewSampleFromCoverage,
  resolvedPreviewSample,
} from './previewSample.ts'

function codes(...chars: string[]): number[] {
  return chars.flatMap((text) => [...text].map((char) => char.codePointAt(0)!))
}

function latin(): number[] {
  return codes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz')
}

/** Locked product matrix: primary-script glyph, including with incidental Latin. */
const PRODUCT_MATRIX: Array<{ name: string; coverage: string; sample: string }> = [
  { name: 'Arabic', coverage: 'ابتجدرسعلمني', sample: 'ع' },
  { name: 'Hebrew', coverage: 'אבגדהו', sample: 'א' },
  { name: 'Hangul', coverage: '동가나다라마바사아자하', sample: '동' },
  { name: 'Thai', coverage: 'กขคงจดตทนบม', sample: 'ก' },
  { name: 'Bengali', coverage: 'কখগঘঙচজটডন', sample: 'ক' },
  { name: 'Devanagari', coverage: 'कखगघङचजटडण', sample: 'क' },
]

test('product matrix: Arabic ع · Hebrew א · Hangul 동 · Thai ก · Bengali ক · Devanagari क', () => {
  for (const row of PRODUCT_MATRIX) {
    assert.equal(previewSampleFromCoverage(codes(row.coverage)), row.sample, row.name)
    assert.equal(
      previewSampleFromCoverage([...latin(), ...codes(row.coverage)]),
      row.sample,
      `${row.name} with incidental Latin must not flash Aa`,
    )
  }
})

test('product matrix: emoji 😀-class', () => {
  assert.equal(previewSampleFromCoverage(codes('😀')), '😀')
  assert.equal(previewSampleFromCoverage([...latin(), ...codes('😀')]), '😀')
  assert.equal(previewSampleFromCoverage([...latin(), ...codes('😂')]), '😂')
})

test('product matrix: ornaments/symbols use a covered dingbat', () => {
  assert.equal(previewSampleFromCoverage(codes('☎☺')), '☎☺')
  assert.equal(previewSampleFromCoverage([0x273f]), '✿')
  assert.equal(previewSampleFromCoverage([0xf000, 0xf0a8]), '\uF000')
})

test('Latin-primary faces use Aa, including pan-Unicode like Arial Unicode MS', () => {
  assert.equal(previewSampleFromCoverage(latin()), 'Aa')
  assert.equal(previewSampleFromCoverage(codes('A')), 'AA')
  assert.equal(previewSampleFromCoverage([]), DEFAULT_PREVIEW_SAMPLE)
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

test('grid and list resolve missing coverage to Aa', () => {
  assert.equal(resolvedPreviewSample('ع'), 'ع')
  assert.equal(resolvedPreviewSample(undefined, 'א'), 'א')
  assert.equal(resolvedPreviewSample(undefined, null, ''), DEFAULT_PREVIEW_SAMPLE)
})

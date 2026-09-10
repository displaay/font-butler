import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bakeableEnabledTags, bakeReportWarnings, groupOtFeatures, normalizeFeatureTag, suggestedBakeFamilyName } from './otFeatures.ts'

test('normalizeFeatureTag keeps four-character tags and maps friendly names', () => {
  assert.equal(normalizeFeatureTag('ss03'), 'ss03')
  assert.equal(normalizeFeatureTag('SS1'), 'ss01')
  assert.equal(normalizeFeatureTag('Stylistic Set 1'), 'ss01')
  assert.equal(normalizeFeatureTag('Oldstyle figures'), 'onum')
  assert.equal(normalizeFeatureTag('liga'), 'liga')
  assert.equal(normalizeFeatureTag(''), null)
})

test('groupOtFeatures uses tags only and buckets stylistic sets, figures, and the rest', () => {
  const groups = groupOtFeatures([
    'liga',
    'Stylistic Set 1',
    'ss03',
    'onum',
    'Tabular figures',
    'kern',
    'ss01',
  ])
  assert.deepEqual(
    groups.map((group) => [group.id, group.tags]),
    [
      ['stylistic', ['ss01', 'ss03']],
      ['figures', ['onum', 'tnum']],
      ['rest', ['liga', 'kern']],
    ],
  )
})

test('bakeableEnabledTags keeps tnum and stylistic sets and ignores other features', () => {
  assert.deepEqual(
    bakeableEnabledTags({ liga: true, tnum: true, ss02: true, onum: true, ss01: false }),
    ['tnum', 'ss02'],
  )
  assert.deepEqual(bakeableEnabledTags({ liga: true, zero: true }), [])
})

test('suggestedBakeFamilyName appends bakeable tags in stable order', () => {
  assert.equal(suggestedBakeFamilyName('Fenul', ['ss01', 'tnum']), 'Fenul Tnum SS01')
})

test('bakeReportWarnings merges skipped and general warnings without duplicates', () => {
  assert.deepEqual(
    bakeReportWarnings({
      skippedWarnings: ['Skipped ss20', 'Metric changes detected'],
      warnings: ['Positioning was not swapped', 'Metric changes detected'],
    }),
    ['Positioning was not swapped', 'Metric changes detected', 'Skipped ss20'],
  )
})

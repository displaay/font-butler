import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GLYPH_GROUP_GAP,
  GLYPH_GROUP_HEADER_HEIGHT,
  clampGlyphCellSize,
  codePointLabel,
  displayableCodePoints,
  fallbackGlyphName,
  filterGlyphs,
  glyphCharacter,
  glyphFontSize,
  glyphGridLayout,
  glyphGroupId,
  glyphLayoutOffsets,
  glyphSectionRows,
  groupGlyphs,
  htmlCode,
  visibleGlyphRowRange,
} from './glyphs.ts'

test('displayableCodePoints drops controls and DEL', () => {
  assert.deepEqual(displayableCodePoints(undefined), [])
  assert.deepEqual(displayableCodePoints([]), [])
  assert.deepEqual(
    displayableCodePoints([0, 9, 31, 32, 65, 65, 127, 233]),
    [32, 65, 233],
  )
})

test('codePointLabel pads a unicode hex value', () => {
  assert.equal(codePointLabel(65), 'U+0041')
  assert.equal(codePointLabel(25991), 'U+6587')
})

test('htmlCode writes a hex HTML entity', () => {
  assert.equal(htmlCode(65), '&#x41;')
  assert.equal(htmlCode(233), '&#xE9;')
})

test('glyphCharacter returns the character for a code point', () => {
  assert.equal(glyphCharacter(65), 'A')
  assert.equal(glyphCharacter(32), ' ')
})

test('fallbackGlyphName names latin, digits, CJK, and Hangul', () => {
  assert.equal(fallbackGlyphName(32), 'SPACE')
  assert.equal(fallbackGlyphName(65), 'LATIN CAPITAL LETTER A')
  assert.equal(fallbackGlyphName(98), 'LATIN SMALL LETTER B')
  assert.equal(fallbackGlyphName(51), 'DIGIT THREE')
  assert.equal(fallbackGlyphName(0x4e00), 'CJK UNIFIED IDEOGRAPH-4E00')
  assert.equal(fallbackGlyphName(0xac00), 'HANGUL SYLLABLE GA')
})

test('clampGlyphCellSize snaps to the slider step', () => {
  assert.equal(glyphFontSize(56), 24)
  assert.equal(clampGlyphCellSize(56), 56)
  assert.equal(clampGlyphCellSize(41), 40)
  assert.equal(clampGlyphCellSize(Number.NaN), 56)
})

test('glyphGridLayout fills the row with equal tracks', () => {
  assert.deepEqual(glyphGridLayout(500, 56, 6), { columns: 8, track: 57.25 })
  assert.deepEqual(glyphGridLayout(0, 56, 6), { columns: 1, track: 56 })
  assert.equal(glyphGridLayout(40, 56, 6).columns, 1)
  assert.equal(glyphGridLayout(40, 56, 6).track, 40)
})

test('glyphGroupId buckets letters, digits, currency, and punctuation', () => {
  assert.equal(glyphGroupId(65), 'uppercase')
  assert.equal(glyphGroupId(201), 'uppercase')
  assert.equal(glyphGroupId(97), 'lowercase')
  assert.equal(glyphGroupId(233), 'lowercase')
  assert.equal(glyphGroupId(48), 'numbers')
  assert.equal(glyphGroupId(0x20ac), 'currencies')
  assert.equal(glyphGroupId(36), 'currencies')
  assert.equal(glyphGroupId(33), 'punctuation')
  assert.equal(glyphGroupId(43), 'symbols')
  assert.equal(glyphGroupId(32), 'spaces')
  assert.equal(glyphGroupId(0x0391), 'greek')
  assert.equal(glyphGroupId(0x0410), 'cyrillic')
  assert.equal(glyphGroupId(0x4e00), 'cjk')
  assert.equal(glyphGroupId(0xe001), 'private-use')
})

test('groupGlyphs skips empty sections and keeps display order', () => {
  const groups = groupGlyphs([0x4e00, 97, 36, 65, 48])
  assert.deepEqual(
    groups.map((group) => group.id),
    ['uppercase', 'lowercase', 'numbers', 'currencies', 'cjk'],
  )
  assert.deepEqual(groups[0]!.codes, [65])
})

test('glyphSectionRows keeps short last rows in their own group', () => {
  const rows = glyphSectionRows(groupGlyphs([65, 66, 67, 97]), 2)
  assert.deepEqual(rows, [
    { kind: 'header', id: 'uppercase', label: 'Uppercase', count: 3 },
    { kind: 'cells', codes: [65, 66] },
    { kind: 'cells', codes: [67] },
    { kind: 'header', id: 'lowercase', label: 'Lowercase', count: 1 },
    { kind: 'cells', codes: [97] },
  ])
})

test('visibleGlyphRowRange accounts for mixed header and cell heights', () => {
  const rows = glyphSectionRows(groupGlyphs([65, 66, 67, 68, 97, 98]), 2)
  const { tops, totalHeight } = glyphLayoutOffsets(rows, 50)
  assert.equal(tops[0], 0)
  assert.equal(tops[1], GLYPH_GROUP_HEADER_HEIGHT)
  assert.equal(tops[3], GLYPH_GROUP_HEADER_HEIGHT + 100 + GLYPH_GROUP_GAP)
  assert.equal(totalHeight, GLYPH_GROUP_HEADER_HEIGHT * 2 + 150 + GLYPH_GROUP_GAP)
  assert.deepEqual(visibleGlyphRowRange(rows, tops, 0, 40, 50, 0), { start: 0, end: 2 })
  assert.deepEqual(visibleGlyphRowRange(rows, tops, 100, 40, 50, 0), { start: 2, end: 3 })
  assert.deepEqual(visibleGlyphRowRange(rows, tops, 110, 40, 50, 0), { start: 2, end: 4 })
})

test('filterGlyphs matches prefix unless contain is on', () => {
  const points = [65, 66, 97, 32]
  assert.deepEqual(filterGlyphs(points, '', false), points)
  assert.deepEqual(filterGlyphs(points, 'A', false), [65, 97])
  assert.deepEqual(filterGlyphs(points, 'latin', false), [65, 66, 97])
  assert.deepEqual(filterGlyphs(points, 'letter', false), [])
  assert.deepEqual(filterGlyphs(points, 'letter', true), [65, 66, 97])
  assert.deepEqual(filterGlyphs(points, '0041', false), [65])
  assert.deepEqual(filterGlyphs(points, 'capital', true), [65, 66])
})

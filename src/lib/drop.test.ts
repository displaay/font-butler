import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isDroppedFontName, shouldSkipDroppedName } from './drop.ts'

test('isDroppedFontName accepts common font extensions', () => {
  assert.equal(isDroppedFontName('Family-Bold.ttf'), true)
  assert.equal(isDroppedFontName('Family.OTF'), true)
  assert.equal(isDroppedFontName('Family.woff2'), true)
  assert.equal(isDroppedFontName('notes.txt'), false)
  assert.equal(isDroppedFontName('Family'), false)
})

test('shouldSkipDroppedName ignores hidden and junk folders', () => {
  assert.equal(shouldSkipDroppedName('.DS_Store'), true)
  assert.equal(shouldSkipDroppedName('__MACOSX'), true)
  assert.equal(shouldSkipDroppedName('Desktop'), false)
})

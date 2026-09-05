import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fontDragCountLabel } from './dragPreview.ts'

test('fontDragCountLabel names a multi-font drag', () => {
  assert.equal(fontDragCountLabel(1), '1 font')
  assert.equal(fontDragCountLabel(3), '3 fonts')
})

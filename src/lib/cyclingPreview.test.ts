import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paintedPreviewIndices } from './cyclingPreview.ts'

test('resting cards only paint the visible preview face', () => {
  assert.deepEqual(paintedPreviewIndices(8, 2, false), [2])
  assert.deepEqual(paintedPreviewIndices(1, 0, true), [0])
  assert.deepEqual(paintedPreviewIndices(0, 0, true), [])
})

test('cycling paints the previous and next faces for a crossfade', () => {
  assert.deepEqual(paintedPreviewIndices(4, 1, true).sort(), [0, 1, 2])
  assert.deepEqual(paintedPreviewIndices(4, 0, true).sort(), [0, 1, 3])
  assert.deepEqual(paintedPreviewIndices(2, 0, true).sort(), [0, 1])
})

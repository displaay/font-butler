import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classificationOfFace, classifyFont } from '../shared/font-classification.ts'

test('classifyFont prefers the IBM family class over a contradictory name', () => {
  assert.equal(
    classifyFont({ sFamilyClass: 0x0800, names: ['Reckless Serif'] }),
    'sans-serif',
  )
  assert.equal(classifyFont({ sFamilyClass: 0x0500, names: ['Slab'] }), 'serif')
  assert.equal(classifyFont({ names: ['Sanskrit Display'] }), null)
  assert.equal(classifyFont({ names: ['Comic Sans'] }), 'sans-serif')
  assert.equal(classifyFont({ names: ['Office Mono'] }), 'monospaced')
  assert.equal(classifyFont({ names: ['Reckless'] }), null)
  assert.equal(classifyFont({ panose: [2, 11, 5, 3] }), 'sans-serif')
  assert.equal(classifyFont({ panose: [2, 2, 5, 9] }), 'monospaced')
})

test('a stored empty classification is not re-derived from the name', () => {
  assert.equal(
    classificationOfFace({
      classification: null,
      familyName: 'Office Mono',
      styleName: 'Regular',
    }),
    null,
  )
  assert.equal(
    classificationOfFace({
      familyName: 'Office Mono',
      styleName: 'Regular',
    }),
    'monospaced',
  )
})

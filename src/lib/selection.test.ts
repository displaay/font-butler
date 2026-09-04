import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isTypingTarget, nextSelection, shortcutAction } from './selection.ts'

test('nextSelection replaces the set on a plain click', () => {
  assert.deepEqual(
    nextSelection(['A', 'B', 'C'], ['A'], 'C', {}, 'A'),
    ['C'],
  )
})

test('nextSelection toggles extra families', () => {
  assert.deepEqual(
    nextSelection(['A', 'B', 'C'], ['A'], 'C', { toggle: true }, 'A'),
    ['A', 'C'],
  )
  assert.deepEqual(
    nextSelection(['A', 'B', 'C'], ['A', 'C'], 'C', { toggle: true }, 'A'),
    ['A'],
  )
})

test('nextSelection keeps the last family when toggling it off', () => {
  assert.deepEqual(
    nextSelection(['A', 'B'], ['B'], 'B', { toggle: true }, 'B'),
    ['B'],
  )
})

test('nextSelection ranges from the anchor', () => {
  assert.deepEqual(
    nextSelection(['A', 'B', 'C', 'D'], ['B'], 'D', { range: true }, 'B'),
    ['B', 'C', 'D'],
  )
})

test('shortcutAction maps keys and ignores typing', () => {
  const key = (partial: Partial<KeyboardEvent>): KeyboardEvent =>
    ({
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      target: null,
      ...partial,
    }) as KeyboardEvent

  assert.equal(shortcutAction(key({ key: 'Backspace' })), 'remove')
  assert.equal(shortcutAction(key({ key: 'Delete' })), 'remove')
  assert.equal(shortcutAction(key({ key: 'i' })), 'install')
  assert.equal(shortcutAction(key({ key: 'd' })), 'deactivate')
  assert.equal(shortcutAction(key({ key: 'i', metaKey: true })), null)
  assert.equal(shortcutAction(key({ key: 'a', metaKey: true })), 'selectAll')
  assert.equal(shortcutAction(key({ key: 'a' })), null)
  assert.equal(isTypingTarget(null), false)
})

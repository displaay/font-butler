import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clientRect,
  isTypingTarget,
  keysInMarquee,
  mergeMarqueeSelection,
  nextSelection,
  rectsIntersect,
  shortcutAction,
} from './selection.ts'

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

test('nextSelection clears selection when toggling the last family off', () => {
  assert.deepEqual(
    nextSelection(['A', 'B'], ['B'], 'B', { toggle: true }, 'B'),
    [],
  )
})

test('nextSelection ranges from the anchor', () => {
  assert.deepEqual(
    nextSelection(['A', 'B', 'C', 'D'], ['B'], 'D', { range: true }, 'B'),
    ['B', 'C', 'D'],
  )
})

test('clientRect normalizes a drag box', () => {
  assert.deepEqual(clientRect(10, 20, 4, 8), { left: 4, top: 8, right: 10, bottom: 20 })
})

test('rectsIntersect detects overlap', () => {
  assert.equal(
    rectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 8, top: 8, right: 20, bottom: 20 }),
    true,
  )
  assert.equal(
    rectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 }),
    false,
  )
})

test('keysInMarquee returns overlapping cards', () => {
  assert.deepEqual(
    keysInMarquee(
      [
        { key: 'A', rect: { left: 0, top: 0, right: 40, bottom: 40 } },
        { key: 'B', rect: { left: 50, top: 0, right: 90, bottom: 40 } },
        { key: 'C', rect: { left: 0, top: 50, right: 40, bottom: 90 } },
      ],
      { left: 30, top: 10, right: 70, bottom: 30 },
    ),
    ['A', 'B'],
  )
})

test('mergeMarqueeSelection replaces or adds', () => {
  assert.deepEqual(mergeMarqueeSelection(['A'], ['B', 'C'], false), ['B', 'C'])
  assert.deepEqual(mergeMarqueeSelection(['A'], ['B', 'A'], true), ['A', 'B'])
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

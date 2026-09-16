import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clientRect,
  clientToContent,
  intersectRects,
  isTypingTarget,
  keysInMarquee,
  marqueeClientRect,
  mergeMarqueeSelection,
  nextSelection,
  pointerUpClearsSelection,
  rectsIntersect,
  sameKeys,
  shortcutAction,
  viewportClientRect,
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

test('sameKeys compares ordered key lists', () => {
  assert.equal(sameKeys(['A', 'B'], ['A', 'B']), true)
  assert.equal(sameKeys(['A', 'B'], ['B', 'A']), false)
  assert.equal(sameKeys(['A'], ['A', 'B']), false)
  assert.equal(sameKeys([], []), true)
})

test('clientRect normalizes a drag box', () => {
  assert.deepEqual(clientRect(10, 20, 4, 8), { left: 4, top: 8, right: 10, bottom: 20 })
})

test('scrolling while dragging enlarges the marquee instead of sliding it', () => {
  const origin = { left: 100, top: 80, width: 400, height: 500, scrollLeft: 0, scrollTop: 0 }
  const start = clientToContent(140, 200, origin)
  const before = marqueeClientRect(start.x, start.y, 180, 280, origin)
  assert.deepEqual(before, { left: 140, top: 200, right: 180, bottom: 280 })

  const scrolled = { ...origin, scrollTop: 150 }
  const after = marqueeClientRect(start.x, start.y, 180, 280, scrolled)
  assert.deepEqual(after, { left: 140, top: 50, right: 180, bottom: 280 })
  assert.equal(after.bottom - after.top, 230)
  assert.equal(before.bottom - before.top, 80)

  const visible = intersectRects(after, viewportClientRect(scrolled))
  assert.deepEqual(visible, { left: 140, top: 80, right: 180, bottom: 280 })

  const startCard = { key: 'Start', rect: { left: 140, top: 50, right: 180, bottom: 90 } }
  const laterCard = { key: 'Later', rect: { left: 140, top: 240, right: 180, bottom: 280 } }
  assert.deepEqual(keysInMarquee([startCard, laterCard], after), ['Start', 'Later'])
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

test('pointerUpClearsSelection only clears empty primary clicks', () => {
  const empty = {
    marqueeActive: false,
    downPreserves: false,
    contextMenuOpened: false,
    button: 0,
    upPreserves: false,
  }
  assert.equal(pointerUpClearsSelection(empty), true)
  assert.equal(pointerUpClearsSelection({ ...empty, downPreserves: true }), false)
  assert.equal(pointerUpClearsSelection({ ...empty, contextMenuOpened: true }), false)
  assert.equal(pointerUpClearsSelection({ ...empty, button: 2 }), false)
  assert.equal(pointerUpClearsSelection({ ...empty, upPreserves: true }), false)
  assert.equal(pointerUpClearsSelection({ ...empty, marqueeActive: true }), false)
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
  assert.equal(shortcutAction(key({ key: 'Enter' })), 'inspect')
  assert.equal(shortcutAction(key({ key: 'Escape' })), 'collapse')
  assert.equal(shortcutAction(key({ key: 'f' })), 'specimen')
  assert.equal(shortcutAction(key({ key: 'i', metaKey: true })), null)
  assert.equal(shortcutAction(key({ key: 'a', metaKey: true })), 'selectAll')
  assert.equal(shortcutAction(key({ key: 'a' })), null)
  assert.equal(isTypingTarget(null), false)
})

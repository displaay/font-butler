import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_KEY,
  clampSidebarWidth,
  readSidebarWidth,
  sidebarWidthBounds,
  writeSidebarWidth,
} from './sidebarWidth.ts'

const stored = new Map<string, string>()

function installStorage() {
  stored.clear()
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value)
      },
    },
  })
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

test('clampSidebarWidth keeps a valid width and rejects junk', () => {
  const viewport = 1400
  assert.equal(clampSidebarWidth(300, viewport), 300)
  assert.equal(clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, viewport), SIDEBAR_DEFAULT_WIDTH)
  assert.equal(clampSidebarWidth(SIDEBAR_MIN_WIDTH - 40, viewport), SIDEBAR_MIN_WIDTH)
  assert.equal(clampSidebarWidth(SIDEBAR_MAX_WIDTH + 200, viewport), SIDEBAR_MAX_WIDTH)
  assert.equal(clampSidebarWidth(Number.NaN, viewport), SIDEBAR_DEFAULT_WIDTH)
  assert.equal(clampSidebarWidth(Number.POSITIVE_INFINITY, viewport), SIDEBAR_DEFAULT_WIDTH)
  assert.equal(clampSidebarWidth(224.4, viewport), 224)
})

test('clampSidebarWidth caps the sidebar against the viewport', () => {
  assert.deepEqual(sidebarWidthBounds(1400), { min: SIDEBAR_MIN_WIDTH, max: SIDEBAR_MAX_WIDTH })
  assert.equal(clampSidebarWidth(400, 700), 220)
  assert.equal(clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, 640), 160)
  assert.deepEqual(sidebarWidthBounds(640), { min: 160, max: 160 })
  assert.equal(clampSidebarWidth(10, 640), 160)
})

test('readSidebarWidth clamps stored values and falls back when they are corrupt', () => {
  installStorage()
  const viewport = 1400
  assert.equal(readSidebarWidth(viewport), SIDEBAR_DEFAULT_WIDTH)
  writeSidebarWidth(280)
  assert.equal(stored.get(SIDEBAR_WIDTH_KEY), '280')
  assert.equal(readSidebarWidth(viewport), 280)
  stored.set(SIDEBAR_WIDTH_KEY, '12')
  assert.equal(readSidebarWidth(viewport), SIDEBAR_MIN_WIDTH)
  stored.set(SIDEBAR_WIDTH_KEY, '9999')
  assert.equal(readSidebarWidth(viewport), SIDEBAR_MAX_WIDTH)
  stored.set(SIDEBAR_WIDTH_KEY, 'nope')
  assert.equal(readSidebarWidth(viewport), SIDEBAR_DEFAULT_WIDTH)
  stored.set(SIDEBAR_WIDTH_KEY, '   ')
  assert.equal(readSidebarWidth(viewport), SIDEBAR_DEFAULT_WIDTH)
  stored.set(SIDEBAR_WIDTH_KEY, '360')
  assert.equal(readSidebarWidth(700), 220)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SHOW_TOTALS_KEY,
  readShowTotals,
  setShowTotal,
  watchShowTotalId,
  writeShowTotals,
} from './showTotals.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem(key: string) {
      return Object.hasOwn(data, key) ? data[key] : null
    },
    setItem(key: string, value: string) {
      data[key] = value
    },
  }
}

test('readShowTotals is empty by default', () => {
  assert.deepEqual(readShowTotals(memoryStorage()), {})
})

test('readShowTotals ignores invalid stored values', () => {
  assert.deepEqual(readShowTotals(memoryStorage({ [SHOW_TOTALS_KEY]: '{' })), {})
  assert.deepEqual(readShowTotals(memoryStorage({ [SHOW_TOTALS_KEY]: '[]' })), {})
  assert.deepEqual(
    readShowTotals(memoryStorage({ [SHOW_TOTALS_KEY]: '{"library":true,"system":"yes"}' })),
    { library: true },
  )
})

test('setShowTotal turns an item on and off', () => {
  const on = setShowTotal({}, 'library', true)
  assert.deepEqual(on, { library: true })
  assert.deepEqual(setShowTotal(on, 'library', false), {})
})

test('writeShowTotals persists the map', () => {
  const storage = memoryStorage()
  writeShowTotals({ system: true }, storage)
  assert.deepEqual(readShowTotals(storage), { system: true })
})

test('watchShowTotalId normalizes folder paths', () => {
  assert.equal(watchShowTotalId('/Users/you/Fonts/Inbox/'), 'watch:/Users/you/Fonts/Inbox')
})

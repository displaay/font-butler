import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatAddedAt } from './dates.ts'

test('formatAddedAt returns a locale date and time', () => {
  const label = formatAddedAt(Date.UTC(2026, 8, 8, 11, 28), 'en-GB')
  assert.match(label, /8/)
  assert.match(label, /2026/)
  assert.match(label, /\d{1,2}:\d{2}/)
})

test('formatAddedAt is empty for missing timestamps', () => {
  assert.equal(formatAddedAt(0), '')
  assert.equal(formatAddedAt(Number.NaN), '')
})

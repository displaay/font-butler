import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatMissingCharacters, missingCodePoints } from './coverage.ts'

test('missingCodePoints reports unsupported specimen characters', () => {
  const ascii = Array.from({ length: 95 }, (_, index) => 32 + index)
  assert.deepEqual(missingCodePoints('ABC', ascii), [])
  assert.deepEqual(missingCodePoints('A文B', [65, 66]), [25991])
  assert.equal(formatMissingCharacters([25991]), '文')
})

test('missingCodePoints ignores spaces and empty character sets', () => {
  assert.deepEqual(missingCodePoints('A B', undefined), [])
  assert.deepEqual(missingCodePoints('A B', []), [])
})

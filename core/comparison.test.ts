import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertExpectedSourceFingerprint, COMPARISON_STALE_ERROR } from './comparison.ts'

test('assertExpectedSourceFingerprint allows matching or omitted captures', () => {
  assert.doesNotThrow(() => assertExpectedSourceFingerprint('abc', undefined))
  assert.doesNotThrow(() => assertExpectedSourceFingerprint('abc', 'abc'))
})

test('assertExpectedSourceFingerprint refuses a drifted live source', () => {
  assert.throws(() => assertExpectedSourceFingerprint('new-bytes', 'reviewed'), {
    message: COMPARISON_STALE_ERROR,
  })
  assert.throws(() => assertExpectedSourceFingerprint(undefined, 'reviewed'), {
    message: COMPARISON_STALE_ERROR,
  })
})

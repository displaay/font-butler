import assert from 'node:assert/strict'
import test from 'node:test'
import { prefersReducedMotion } from './confettiBurst.ts'

test('prefersReducedMotion follows the media query', () => {
  assert.equal(prefersReducedMotion({ matches: true } as MediaQueryList), true)
  assert.equal(prefersReducedMotion({ matches: false } as MediaQueryList), false)
})

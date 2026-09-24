import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createDebugLogStore,
  DEBUG_LOG_RING_MAX,
  redactDebugLogLine,
} from './debug-log.mjs'

test('debug log ring buffer drops oldest lines', () => {
  const store = createDebugLogStore({ ringMax: 3 })
  store.append('main', 'one')
  store.append('main', 'two')
  store.append('main', 'three')
  store.append('main', 'four')
  const snap = store.getSnapshot()
  assert.equal(snap.length, 3)
  assert.match(snap[0], /two/)
  assert.match(snap[2], /four/)
})

test('redactDebugLogLine removes bearer and registered secrets', () => {
  const token = 'super-secret-api-token-value-12345'
  const line = `GET /api/catalog Authorization: Bearer ${token} retail ${token}`
  const redacted = redactDebugLogLine(line, [token])
  assert.match(redacted, /Bearer \[redacted\]/)
  assert.doesNotMatch(redacted, /super-secret-api-token/)
  assert.equal((redacted.match(/\[redacted\]/g) ?? []).length, 2)
})

test('default ring max is 2000', () => {
  assert.equal(DEBUG_LOG_RING_MAX, 2000)
})

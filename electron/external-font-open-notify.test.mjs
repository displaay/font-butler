import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createExternalFontOpenNotifier } from './external-font-open-notify.mjs'

test('notifier broadcasts absolute depth in order', () => {
  const sent = []
  const notifier = createExternalFontOpenNotifier((payload) => sent.push(payload.depth))
  notifier.pending()
  notifier.pending()
  assert.deepEqual(sent, [1, 2])
  notifier.done()
  assert.deepEqual(sent, [1, 2, 1])
  notifier.done()
  assert.deepEqual(sent, [1, 2, 1, 0])
})

test('done before a deferred pending delivery still ends at zero depth', () => {
  const delivered = []
  const pending = []
  const notifier = createExternalFontOpenNotifier((payload) => {
    pending.push(payload.depth)
  })
  notifier.pending()
  notifier.done()
  assert.equal(notifier.getDepth(), 0)
  for (const depth of pending) delivered.push(depth)
  assert.deepEqual(delivered, [1, 0])
  assert.equal(notifier.getDepth(), 0)
})

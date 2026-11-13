import assert from 'node:assert/strict'
import test from 'node:test'
import { createAnnouncementSlot } from './announcement-delivery.mjs'

test('a pending announcement stays until the renderer acknowledges it', () => {
  const slot = createAnnouncementSlot()
  assert.equal(slot.pull(), null)
  const notice = { id: 'migration-stalled', title: 'Library left in place', body: 'Still there.' }
  slot.stage(notice)
  assert.equal(slot.pull(), notice)
  assert.equal(slot.pull(), notice)
  assert.equal(slot.acknowledge('whats-new'), notice)
  assert.equal(slot.pull(), notice)
  assert.equal(slot.acknowledge('migration-stalled'), null)
  assert.equal(slot.pull(), null)
})

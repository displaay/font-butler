import assert from 'node:assert/strict'
import test from 'node:test'
import { createAnnouncementSlot } from './announcement-delivery.mjs'

test('a pull before stage is empty, and staging tells a renderer that is already mounted', () => {
  const slot = createAnnouncementSlot()
  const shown = []
  slot.onShow((item) => shown.push(item.id))
  assert.equal(slot.pull(), null)
  const notice = { id: 'migration-stalled', title: 'Library left in place', body: 'Still there.' }
  slot.stage(notice)
  assert.deepEqual(shown, [])
  assert.equal(slot.pull()?.id, 'migration-stalled')
  slot.markMounted()
  slot.stage(notice)
  assert.deepEqual(shown, ['migration-stalled'])
  assert.equal(slot.pull()?.id, 'migration-stalled')
  assert.equal(slot.acknowledge('migration-stalled'), null)
  assert.equal(slot.pull(), null)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ANNOUNCEMENTS,
  markAnnouncementSeen,
  nextAnnouncementToShow,
  parseAnnouncementState,
} from './announcements-gate.mjs'

test('popup gate seeds every id on a fresh install and shows nothing', () => {
  const result = nextAnnouncementToShow({
    state: null,
    currentVersion: '0.4.0',
    libraryEstablished: false,
  })
  assert.equal(result.announcement, null)
  assert.equal(result.seedSeen, true)
  assert.deepEqual(result.state.seenIds, ANNOUNCEMENTS.map((item) => item.id))
  assert.equal(result.state.firstRunVersion, '0.4.0')
})

test('popup gate treats an existing library with no record as an upgrade', () => {
  const result = nextAnnouncementToShow({
    state: null,
    currentVersion: '0.4.0',
    libraryEstablished: true,
  })
  assert.equal(result.seedSeen, false)
  assert.equal(result.announcement?.id, 'rename-to-cuttler')
  assert.equal(result.announcement?.celebrate, true)
  assert.equal(result.state.firstRunVersion, '0.4.0')
})

test('popup gate hides announcements already marked seen', () => {
  const result = nextAnnouncementToShow({
    state: { seenIds: ['rename-to-cuttler'], firstRunVersion: '0.3.12' },
    currentVersion: '0.4.0',
    libraryEstablished: true,
  })
  assert.equal(result.announcement, null)
  assert.equal(result.seedSeen, false)
})

test('markAnnouncementSeen is idempotent', () => {
  const once = markAnnouncementSeen({ seenIds: [], firstRunVersion: '0.4.0' }, 'rename-to-cuttler')
  const twice = markAnnouncementSeen(once, 'rename-to-cuttler')
  assert.deepEqual(once.seenIds, ['rename-to-cuttler'])
  assert.deepEqual(twice.seenIds, ['rename-to-cuttler'])
  assert.deepEqual(parseAnnouncementState({ seenIds: ['a', 'a', 1], firstRunVersion: '1' }).seenIds, [
    'a',
  ])
})

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
  assert.equal(result.announcement?.id, 'whats-new')
  assert.equal(result.announcement?.celebrate, true)
  assert.equal(result.state.firstRunVersion, '0.4.0')
})

test('popup gate still shows whats-new after the earlier rename popup was dismissed', () => {
  const result = nextAnnouncementToShow({
    state: { seenIds: ['rename-to-cuttler'], firstRunVersion: '0.4.0' },
    currentVersion: '0.4.0',
    libraryEstablished: true,
  })
  assert.equal(result.announcement?.id, 'whats-new')
  assert.equal(result.announcement?.celebrate, true)
})

test('popup gate hides announcements already marked seen', () => {
  const result = nextAnnouncementToShow({
    state: { seenIds: ['whats-new'], firstRunVersion: '0.3.12' },
    currentVersion: '0.4.0',
    libraryEstablished: true,
  })
  assert.equal(result.announcement, null)
  assert.equal(result.seedSeen, false)
})

test('markAnnouncementSeen is idempotent', () => {
  const once = markAnnouncementSeen({ seenIds: [], firstRunVersion: '0.4.0' }, 'whats-new')
  const twice = markAnnouncementSeen(once, 'whats-new')
  assert.deepEqual(once.seenIds, ['whats-new'])
  assert.deepEqual(twice.seenIds, ['whats-new'])
  assert.deepEqual(parseAnnouncementState({ seenIds: ['a', 'a', 1], firstRunVersion: '1' }).seenIds, [
    'a',
  ])
})

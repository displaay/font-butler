import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

test('migration-stalled shows only when the migration raised the flag', () => {
  const seenRename = { seenIds: ['whats-new'], firstRunVersion: '0.4.0' }
  const stalled = nextAnnouncementToShow({
    state: seenRename,
    currentVersion: '0.4.1',
    libraryEstablished: true,
    migrationStalled: true,
  })
  assert.equal(stalled.announcement?.id, 'migration-stalled')
  assert.equal(stalled.announcement?.showWhen, 'migration-stalled')
  assert.equal(stalled.announcement?.celebrate, false)
  assert.match(stalled.announcement?.body ?? '', /previous folder/)
  assert.match(stalled.announcement?.body ?? '', /already had files/)

  const quiet = nextAnnouncementToShow({
    state: seenRename,
    currentVersion: '0.4.1',
    libraryEstablished: true,
    migrationStalled: false,
  })
  assert.equal(quiet.announcement, null)

  const omitted = nextAnnouncementToShow({
    state: seenRename,
    currentVersion: '0.4.1',
    libraryEstablished: true,
  })
  assert.equal(omitted.announcement, null)
})

test('a successful move does not replay the 0.4.0 whats-new id and a fresh install shows nothing new', () => {
  const moved = nextAnnouncementToShow({
    state: { seenIds: ['whats-new'], firstRunVersion: '0.4.0' },
    currentVersion: '0.4.1',
    libraryEstablished: true,
    migrationStalled: false,
  })
  assert.equal(moved.announcement, null)
  assert.equal(
    ANNOUNCEMENTS.some((item) => item.id === 'rename-to-cuttler' || item.id === 'rename'),
    false,
  )

  const fresh = nextAnnouncementToShow({
    state: null,
    currentVersion: '0.4.1',
    libraryEstablished: false,
  })
  assert.equal(fresh.announcement, null)
  assert.equal(fresh.seedSeen, true)
  assert.equal(fresh.state.seenIds.includes('whats-new'), true)
  assert.equal(fresh.state.seenIds.includes('migration-stalled'), true)
})

test('a stalled migration keeps showing after the id was marked seen', () => {
  const result = nextAnnouncementToShow({
    state: { seenIds: ['migration-stalled', 'whats-new'], firstRunVersion: '0.4.1' },
    currentVersion: '0.4.1',
    libraryEstablished: true,
    migrationStalled: true,
  })
  assert.equal(result.announcement?.id, 'migration-stalled')
  const quiet = nextAnnouncementToShow({
    state: { seenIds: ['migration-stalled', 'whats-new'], firstRunVersion: '0.4.1' },
    currentVersion: '0.4.1',
    libraryEstablished: true,
    migrationStalled: false,
  })
  assert.equal(quiet.announcement, null)
})

test('the announcement gate does not infer a stall from folders', () => {
  const source = readFileSync(new URL('./announcements-gate.mjs', import.meta.url), 'utf8')
  assert.match(source, /migrationStalled === true/)
  assert.doesNotMatch(source, /Application Support|Library\/Fonts|migrateLegacy|readdirSync/)
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

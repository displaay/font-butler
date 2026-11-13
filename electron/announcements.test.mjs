import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { migrationAnnouncementFlags, migrationStallMessage } from './mac-data-migration.mjs'
import {
  dismissAnnouncement,
  presentPendingAnnouncement,
} from './announcements.mjs'

test('presentPendingAnnouncement seeds fresh installs and returns null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-ann-'))
  try {
    const result = presentPendingAnnouncement({ userDataDir: dir, currentVersion: '0.4.0' })
    assert.equal(result, null)
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'announcements.json'), 'utf8'))
    assert.deepEqual(state.seenIds, ['migration-stalled', 'migration-leftover', 'whats-new'])
    assert.equal(state.firstRunVersion, '0.4.0')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('presentPendingAnnouncement returns the paged announcement for an established library', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-ann-'))
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{}\n')
    const result = presentPendingAnnouncement({ userDataDir: dir, currentVersion: '0.4.0' })
    assert.equal(result?.id, 'whats-new')
    assert.equal(result?.celebrate, true)
    assert.equal(fs.existsSync(path.join(dir, 'announcements.json')), false)
    dismissAnnouncement({ userDataDir: dir, id: result.id })
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'announcements.json'), 'utf8'))
    assert.deepEqual(state.seenIds, ['whats-new'])
    assert.equal(
      presentPendingAnnouncement({ userDataDir: dir, currentVersion: '0.4.0' }),
      null,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a stalled migration names the old folder and a quiet move shows nothing new', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-ann-'))
  try {
    fs.writeFileSync(path.join(dir, 'announcements.json'), JSON.stringify({ seenIds: ['whats-new'], firstRunVersion: '0.4.0' }))
    const migration = {
      stalled: true,
      dataRoot: '/Users/me/Library/Application Support/Cuttler',
      installDir: '/Users/me/Library/Fonts/Cuttler',
      stalledDataDir: '/Users/me/Library/Application Support/Font Buttler',
      stalledFontsDir: '/Users/me/Library/Fonts/Font Buttler',
      movedData: false,
      movedFonts: false,
    }
    const stalled = presentPendingAnnouncement({
      userDataDir: dir,
      currentVersion: '0.4.1',
      migrationStalled: true,
      migration,
    })
    assert.equal(stalled?.id, 'migration-stalled')
    assert.equal(stalled?.body, migrationStallMessage(migration))
    assert.match(stalled?.body ?? '', /Application Support\/Font Buttler/)
    assert.match(stalled?.body ?? '', /Fonts\/Font Buttler/)
    assert.match(stalled?.body ?? '', /already had files/)
    assert.equal(
      presentPendingAnnouncement({
        userDataDir: dir,
        currentVersion: '0.4.1',
        migrationStalled: false,
        migration: { ...migration, stalled: false, stalledDataDir: null, stalledFontsDir: null },
      }),
      null,
    )
    const leftover = {
      stalled: false,
      dataRoot: '/Users/me/Library/Application Support/Cuttler',
      installDir: '/Users/me/Library/Fonts/Cuttler',
      stalledDataDir: null,
      stalledFontsDir: null,
      leftoverDataDir: '/Users/me/Library/Application Support/Font Buttler',
      leftoverFontsDir: '/Users/me/Library/Fonts/Font Buttler',
      movedData: true,
      movedFonts: true,
    }
    const flags = migrationAnnouncementFlags(leftover)
    assert.deepEqual(flags, { migrationStalled: false, migrationLeftover: true })
    assert.deepEqual(migrationAnnouncementFlags({ stalled: true, leftoverDataDir: leftover.leftoverDataDir }), {
      migrationStalled: true,
      migrationLeftover: false,
    })
    const leftBehind = presentPendingAnnouncement({
      userDataDir: dir,
      currentVersion: '0.4.1',
      ...flags,
      migration: leftover,
    })
    assert.equal(leftBehind?.id, 'migration-leftover')
    assert.equal(leftBehind?.title, 'Old folder left behind')
    assert.equal(leftBehind?.body, migrationStallMessage(leftover))
    assert.match(leftBehind?.body ?? '', /Application Support\/Font Buttler is no longer used/)
    assert.match(leftBehind?.body ?? '', /You can remove it/)
    assert.match(leftBehind?.body ?? '', /Fonts\/Font Buttler is no longer used/)
    assert.match(leftBehind?.body ?? '', /Fonts in that folder may still be active/)
    assert.equal((leftBehind?.body ?? '').includes('still in'), false)
    dismissAnnouncement({ userDataDir: dir, id: leftBehind.id })
    assert.equal(
      presentPendingAnnouncement({
        userDataDir: dir,
        currentVersion: '0.4.1',
        ...flags,
        migration: leftover,
      }),
      null,
    )
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-ann-fresh-'))
    try {
      assert.equal(presentPendingAnnouncement({ userDataDir: fresh, currentVersion: '0.4.1' }), null)
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true })
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('main wires leftover notices separately from a real stall', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  const callStart = main.indexOf('presentPendingAnnouncement({')
  const callEnd = main.indexOf('deliverPendingAnnouncement()', callStart)
  const call = main.slice(callStart, callEnd)
  assert.match(call, /migrationAnnouncementFlags\(macDataMigration\)/)
  assert.doesNotMatch(call, /stalled === true/)
  assert.doesNotMatch(call, /migrationNeedsNotice/)
})

test('announcements host no longer opens a dark-glass BrowserWindow', () => {
  const source = readFileSync(new URL('./announcements.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /BrowserWindow/)
  assert.doesNotMatch(source, /dark-glass|vibrancy|backdrop-filter/)
  assert.doesNotMatch(source, /burstConfetti|announcementPopupHtml/)
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(main, /announcement:show/)
  assert.match(main, /deliverPendingAnnouncement/)
  const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
  assert.match(preload, /onAnnouncement/)
  assert.match(preload, /dismissAnnouncement/)
})

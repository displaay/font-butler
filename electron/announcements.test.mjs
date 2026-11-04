import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readFileSync } from 'node:fs'
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
    assert.deepEqual(state.seenIds, ['whats-new'])
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

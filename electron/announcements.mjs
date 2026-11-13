/**
 * Announcement gate + persistence. UI lives in the main renderer
 * (welcome-style dialog + main-window confetti); this module only plans
 * what to show and marks ids seen.
 */

import fs from 'node:fs'
import path from 'node:path'
import { migrationStallMessage } from './mac-data-migration.mjs'
import {
  ANNOUNCEMENTS,
  markAnnouncementSeen,
  nextAnnouncementToShow,
  parseAnnouncementState,
} from './announcements-gate.mjs'

export const ANNOUNCEMENTS_FILE = 'announcements.json'

export {
  ANNOUNCEMENTS,
  markAnnouncementSeen,
  nextAnnouncementToShow,
  parseAnnouncementState,
} from './announcements-gate.mjs'

export function announcementsFilePath(userDataDir) {
  return path.join(userDataDir, ANNOUNCEMENTS_FILE)
}

export function libraryLooksEstablished(userDataDir) {
  if (!userDataDir) return false
  for (const name of ['catalog.json', 'settings.json']) {
    try {
      if (fs.existsSync(path.join(userDataDir, name))) return true
    } catch {
      // Ignore unreadable probes; treat as not established.
    }
  }
  return false
}

export function readAnnouncementStateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

export function writeAnnouncementStateFile(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${process.hrtime.bigint()}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
  fs.renameSync(tmp, filePath)
}

export function planAnnouncementPopup({
  userDataDir,
  currentVersion,
  migrationStalled = false,
  migrationLeftover = false,
}) {
  const filePath = announcementsFilePath(userDataDir)
  const raw = readAnnouncementStateFile(filePath)
  const libraryEstablished = libraryLooksEstablished(userDataDir)
  const planned = nextAnnouncementToShow({
    state: raw,
    currentVersion,
    libraryEstablished,
    migrationStalled,
    migrationLeftover,
  })
  if (planned.seedSeen) {
    writeAnnouncementStateFile(filePath, planned.state)
  }
  return { ...planned, filePath }
}

/**
 * Resolve the next announcement for the main window (or null).
 * Fresh installs seed seen ids and return null.
 */
export function presentPendingAnnouncement({
  userDataDir,
  currentVersion,
  migrationStalled = false,
  migrationLeftover = false,
  migration = null,
}) {
  const planned = planAnnouncementPopup({ userDataDir, currentVersion, migrationStalled, migrationLeftover })
  const announcement = planned.announcement
  if (!announcement) return null
  if (announcement.showWhen === 'migration-leftover') {
    const body = migrationStallMessage(migration)
    return { ...announcement, title: 'Old folder left behind', body: body || announcement.body }
  }
  if (announcement.showWhen === 'migration-stalled') {
    const body = migrationStallMessage(migration)
    if (body) return { ...announcement, body }
  }
  return announcement
}

/** Mark an announcement id seen after the renderer dismisses it. */
export function dismissAnnouncement({ userDataDir, id }) {
  if (!id || typeof id !== 'string') return null
  const filePath = announcementsFilePath(userDataDir)
  const raw = readAnnouncementStateFile(filePath)
  const state = parseAnnouncementState(raw ?? { seenIds: [], firstRunVersion: null })
  const next = markAnnouncementSeen(state, id)
  writeAnnouncementStateFile(filePath, next)
  return next
}

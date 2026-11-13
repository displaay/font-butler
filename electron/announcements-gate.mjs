/**
 * Pure announcement list + popup gate. Keep in sync with shared/announcements.ts.
 */

export const ANNOUNCEMENTS = [
  {
    id: 'migration-stalled',
    sinceVersion: '0.4.1',
    title: 'Library left in place',
    body: 'Your library is still in the previous folder. Cuttler already had files at the new path, so nothing was moved or deleted.',
    celebrate: false,
    showWhen: 'migration-stalled',
  },
  {
    id: 'migration-leftover',
    sinceVersion: '0.4.1',
    title: 'Old folder left behind',
    body: 'The previous folder is no longer used. You can remove it.',
    celebrate: false,
    showWhen: 'migration-leftover',
  },
  {
    id: 'whats-new',
    sinceVersion: '0.4.0',
    title: "What's new",
    body: 'Font Buttler has a new name. Same app, same library, same fonts — just Cuttler from here on.',
    celebrate: true,
    showWhen: 'upgrade',
  },
]

export function emptyAnnouncementState() {
  return { seenIds: [], firstRunVersion: null }
}

export function parseAnnouncementState(raw) {
  if (!raw || typeof raw !== 'object') return emptyAnnouncementState()
  const seenIds = Array.isArray(raw.seenIds)
    ? [...new Set(raw.seenIds.filter((id) => typeof id === 'string' && id.trim() !== ''))]
    : []
  const firstRunVersion =
    typeof raw.firstRunVersion === 'string' && raw.firstRunVersion.trim()
      ? raw.firstRunVersion.trim()
      : null
  return { seenIds, firstRunVersion }
}

export function allAnnouncementIds(list = ANNOUNCEMENTS) {
  return list.map((item) => item.id)
}

/**
 * Fresh install (no library, no record, migration did not stall): seed every
 * current id as seen. Existing library with no record: treat as upgrade and
 * show the first match. migration-stalled is shown only when the caller
 * passes migrationStalled from the folder migration, and it stays up while
 * that flag is set. migration-leftover shows once. This list does not
 * look at folders.
 */
export function nextAnnouncementToShow(input) {
  const announcements = input.announcements ?? ANNOUNCEMENTS
  const currentVersion = String(input.currentVersion ?? '').trim()
  const hasRecord = input.state != null
  const libraryEstablished = input.libraryEstablished === true
  const migrationStalled = input.migrationStalled === true
  const migrationLeftover = input.migrationLeftover === true
  const fontsRenameReason = typeof input.fontsRenameReason === 'string' ? input.fontsRenameReason : ''

  if (!hasRecord && !libraryEstablished && !migrationStalled && !migrationLeftover && !fontsRenameReason && input.oldHeadNotice !== true) {
    return {
      announcement: null,
      seedSeen: true,
      state: {
        seenIds: allAnnouncementIds(announcements),
        firstRunVersion: currentVersion || null,
      },
    }
  }

  const state = hasRecord ? parseAnnouncementState(input.state) : emptyAnnouncementState()
  if (!state.firstRunVersion && currentVersion) state.firstRunVersion = currentVersion

  const seen = new Set(state.seenIds)
  if (fontsRenameReason) {
    const id = `fonts-rename-${fontsRenameReason}`
    if (!seen.has(id)) {
      return {
        announcement: {
          id,
          sinceVersion: '0.4.1',
          title: fontsRenameReason === 'old-head' || fontsRenameReason === 'placed' ? 'Both font folders kept' : 'Fonts left in place',
          body: '',
          celebrate: false,
          showWhen: 'fonts-rename-blocked',
        },
        seedSeen: false,
        state,
      }
    }
  }
  if (input.oldHeadNotice === true && !seen.has('old-head-kept')) {
    return {
      announcement: {
        id: 'old-head-kept',
        sinceVersion: '0.4.1',
        title: 'Old folders kept',
        body: '',
        celebrate: false,
        showWhen: 'old-head-kept',
      },
      seedSeen: false,
      state,
    }
  }
  for (const item of announcements) {
    if (seen.has(item.id) && !(item.showWhen === 'migration-stalled' && migrationStalled)) continue
    if (item.showWhen === 'upgrade' && !libraryEstablished) continue
    if (item.showWhen === 'migration-stalled' && !migrationStalled) continue
    if (item.showWhen === 'migration-leftover' && !migrationLeftover) continue
    return { announcement: item, seedSeen: false, state }
  }
  return { announcement: null, seedSeen: false, state }
}

export function markAnnouncementSeen(state, id) {
  if (!id || state.seenIds.includes(id)) return state
  return { ...state, seenIds: [...state.seenIds, id] }
}

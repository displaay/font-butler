export type AnnouncementShowWhen = 'upgrade' | 'always'

export type Announcement = {
  id: string
  sinceVersion: string
  title: string
  body: string
  celebrate: boolean
  showWhen?: AnnouncementShowWhen
}

/** Product announcements shown in the main window (welcome-style dialog) after launch. */
export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'rename-to-cuttler',
    sinceVersion: '0.4.0',
    title: 'Now called Cuttler',
    body: 'Font Buttler has a new name. Same app, same library, same fonts — just Cuttler from here on.',
    celebrate: true,
    showWhen: 'upgrade',
  },
]

export type AnnouncementState = {
  seenIds: string[]
  firstRunVersion: string | null
}

export function emptyAnnouncementState(): AnnouncementState {
  return { seenIds: [], firstRunVersion: null }
}

export function parseAnnouncementState(raw: unknown): AnnouncementState {
  if (!raw || typeof raw !== 'object') return emptyAnnouncementState()
  const row = raw as { seenIds?: unknown; firstRunVersion?: unknown }
  const seenIds = Array.isArray(row.seenIds)
    ? [...new Set(row.seenIds.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))]
    : []
  const firstRunVersion =
    typeof row.firstRunVersion === 'string' && row.firstRunVersion.trim()
      ? row.firstRunVersion.trim()
      : null
  return { seenIds, firstRunVersion }
}

export function allAnnouncementIds(list: Announcement[] = ANNOUNCEMENTS): string[] {
  return list.map((item) => item.id)
}

/**
 * Pure gate for the announcement popup.
 *
 * Fresh install (no prior library, no announcement record): seed every current
 * id as seen and show nothing. Existing library with no record: treat as an
 * upgrade and surface the first matching unseen announcement. Later launches
 * only show ids not yet marked seen.
 */
export function nextAnnouncementToShow(input: {
  announcements?: Announcement[]
  state: AnnouncementState | null | undefined
  currentVersion: string
  libraryEstablished: boolean
}): { announcement: Announcement | null; seedSeen: boolean; state: AnnouncementState } {
  const announcements = input.announcements ?? ANNOUNCEMENTS
  const currentVersion = String(input.currentVersion ?? '').trim()
  const hasRecord = input.state != null
  const libraryEstablished = input.libraryEstablished === true

  if (!hasRecord && !libraryEstablished) {
    const seeded: AnnouncementState = {
      seenIds: allAnnouncementIds(announcements),
      firstRunVersion: currentVersion || null,
    }
    return { announcement: null, seedSeen: true, state: seeded }
  }

  const state = hasRecord
    ? parseAnnouncementState(input.state)
    : emptyAnnouncementState()
  if (!state.firstRunVersion && currentVersion) {
    state.firstRunVersion = currentVersion
  }

  const seen = new Set(state.seenIds)
  for (const item of announcements) {
    if (seen.has(item.id)) continue
    if (item.showWhen === 'upgrade' && !libraryEstablished) continue
    return { announcement: item, seedSeen: false, state }
  }
  return { announcement: null, seedSeen: false, state }
}

export function markAnnouncementSeen(state: AnnouncementState, id: string): AnnouncementState {
  if (!id || state.seenIds.includes(id)) return state
  return { ...state, seenIds: [...state.seenIds, id] }
}

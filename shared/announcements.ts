export type AnnouncementShowWhen = 'upgrade' | 'always'

export type AnnouncementPage = {
  id: string
  title: string
  body: string
}

export type Announcement = {
  id: string
  sinceVersion: string
  title: string
  body: string
  celebrate: boolean
  showWhen?: AnnouncementShowWhen
  pages?: AnnouncementPage[]
}

/**
 * One upgrade announcement. The dialog pages through these in order,
 * starting with the rename (icon choice), then each shipped feature.
 */
export const WHATS_NEW_PAGES: AnnouncementPage[] = [
  {
    id: 'rename',
    title: 'Now called Cuttler',
    body: 'Font Buttler has a new name. Same app, same library, same fonts — just Cuttler from here on.',
  },
  {
    id: 'smart-projects',
    title: 'Smart projects',
    body: 'Choose Smart when you create a project. Rules match status, type, source, folder, tag, or text, and the set stays live as the library changes.',
  },
  {
    id: 'family-tags',
    title: 'Family tags',
    body: 'Tag a family from its menu or the selection bar. Licensed, Trial, Open Source, and Unlicensed are ready to use. Displaay retail starts on Trial until you save a worker token.',
  },
  {
    id: 'document-font-sheet',
    title: 'Document → Project',
    body: 'Open a PDF, IDML, Word, or PowerPoint file. Cuttler groups those fonts into on, in the library but off, or missing. Activate what you have, or create a project from the document.',
  },
  {
    id: 'library-search',
    title: 'Library search',
    body: 'Type several words — each one has to match. A tag name in the query finds families with that tag.',
  },
  {
    id: 'activate-until-quit',
    title: 'Activate until quit',
    body: 'Turn a face on for this session only. Quit the app and it turns back off — unless a project or a normal activate still wants it.',
  },
]

/** Product announcements shown in the main window (welcome-style dialog) after launch. */
export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'whats-new',
    sinceVersion: '0.4.0',
    title: WHATS_NEW_PAGES[0]!.title,
    body: WHATS_NEW_PAGES[0]!.body,
    celebrate: true,
    showWhen: 'upgrade',
    pages: WHATS_NEW_PAGES,
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

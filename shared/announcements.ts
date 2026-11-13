export type AnnouncementShowWhen = 'upgrade' | 'always' | 'migration-stalled' | 'migration-leftover'

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
    body: 'Tag a family from its menu or the selection bar. Licensed, Trial, Open Source, and Unlicensed are ready to use — pick a color when you make a new one. Displaay retail starts on Trial until you save a worker token.',
  },
  {
    id: 'document-font-sheet',
    title: 'Document → Project',
    body: 'Open a PDF, IDML, Word, or PowerPoint file. Cuttler groups those fonts into on, in the library but off, or missing. Activate what you have, or create a project from the document.',
  },
  {
    id: 'advanced-search',
    title: 'Advanced search',
    body: 'Type several words — each one has to match. A tag name finds families with that tag. Start typing a filter name and matching filters appear under the search field; choose one and it stays in the field, narrowing the library and the preview style.',
  },
  {
    id: 'activate-until-quit',
    title: 'Temporary install',
    body: 'Right-click a face and choose Activate until quit for a temporary install. It stays on only for this session — quit Cuttler and it turns back off, unless a project or a normal activate still wants it.',
  },
  {
    id: 'adobe-document-watch',
    title: 'Adobe document watch',
    body: 'In Settings, turn on Watch documents in Adobe and Office. When InDesign is in front, Cuttler asks it for the fonts in its open documents, including while Missing Fonts is open. Illustrator, Photoshop, Acrobat, Word, and PowerPoint are read from the open file.',
  },
  {
    id: 'finder-extension',
    title: 'Finder extension',
    body: 'Right-click a font file or a folder of fonts in Finder and install into Cuttler. Enable the Finder menu once in Settings (Login Items & Extensions). Until that is on, use Services → Install the same way.',
  },
  {
    id: 'compare',
    title: 'Compare',
    body: 'Open Compare to stack or overlay faces side by side — including fonts you drop in from Finder. Pick styles, flip between stacked and overlay, and judge them in one place.',
  },
  {
    id: 'family-ratings',
    title: 'Star ratings & comments',
    body: 'Rate a family with up to five stars — the badge shows on the library card. Add a comment in the inspector for notes that stay with the family. Font Book and FontExplorer imports can bring ratings and comments along.',
  },
]

/**
 * Product announcements shown in the main window (welcome-style dialog) after launch.
 * `migration-stalled` is first so a blocked folder move is shown before What's new.
 * The list does not decide that case: the caller passes migrationStalled from the
 * folder migration. A missing flag never shows it. `migration-leftover` shows
 * once when the library moved and an old folder could not be removed.
 */
export const ANNOUNCEMENTS: Announcement[] = [
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
 * Fresh install (no prior library, no announcement record, migration did not
 * stall): seed every current id as seen and show nothing. Existing library
 * with no record: treat as an upgrade and surface the first matching unseen
 * announcement. Later launches only show ids not yet marked seen.
 * `showWhen: 'migration-stalled'` waits for migrationStalled from the folder
 * migration and shows again while that flag is set. `migration-leftover`
 * shows once. This function does not look at disk.
 */
export function nextAnnouncementToShow(input: {
  announcements?: Announcement[]
  state: AnnouncementState | null | undefined
  currentVersion: string
  libraryEstablished: boolean
  /** Set by the folder migration. The list does not infer this from disk. */
  migrationStalled?: boolean
  /** Leftover folder after a committed copy. Shown once, then stays dismissed. */
  migrationLeftover?: boolean
}): { announcement: Announcement | null; seedSeen: boolean; state: AnnouncementState } {
  const announcements = input.announcements ?? ANNOUNCEMENTS
  const currentVersion = String(input.currentVersion ?? '').trim()
  const hasRecord = input.state != null
  const libraryEstablished = input.libraryEstablished === true
  const migrationStalled = input.migrationStalled === true
  const migrationLeftover = input.migrationLeftover === true

  if (!hasRecord && !libraryEstablished && !migrationStalled && !migrationLeftover) {
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
    if (seen.has(item.id) && !(item.showWhen === 'migration-stalled' && migrationStalled)) continue
    if (item.showWhen === 'upgrade' && !libraryEstablished) continue
    if (item.showWhen === 'migration-stalled' && !migrationStalled) continue
    if (item.showWhen === 'migration-leftover' && !migrationLeftover) continue
    return { announcement: item, seedSeen: false, state }
  }
  return { announcement: null, seedSeen: false, state }
}

export function markAnnouncementSeen(state: AnnouncementState, id: string): AnnouncementState {
  if (!id || state.seenIds.includes(id)) return state
  return { ...state, seenIds: [...state.seenIds, id] }
}

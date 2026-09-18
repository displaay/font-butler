import { entryFormatOf, formatLabel } from './formats'
import { groupCatalog, matchesQuery } from './group'
import { needsLocateSource } from './state'
import type { CatalogEntry, FamilyGroup, RelinkPreview } from './types'

export function catalogGroupsForLinkPicker(entries: CatalogEntry[], query = ''): FamilyGroup[] {
  return groupCatalog(entries).filter((group) =>
    matchesQuery(
      [
        group.familyName,
        ...group.faces.map((face) => face.styleName),
        ...group.entries.map((entry) => entry.sourcePath),
      ].join(' '),
      query,
    ),
  )
}

export function catalogEntryPickerLabel(entry: CatalogEntry): string {
  const styles =
    entry.faces
      .map((face) => face.styleName)
      .filter(Boolean)
      .join(', ') || 'Regular'
  const format = formatLabel(entryFormatOf(entry))
  return format ? `${styles} · ${format}` : styles
}

export function familyPickerSubtitle(group: FamilyGroup): string {
  const count = group.instanceCount || group.entries.length
  const noun = count === 1 ? 'style' : 'styles'
  return `${count} ${noun}`
}

export type FinderLinkStatus = 'pair' | 'already-linked' | 'unmatched'

export type FinderLinkAssignment = {
  path: string
  status: FinderLinkStatus
  entryId?: string
  preview?: RelinkPreview
}

export function normalizeLinkPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

export function isPreferredLinkTarget(entry: CatalogEntry): boolean {
  return (
    needsLocateSource(entry) ||
    entry.sourceAvailability === 'none' ||
    entry.sourceAvailability === 'missing' ||
    entry.status === 'source-missing'
  )
}

export function isAlreadyLinkedPreview(preview: RelinkPreview): boolean {
  if (preview.match === 'fingerprint') return true
  return Boolean(
    preview.oldPath &&
      preview.proposedPath &&
      normalizeLinkPath(preview.oldPath) === normalizeLinkPath(preview.proposedPath),
  )
}

function linkCandidateRank(entry: CatalogEntry | undefined, preview: RelinkPreview): number {
  if (entry && isPreferredLinkTarget(entry)) return 0
  if (isAlreadyLinkedPreview(preview)) return 2
  return 1
}

export function pairFinderFilesToFamily(
  files: string[],
  entries: CatalogEntry[],
  inspects: Record<string, RelinkPreview[]>,
): FinderLinkAssignment[] {
  const byId = new Map(entries.map((item) => [item.id, item]))
  const used = new Set<string>()
  const assignments: FinderLinkAssignment[] = []

  for (const filePath of files) {
    const previews = (inspects[filePath] ?? []).filter(
      (preview) => preview.identityMatch && preview.entryId && !used.has(preview.entryId),
    )
    if (previews.length === 0) {
      assignments.push({ path: filePath, status: 'unmatched' })
      continue
    }
    previews.sort((left, right) => {
      const rankDelta =
        linkCandidateRank(byId.get(left.entryId), left) - linkCandidateRank(byId.get(right.entryId), right)
      if (rankDelta !== 0) return rankDelta
      const leftIndex = entries.findIndex((item) => item.id === left.entryId)
      const rightIndex = entries.findIndex((item) => item.id === right.entryId)
      return leftIndex - rightIndex
    })
    const best = previews[0]!
    const bestEntry = byId.get(best.entryId)
    used.add(best.entryId)
    if (isAlreadyLinkedPreview(best) && (!bestEntry || !isPreferredLinkTarget(bestEntry))) {
      assignments.push({
        path: filePath,
        status: 'already-linked',
        entryId: best.entryId,
        preview: best,
      })
      continue
    }
    assignments.push({
      path: filePath,
      status: 'pair',
      entryId: best.entryId,
      preview: best,
    })
  }

  return assignments
}

export function currentFinderLinkAssignment(assignments: FinderLinkAssignment[]): FinderLinkAssignment | null {
  return (
    assignments.find((item) => item.status === 'pair' || item.status === 'already-linked') ??
    assignments.find((item) => item.status === 'unmatched') ??
    null
  )
}

export function unmatchedFinderLinkCount(assignments: FinderLinkAssignment[]): number {
  return assignments.filter((item) => item.status === 'unmatched').length
}

export function unmatchedFinderLinkMessage(count: number): string {
  if (count <= 0) return ''
  return count === 1 ? '1 file doesn’t match this family' : `${count} files don’t match this family`
}

export function finderLinkStyleStatus(
  preview: RelinkPreview | undefined,
  assignment?: FinderLinkAssignment | null,
): string {
  if (assignment?.status === 'already-linked' && preview && assignment.entryId === preview.entryId) {
    return 'Already linked'
  }
  if (!preview) return 'Inspect'
  if (preview.identityMatch) return 'Matches'
  return 'Does not match'
}

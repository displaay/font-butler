import { entryFormatOf } from './formats.ts'
import type { CatalogEntry } from './types.ts'

function instanceKey(familyName: string, styleName: string): string {
  return `${familyName.trim().toLowerCase()}::${styleName.trim().toLowerCase()}`
}

export function facesOverlap(left: CatalogEntry, right: CatalogEntry): boolean {
  const styles = new Set<string>()
  const posts = new Set<string>()
  for (const face of left.faces) {
    styles.add(instanceKey(face.familyName, face.styleName))
    const postscript = face.postscriptName.trim().toLowerCase()
    if (postscript) posts.add(postscript)
  }
  return right.faces.some((face) => {
    if (styles.has(instanceKey(face.familyName, face.styleName))) return true
    const postscript = face.postscriptName.trim().toLowerCase()
    return Boolean(postscript && posts.has(postscript))
  })
}

export function sameFormatIdentity(left: CatalogEntry, right: CatalogEntry): boolean {
  if (!facesOverlap(left, right)) return false
  return entryFormatOf(left) === entryFormatOf(right)
}

export function isOccupyingStatus(entry: CatalogEntry): boolean {
  return entry.status === 'installed' || entry.status === 'outdated'
}

export function occupyingSiblings(entry: CatalogEntry, catalog: CatalogEntry[]): CatalogEntry[] {
  return catalog.filter(
    (other) => other.id !== entry.id && isOccupyingStatus(other) && sameFormatIdentity(entry, other),
  )
}

/** Live copies of the same face in a different format (OTF vs TTF). Switch cannot park these. */
export function crossFormatOccupyingSiblings(entry: CatalogEntry, catalog: CatalogEntry[]): CatalogEntry[] {
  return catalog.filter(
    (other) =>
      other.id !== entry.id &&
      isOccupyingStatus(other) &&
      facesOverlap(entry, other) &&
      !sameFormatIdentity(entry, other),
  )
}

/**
 * Switch parks the occupying same-format sibling, then activates this copy.
 * A live OTF with a kept TTF (or the reverse) is only a cross-format occupier —
 * Switch cannot park a different format, and installing would format-conflict.
 * Hide Switch until Switch learns cross-format park. Replace / Install as… stay
 * available via format-conflict prompts and import-plan choices.
 */
export function canSwitchTo(entry: CatalogEntry, catalog: CatalogEntry[]): boolean {
  if (entry.previewOnly) return false
  if (entry.status !== 'deactivated' && entry.status !== 'uninstalled') return false
  return occupyingSiblings(entry, catalog).length > 0
}

/** Watch-folder Switch: only when an occupying conflict shares the incoming format. */
export function canSwitchToConflicts(incomingFormat: string | undefined, conflicts: CatalogEntry[]): boolean {
  const format = incomingFormat ? entryFormatOf({ format: incomingFormat, sourcePath: '' }) : ''
  if (!format) return false
  return conflicts.some((entry) => isOccupyingStatus(entry) && entryFormatOf(entry) === format)
}

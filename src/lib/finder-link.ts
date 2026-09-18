import { entryFormatOf, formatLabel } from './formats'
import { groupCatalog, matchesQuery } from './group'
import type { CatalogEntry, FamilyGroup } from './types'

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

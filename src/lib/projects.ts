export const FONT_BUTLER_ENTRIES_TYPE = 'application/x-font-butler-entries'

export function writeFontButlerEntries(dataTransfer: DataTransfer, entryIds: string[]): void {
  const payload = JSON.stringify(entryIds)
  dataTransfer.setData(FONT_BUTLER_ENTRIES_TYPE, payload)
  dataTransfer.setData('text/plain', `${entryIds.length} font${entryIds.length === 1 ? '' : 's'}`)
  dataTransfer.effectAllowed = 'copy'
}

export function hasFontButlerEntries(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(FONT_BUTLER_ENTRIES_TYPE)
}

export function readFontButlerEntries(dataTransfer: DataTransfer): string[] {
  const raw = dataTransfer.getData(FONT_BUTLER_ENTRIES_TYPE)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
  } catch {
    return []
  }
}

export function uniqueMemberIds(existing: string[], add: string[]): string[] {
  return [...new Set([...existing, ...add])]
}

export function removeMemberIds(existing: string[], remove: string[]): string[] {
  const drop = new Set(remove)
  return existing.filter((id) => !drop.has(id))
}

export function defaultProjectName(familyNames: string[]): string {
  return familyNames.length === 1 ? familyNames[0]! : 'Untitled project'
}

export const PROJECT_SORT_KEY = 'font-butler-project-sort'

export type ProjectSortMode = 'name' | 'added'

export function readProjectSort(
  storage: Pick<Storage, 'getItem'> = localStorage,
): ProjectSortMode {
  return storage.getItem(PROJECT_SORT_KEY) === 'name' ? 'name' : 'added'
}

export function writeProjectSort(
  mode: ProjectSortMode,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(PROJECT_SORT_KEY, mode)
}

export function sortProjects<T extends { name: string }>(
  projects: T[],
  mode: ProjectSortMode,
): T[] {
  if (mode !== 'name') return projects
  return [...projects].sort((a, b) => a.name.localeCompare(b.name))
}

export function projectContainsAll(
  project: { members: Array<{ assetId: string }> },
  entryIds: string[],
): boolean {
  if (entryIds.length === 0) return false
  const have = new Set(project.members.map((member) => member.assetId))
  return entryIds.every((id) => have.has(id))
}

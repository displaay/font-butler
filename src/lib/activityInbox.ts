import { entryFormatOf } from './formats.ts'
import type { CatalogEntry, FontFaceInfo, Operation } from './types'

export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  deactivate: 'deactivated',
  activate: 'activated',
  install: 'installed',
  'install-update': 'update installed',
  uninstall: 'uninstalled',
  reinstall: 'reinstalled',
  repair: 'repaired',
  'apply-plan': 'imported',
  'relink-source': 'source linked',
  'relink-folder': 'folder relinked',
  'restore-revision': 'version restored',
  'activate-project': 'activated',
  undo: 'undone',
  'recover-journal': 'recovered after interruption',
  switch: 'switched',
}

function sentenceCase(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function activityActionLabel(action: string): string {
  return sentenceCase(ACTIVITY_ACTION_LABELS[action] ?? action)
}

export function activityRowLabel(operation: {
  action: string
  familyName?: string
}): string {
  const done = ACTIVITY_ACTION_LABELS[operation.action] ?? operation.action
  return operation.familyName ? `${operation.familyName} ${done}` : sentenceCase(done)
}

function prettyFileName(filePath?: string): string {
  if (!filePath) return ''
  const parts = filePath.split(/[/\\]/)
  const name = parts[parts.length - 1] || ''
  return name.replace(/^(?:[0-9]{10,}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})-/i, '')
}

function uniqueStyleNames(faces: Array<Pick<FontFaceInfo, 'styleName'>>): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const face of faces) {
    const name = face.styleName.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

function styleSummary(faces: Array<Pick<FontFaceInfo, 'styleName'>>): string {
  const styles = uniqueStyleNames(faces)
  if (styles.length === 0) return ''
  if (styles.length <= 3) return styles.join(', ')
  return `${styles.length} styles`
}

export function entryActivityLabel(
  entry: Pick<CatalogEntry, 'customFamilyName' | 'faces' | 'format' | 'sourcePath' | 'installedPath' | 'disabledPath'>,
): string {
  const family = entry.customFamilyName || entry.faces[0]?.familyName || 'Unknown'
  const fileName = prettyFileName(entry.sourcePath || entry.installedPath || entry.disabledPath)
  const format = entryFormatOf(entry).toUpperCase()
  const styles = styleSummary(entry.faces)
  if (styles) return format ? `${styles} · ${format}` : styles
  const parts: string[] = []
  if (family) parts.push(family)
  if (fileName && fileName !== parts[0]) parts.push(fileName)
  else if (format && format !== parts[0]) parts.push(format)
  return parts.join(' · ') || family || fileName || 'Unknown'
}

export function activityItemLabel(
  item: { label: string; entryId?: string },
  entry?: Pick<
    CatalogEntry,
    'customFamilyName' | 'faces' | 'format' | 'sourcePath' | 'installedPath' | 'disabledPath'
  > | null,
): string {
  if (!entry) return item.label
  const family = entry.customFamilyName || entry.faces[0]?.familyName || 'Unknown'
  if (item.label && item.label !== family) return item.label
  return entryActivityLabel(entry)
}

export function unreadActivityCount(operations: Array<{ unread?: boolean }>): number {
  return operations.filter((operation) => operation.unread).length
}

export function isBackgroundActivityTrigger(trigger: string): boolean {
  return trigger === 'watch' || trigger === 'startup'
}

export function unreadOperationIdsToMark({
  previous,
  next,
  foregroundBusy,
  windowHidden,
  markVisibleBackground = false,
}: {
  previous: Array<{ id: string; outcome: string; unread?: boolean; trigger: string }>
  next: Array<{ id: string; outcome: string; unread?: boolean; trigger: string }>
  foregroundBusy: boolean
  windowHidden: boolean
  markVisibleBackground?: boolean
}): string[] {
  const previousById = new Map(previous.map((operation) => [operation.id, operation]))
  const ids: string[] = []
  for (const operation of next) {
    if (operation.unread) continue
    if (operation.outcome === 'pending') continue
    const prior = previousById.get(operation.id)
    const isNew = !prior
    const newlyFinished = Boolean(prior && prior.outcome === 'pending' && operation.outcome !== 'pending')
    if (!isNew && !newlyFinished) continue
    if (isBackgroundActivityTrigger(operation.trigger)) {
      ids.push(operation.id)
      continue
    }
    if (foregroundBusy) continue
    if (windowHidden || markVisibleBackground) {
      ids.push(operation.id)
    }
  }
  return ids
}

export function mergeUnreadFlags(
  operations: Operation[],
  unreadIds: string[],
): Operation[] {
  if (unreadIds.length === 0) return operations
  const wanted = new Set(unreadIds)
  return operations.map((operation) =>
    wanted.has(operation.id) ? { ...operation, unread: true } : operation,
  )
}

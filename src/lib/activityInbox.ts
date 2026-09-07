import type { Operation } from './types'

export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  deactivate: 'Deactivate',
  activate: 'Activate',
  install: 'Install',
  'install-update': 'Install update',
  uninstall: 'Uninstall',
  reinstall: 'Reinstall',
  repair: 'Repair',
  'apply-plan': 'Import',
  'relink-source': 'Link source',
  'relink-folder': 'Relink folder',
  'restore-revision': 'Restore version',
  'activate-project': 'Activate project',
  undo: 'Undo',
  'recover-journal': 'Recovered after interruption',
  switch: 'Switch',
}

export function activityActionLabel(action: string): string {
  return ACTIVITY_ACTION_LABELS[action] ?? action
}

export function activityRowLabel(operation: {
  action: string
  familyName?: string
}): string {
  const action = activityActionLabel(operation.action)
  return operation.familyName ? `${action} · ${operation.familyName}` : action
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

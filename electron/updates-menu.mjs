export function familyNameOf(entry) {
  return entry.customFamilyName || entry.faces?.[0]?.familyName || 'Unknown'
}

export function outdatedFamilies(entries) {
  const map = new Map()
  for (const entry of entries) {
    if (entry.status !== 'outdated') continue
    const name = familyNameOf(entry)
    const ids = map.get(name) ?? []
    ids.push(entry.id)
    map.set(name, ids)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, ids]) => ({ name, ids }))
}

export const TRAY_SECTION_LIMIT = 5

const ACTIVITY_ACTION_LABELS = {
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

export function activityRowLabel(operation) {
  const action = ACTIVITY_ACTION_LABELS[operation?.action] ?? operation?.action ?? 'Activity'
  return operation?.familyName ? `${action} · ${operation.familyName}` : action
}

export function isBackgroundActivityTrigger(trigger) {
  return trigger === 'watch' || trigger === 'startup'
}

export function unreadActivityCount(operations) {
  return (operations ?? []).filter((operation) => operation.unread).length
}

export function menuBarNeedsAttention(input) {
  if (typeof input === 'number') {
    return input > 0
  }
  return Boolean(input?.hasUnread || input?.hasUpdates)
}

export function menuBarUpdateBadge(_input) {
  return ''
}

export function menuBarTrayIconPath(input, { quiet, attention }) {
  return menuBarNeedsAttention(input) ? attention : quiet
}

export function unreadOperationIdsToMark({
  previous = [],
  next = [],
  foregroundBusy = false,
  windowHidden = false,
  markVisibleBackground = false,
} = {}) {
  const previousById = new Map(previous.map((operation) => [operation.id, operation]))
  const ids = []
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

export function buildTrayMenuModel({
  operations = [],
  families = [],
  limit = TRAY_SECTION_LIMIT,
} = {}) {
  const unreadCount = unreadActivityCount(operations)
  return {
    activityHeadline: 'Activity',
    activityRows: operations.slice(0, limit).map((operation) => ({
      id: operation.id,
      label: activityRowLabel(operation),
      unread: Boolean(operation.unread),
    })),
    activityEmpty: operations.length === 0,
    activityShowAll: operations.length > limit,
    markAllAsRead: unreadCount > 0,
    updatesHeadline: 'Updates',
    updateRows: families.slice(0, limit),
    updatesEmpty: families.length === 0,
    updatesShowAll: families.length > limit,
    reinstallAll: families.length > 0,
    hasUnread: unreadCount > 0,
    hasUpdates: families.length > 0,
  }
}

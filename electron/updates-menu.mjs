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

function sentenceCase(value) {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function activityRowLabel(operation) {
  const done = ACTIVITY_ACTION_LABELS[operation?.action] ?? operation?.action ?? 'Activity'
  return operation?.familyName ? `${operation.familyName} ${done}` : sentenceCase(done)
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
  return Boolean(input?.hasUnread)
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
  appUpdate = null,
  limit = TRAY_SECTION_LIMIT,
} = {}) {
  const unreadCount = unreadActivityCount(operations)
  const appUpdateAvailable = Boolean(appUpdate?.updateAvailable)
  const appLabel =
    appUpdateAvailable && appUpdate?.latestVersion ? `Font Buttler ${appUpdate.latestVersion}` : ''
  return {
    activityHeadline: 'Activity',
    activityRows: operations.slice(0, limit).map((operation) => ({
      id: operation.id,
      label: activityRowLabel(operation),
      unread: Boolean(operation.unread),
    })),
    activityEmpty: operations.length === 0,
    activityShowAll: operations.length > 0,
    markAllAsRead: unreadCount > 0,
    clearAll: operations.length > 0,
    updatesHeadline: 'Updates',
    appUpdateRow: appUpdateAvailable
      ? {
          label: appLabel || 'Font Buttler update',
          htmlUrl: appUpdate.htmlUrl ?? null,
          downloadUrl: appUpdate.preferredAsset?.url ?? null,
          downloadLabel: appUpdate.preferredAsset?.name
            ? `Download ${appUpdate.preferredAsset.name}`
            : null,
          notes: typeof appUpdate.releaseNotes === 'string' ? appUpdate.releaseNotes : null,
        }
      : null,
    updateRows: families.slice(0, limit),
    updatesEmpty: families.length === 0 && !appUpdateAvailable,
    updatesShowAll: families.length > limit,
    reinstallAll: families.length > 0,
    hasUnread: unreadCount > 0,
    hasUpdates: families.length > 0,
    hasAppUpdate: appUpdateAvailable,
  }
}

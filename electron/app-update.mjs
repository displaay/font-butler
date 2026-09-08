const OWNER = 'displaay'
export const APP_UPDATE_GITHUB_REPO_PATH = `/${OWNER}/font-butler`

export function isAllowedAppUpdateUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.hostname !== 'github.com') return false
  return (
    parsed.pathname === APP_UPDATE_GITHUB_REPO_PATH ||
    parsed.pathname.startsWith(`${APP_UPDATE_GITHUB_REPO_PATH}/`)
  )
}

export function appUpdateRowLabel(status) {
  if (!status?.updateAvailable || !status.latestVersion) return ''
  return `Font Buttler ${status.latestVersion}`
}

export function trayTooltip({ hasUnread = false, hasUpdates = false, hasAppUpdate = false, fontUpdateCount = 0 } = {}) {
  if (hasUnread) {
    if (hasUpdates && hasAppUpdate) return 'Font Buttler — unread activity, font updates, and an app update'
    if (hasUpdates) return 'Font Buttler — unread activity and updates'
    if (hasAppUpdate) return 'Font Buttler — unread activity and an app update'
    return 'Font Buttler — unread activity'
  }
  if (hasUpdates && hasAppUpdate) {
    return `Font Buttler — ${fontUpdateCount} font ${fontUpdateCount === 1 ? 'update' : 'updates'} and an app update`
  }
  if (hasAppUpdate) return 'Font Buttler — app update available'
  if (hasUpdates) return `Font Buttler — ${fontUpdateCount} updates`
  return 'Font Buttler'
}

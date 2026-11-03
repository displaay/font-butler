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
  return `Cuttler ${status.latestVersion}`
}

export function trayTooltip({ hasUnread = false, hasUpdates = false, hasAppUpdate = false, fontUpdateCount = 0 } = {}) {
  if (hasUnread) {
    if (hasUpdates && hasAppUpdate) return 'Cuttler — unread activity, font updates, and an app update'
    if (hasUpdates) return 'Cuttler — unread activity and updates'
    if (hasAppUpdate) return 'Cuttler — unread activity and an app update'
    return 'Cuttler — unread activity'
  }
  if (hasUpdates && hasAppUpdate) {
    return `Cuttler — ${fontUpdateCount} font ${fontUpdateCount === 1 ? 'update' : 'updates'} and an app update`
  }
  if (hasAppUpdate) return 'Cuttler — app update available'
  if (hasUpdates) return `Cuttler — ${fontUpdateCount} updates`
  return 'Cuttler'
}

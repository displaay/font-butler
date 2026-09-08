import {
  isAllowedAppUpdateUrl,
  type AppUpdateStatus,
} from '../../shared/app-update.ts'

export {
  APP_UPDATE_AUTO_INSTALL,
  APP_UPDATE_GITHUB_RELEASES_URL,
  appUpdateRowLabel,
  isAllowedAppUpdateUrl,
  shouldShowUpdatesTab,
} from '../../shared/app-update.ts'
export type { AppUpdateAsset, AppUpdateStatus } from '../../shared/app-update.ts'

export async function openAppUpdateUrl(url: string): Promise<boolean> {
  if (!isAllowedAppUpdateUrl(url)) return false
  const desktop = window.fontButlerDesktop?.openExternal
  if (desktop) {
    await desktop(url)
    return true
  }
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

export function appUpdateDownloadUrl(
  status: Pick<AppUpdateStatus, 'preferredAsset' | 'htmlUrl'>,
): string | null {
  return status.preferredAsset?.url || status.htmlUrl || null
}

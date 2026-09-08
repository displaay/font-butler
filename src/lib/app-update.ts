import {
  APP_UPDATE_GITHUB_RELEASES_URL,
  isAllowedAppUpdateUrl,
  type AppUpdateStatus,
} from '../../shared/app-update.ts'

export {
  APP_UPDATE_AUTO_INSTALL,
  APP_UPDATE_GITHUB_RELEASES_URL,
  PARKED_AUTO_INSTALL_NOTICE,
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

export function appUpdateReleaseUrl(
  status: Pick<AppUpdateStatus, 'htmlUrl'>,
): string {
  return status.htmlUrl || APP_UPDATE_GITHUB_RELEASES_URL
}

export function appUpdateDownloadUrl(
  status: Pick<AppUpdateStatus, 'preferredAsset'>,
): string | null {
  return status.preferredAsset?.url ?? null
}

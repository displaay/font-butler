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

export type AppUpdateInstallPhase = 'idle' | 'downloading' | 'verifying' | 'installing' | 'opening' | 'error'

export function appUpdateBadgeText(phase?: AppUpdateInstallPhase, percent?: number): string {
  if (phase === 'error') return 'Error'
  if (phase === 'downloading') return typeof percent === 'number' ? `${percent}%` : '…'
  if (phase === 'verifying' || phase === 'installing' || phase === 'opening') return '…'
  return 'Update'
}

export function appUpdateBadgeLabel(version: string, phase?: AppUpdateInstallPhase): string {
  if (phase === 'error') return `Update to Font Buttler ${version} failed`
  if (phase && phase !== 'idle') return `Updating to Font Buttler ${version}`
  return `Update to Font Buttler ${version}`
}

export function appUpdateClickIgnored(phase?: AppUpdateInstallPhase): boolean {
  return phase === 'downloading' || phase === 'verifying' || phase === 'installing' || phase === 'opening'
}

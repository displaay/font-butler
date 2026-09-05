export type NotificationPermissionResult = 'granted' | 'denied' | 'default'

export function persistNativeNotificationsEnabled(
  wantEnabled: boolean,
  permission: NotificationPermissionResult,
): boolean {
  return wantEnabled && permission === 'granted'
}

export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  try {
    const fromDesktop = window.fontButlerDesktop?.requestNotifications
    if (fromDesktop) {
      const result = await fromDesktop()
      if (result === 'granted' || result === 'denied' || result === 'default') {
        return result
      }
    }
    if (typeof Notification === 'undefined') return 'denied'
    const result = await Notification.requestPermission()
    if (result === 'granted' || result === 'denied' || result === 'default') {
      return result
    }
    return 'denied'
  } catch {
    return 'denied'
  }
}

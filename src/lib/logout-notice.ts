export type LogoutNoticeAction = 'ignore' | 'waiting' | 'pass'

/**
 * The main process owns the failure dialog, including when no window is open.
 * A still-waiting notice is shown in the window only while that window is visible.
 */
export function logoutNoticeAction(
  source: string | undefined,
  windowVisible: boolean,
): LogoutNoticeAction {
  if (source === 'logout') return 'ignore'
  if (source === 'logout-waiting') return windowVisible ? 'waiting' : 'ignore'
  return 'pass'
}

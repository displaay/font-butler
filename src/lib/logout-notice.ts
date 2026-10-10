export type LogoutNoticeAction = 'ignore' | 'pass'

/**
 * The main process owns the failure dialog, the still-waiting notice, and the
 * test-build simulated notice.
 * The renderer never decides from document.visibilityState, so a hidden page
 * cannot drop the notice and a visible page cannot show a second copy.
 */
export function logoutNoticeAction(source: string | undefined): LogoutNoticeAction {
  if (source === 'logout' || source === 'logout-waiting' || source === 'logout-probe') return 'ignore'
  return 'pass'
}

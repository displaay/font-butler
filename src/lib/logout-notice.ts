export type LogoutNoticeAction = 'ignore' | 'pass'

/**
 * The main process owns both the failure dialog and the still-waiting notice.
 * The renderer never decides from document.visibilityState, so a hidden page
 * cannot drop the notice and a visible page cannot show a second copy.
 */
export function logoutNoticeAction(source: string | undefined): LogoutNoticeAction {
  if (source === 'logout' || source === 'logout-waiting') return 'ignore'
  return 'pass'
}

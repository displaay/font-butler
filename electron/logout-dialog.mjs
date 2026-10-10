export const LOGOUT_FAILED_TITLE = "Logging out didn't happen"
export const LOGOUT_FAILED_DETAIL =
  'Use Apple menu > Log Out to finish rebuilding font caches.'

export function logoutFailedDialogOptions(message) {
  const detail =
    typeof message === 'string' && message.includes('Apple menu > Log Out')
      ? message
      : `${LOGOUT_FAILED_TITLE}. ${LOGOUT_FAILED_DETAIL}`
  return {
    type: 'warning',
    title: LOGOUT_FAILED_TITLE,
    message: LOGOUT_FAILED_TITLE,
    detail,
    buttons: ['OK'],
    defaultId: 0,
  }
}

/**
 * The dialog is the feedback the user sees. A native notification is optional
 * and must not be required: a new bundle id often has no notification permission.
 */
export function presentLogoutFailure({ showDialog, notify, message }) {
  showDialog(logoutFailedDialogOptions(message))
  try {
    notify?.()
  } catch {
    // Notification permission can drop this. The dialog already ran.
  }
}

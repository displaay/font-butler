export const LOGOUT_FAILED_TITLE = "Logging out didn't happen"
export const LOGOUT_FAILED_DETAIL =
  'Use Apple menu > Log Out to finish rebuilding font caches.'
export const LOGOUT_STILL_WAITING_TITLE = 'Still waiting for macOS'
export const LOGOUT_STILL_WAITING_MESSAGE =
  'Still waiting for macOS. If you allowed it, logout will continue. Otherwise use Apple menu > Log Out to finish rebuilding font caches.'

/** Cancel is a flag on the result. The message text is only what the dialog shows. */
export function logoutMenuResultAction(result) {
  if (result && result.cancelled === true) return 'cancelled'
  if (!result || result.requested === false) return 'failed'
  return 'accepted'
}

export function liveMessageBoxParent(win) {
  if (!win) return null
  if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return null
  return win
}

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

export function logoutWaitingNoticeOptions(message) {
  const detail =
    typeof message === 'string' && message.includes('Still waiting for macOS')
      ? message
      : LOGOUT_STILL_WAITING_MESSAGE
  return {
    type: 'info',
    title: LOGOUT_STILL_WAITING_TITLE,
    message: LOGOUT_STILL_WAITING_TITLE,
    detail,
    buttons: ['OK'],
    defaultId: 0,
  }
}

/**
 * Show a message box on the live window when one exists.
 * With no window, Electron still shows it, which is the menu-bar case.
 */
export function showLogoutMessageBox(dialogApi, parent, options) {
  const live = liveMessageBoxParent(parent)
  if (live) return dialogApi.showMessageBox(live, options)
  return dialogApi.showMessageBox(options)
}

/**
 * The dialog is the feedback the user sees. A native notification is optional
 * and must not be required: a new bundle id often has no notification permission.
 * `getParent` is read at show time so a window opened or closed during logout
 * is the one the dialog attaches to.
 */
export function presentLogoutFailure({ showDialog, notify, message, getParent }) {
  const parent = liveMessageBoxParent(typeof getParent === 'function' ? getParent() : null)
  const shown = showDialog(parent, logoutFailedDialogOptions(message))
  try {
    notify?.()
  } catch {
    // Notification permission can drop this. The dialog already ran.
  }
  return shown
}

/**
 * Late logout results are owned by the main process.
 * A failure opens one message box even when no BrowserWindow exists.
 * Still waiting is a notice, never that failure dialog. A visible renderer
 * shows the notice itself; otherwise main does, and a dropped notification
 * falls back to an info box that does not say logout failed.
 */
export function presentLogoutNotice({
  notice,
  getWindow,
  rendererVisible,
  showMessageBox,
  showWaitingNotice,
  notify,
}) {
  if (!notice || typeof notice !== 'object') return
  if (notice.source === 'logout-waiting') {
    if (rendererVisible) return
    let shown = false
    try {
      shown = notify?.(notice) === true
    } catch {
      shown = false
    }
    if (shown) return
    const parent = liveMessageBoxParent(typeof getWindow === 'function' ? getWindow() : null)
    showWaitingNotice(parent, logoutWaitingNoticeOptions(notice.message))
    return
  }
  if (notice.source !== 'logout') return
  const parent = liveMessageBoxParent(typeof getWindow === 'function' ? getWindow() : null)
  showMessageBox(parent, logoutFailedDialogOptions(notice.message))
  try {
    notify?.(notice)
  } catch {
    // The message box already ran.
  }
}

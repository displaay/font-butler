export const LOGOUT_CANCELLED = 'Log out was cancelled.'
export const LOGOUT_FAILED_TITLE = "Logging out didn't happen"
export const LOGOUT_FAILED_DETAIL =
  'Use Apple menu > Log Out to finish rebuilding font caches.'
export const LOGOUT_STILL_WAITING_TITLE = 'Still waiting for macOS'
export const LOGOUT_STILL_WAITING_MESSAGE =
  'Still waiting for macOS. If you allowed it, logout will continue. Otherwise use Apple menu > Log Out to finish rebuilding font caches.'
export const LOGOUT_PROBE_WOULD_START_TITLE = 'Test build'
export const LOGOUT_PROBE_WOULD_START_NOTICE = 'Test build: logout would start now'
export const LOGOUT_PROBE_WOULD_START_DETAIL =
  'Font Buttler did not log out, and it did not quit.'

export function logoutProbeWouldStartDialogOptions() {
  return {
    type: 'info',
    title: LOGOUT_PROBE_WOULD_START_TITLE,
    message: LOGOUT_PROBE_WOULD_START_NOTICE,
    detail: LOGOUT_PROBE_WOULD_START_DETAIL,
    buttons: ['OK'],
    defaultId: 0,
  }
}

/** Cancel is a flag on the result. The message text is only what the dialog shows. */
export function logoutMenuResultAction(result) {
  if (result && result.cancelled === true) return 'cancelled'
  if (!result || result.requested === false) return 'failed'
  return 'accepted'
}

/**
 * Probe Allow is not a logout success. The app stays open and shows that
 * logout would start. A real accepted logout stays `accepted`.
 */
export function logoutRequestFollowUp(result) {
  if (result && result.ignored === true) return 'ignore'
  if (
    result &&
    result.requested === true &&
    (result.probeAllowed === true || result.message === LOGOUT_PROBE_WOULD_START_NOTICE)
  ) {
    return 'probe-allowed'
  }
  return logoutMenuResultAction(result)
}

export function liveMessageBoxParent(win) {
  if (!win) return null
  if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return null
  return win
}

/** A hidden or minimized window would host the box as an invisible sheet. */
export function visibleMessageBoxParent(win) {
  const live = liveMessageBoxParent(win)
  if (!live) return null
  if (typeof live.isVisible === 'function' && live.isVisible() === false) return null
  if (typeof live.isMinimized === 'function' && live.isMinimized() === true) return null
  return live
}

export function shouldOfferLogoutAfterCacheClear(result) {
  return Boolean(result && result.cleared === true && result.simulated !== true)
}

/** A stamped test build offers the probe from the same Log out now spot. */
export function logoutOfferAfterCacheClear(result) {
  if (result && result.logoutProbe === true) return 'probe'
  if (shouldOfferLogoutAfterCacheClear(result)) return 'logout'
  return 'none'
}

/** Menu path after a font-cache clear. Test builds post the probe. */
export function menuLogoutPathAfterCacheClear(result) {
  const offer = logoutOfferAfterCacheClear(result)
  if (offer === 'probe') return '/api/session/logout-probe'
  if (offer === 'logout') return '/api/session/logout'
  return null
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

function logoutBoxHiddenReason(parent, hooks) {
  const live = liveMessageBoxParent(parent)
  if (!live) return 'no window'
  if (typeof hooks?.isAppHidden === 'function' && hooks.isAppHidden() === true) return 'app hidden'
  if (typeof live.isMinimized === 'function' && live.isMinimized() === true) return 'window minimized'
  if (typeof live.isVisible === 'function' && live.isVisible() === false) return 'window hidden'
  return null
}

/**
 * Parent only a window the user can see. Cmd-H hides the app while
 * `isVisible()` stays true, so an app-hidden, hidden, or minimized window
 * is shown and the box stays unparented. A sheet on that window never appears.
 */
export function showLogoutMessageBox(dialogApi, parent, options, hooks) {
  const reason = logoutBoxHiddenReason(parent, hooks)
  const log = (message) => hooks?.log?.(message)
  if (!reason) {
    log('logout dialog shown parented')
    return dialogApi.showMessageBox(parent, options)
  }
  if (liveMessageBoxParent(parent) && typeof hooks?.showMainWindow === 'function') {
    hooks.showMainWindow()
  }
  log(`logout dialog shown unparented; ${reason}`)
  return dialogApi.showMessageBox(options)
}

/**
 * The dialog is the feedback the user sees. A native notification is optional
 * and must not be required: a new bundle id often has no notification permission.
 * `getParent` is read at show time so a window opened or closed during logout
 * is the one the dialog attaches to.
 */
let logoutFailureDialogShown = false

export function resetLogoutDialogSession() {
  logoutFailureDialogShown = false
}

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
 * Still waiting is a notice, never that failure dialog. Main owns that notice
 * so a hidden renderer cannot drop it. A dropped notification falls back to
 * an info box that does not say logout failed.
 */
export function presentLogoutNotice({
  notice,
  getWindow,
  showMessageBox,
  showWaitingNotice,
  notify,
  log,
}) {
  const note = (message) => log?.(message)
  if (!notice || typeof notice !== 'object') {
    note('logout dialog skipped; notice missing')
    return
  }
  note(`logout notice received source=${notice.source || 'none'}`)
  const parent = liveMessageBoxParent(typeof getWindow === 'function' ? getWindow() : null)
  if (notice.source === 'logout-probe') {
    showWaitingNotice(parent, logoutProbeWouldStartDialogOptions())
    return
  }
  if (notice.source === 'logout-waiting') {
    if (logoutFailureDialogShown) {
      note('logout dialog skipped; failure dialog already shown')
      return
    }
    let shown = false
    try {
      shown = notify?.(notice) === true
    } catch {
      shown = false
    }
    if (shown) {
      note('logout dialog skipped; notification delivered')
      return
    }
    showWaitingNotice(parent, logoutWaitingNoticeOptions(notice.message))
    return
  }
  if (notice.source !== 'logout') {
    note(`logout dialog skipped; source=${notice.source || 'none'}`)
    return
  }
  if (logoutFailureDialogShown) {
    note('logout dialog skipped; failure dialog already shown')
    return
  }
  logoutFailureDialogShown = true
  showMessageBox(parent, logoutFailedDialogOptions(notice.message))
  try {
    notify?.(notice)
  } catch {
    // The message box already ran.
  }
}

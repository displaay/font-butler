/** Shown when the user dismisses the System Events logout confirm (-128). */
export const LOGOUT_CANCELLED = 'Log out was cancelled.'

/** Shown when Font Buttler cannot send the logout Apple event (for example -1743). */
export const LOGOUT_FALLBACK = 'Use Apple menu > Log Out'

export const LOGOUT_FAILED_TITLE = "Logging out didn't happen"
export const LOGOUT_FAILED_MESSAGE =
  "Logging out didn't happen. Use Apple menu > Log Out to finish rebuilding font caches."

export const LOGOUT_STILL_WAITING_TITLE = 'Still waiting for macOS'
export const LOGOUT_STILL_WAITING_MESSAGE =
  'Still waiting for macOS. If you allowed it, logout will continue. Otherwise use Apple menu > Log Out to finish rebuilding font caches.'

/**
 * Shown when the test-build Apple event is allowed.
 * Logout was not started, and the app does not quit.
 * Title, message, and detail are three different strings.
 */
export const LOGOUT_PROBE_WOULD_START_TITLE = 'Test build'
export const LOGOUT_PROBE_WOULD_START_NOTICE = 'Test build: logout would start now'
export const LOGOUT_PROBE_WOULD_START_DETAIL =
  'Font Buttler did not log out, and it did not quit.'

/**
 * Red close button on the main window.
 *
 * The window closes and the process stays running. On macOS, when the menu-bar
 * icon is still available and no other app window needs the Dock, the Dock icon
 * hides until a window is shown again. Quit is a separate path.
 */

/**
 * A window still needs the Dock when the user can see it, or it is minimized
 * into the Dock. Hidden and destroyed windows do not.
 */
export function appWindowNeedsDock(win) {
  if (!win) return false
  if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return false
  if (typeof win.isMinimized === 'function' && win.isMinimized()) return true
  return typeof win.isVisible === 'function' && win.isVisible()
}

/** True when some window other than the one that just closed still needs the Dock. */
export function otherAppWindowNeedsDock(windows, closingWindow) {
  return (windows ?? []).some((win) => win !== closingWindow && appWindowNeedsDock(win))
}

export function mainWindowCloseEffect({
  isQuitting = false,
  platform = 'darwin',
  menuBarIconEnabled = true,
  otherVisibleWindow = false,
} = {}) {
  return {
    allowClose: true,
    hideDock:
      !isQuitting &&
      platform === 'darwin' &&
      Boolean(menuBarIconEnabled) &&
      !otherVisibleWindow,
    keepMenuBar: true,
    quit: false,
  }
}

/** Last window closed. The menu bar, and macOS itself, keep the process alive. */
export function shouldQuitOnWindowAllClosed({
  platform = 'darwin',
  menuBarIconEnabled = true,
} = {}) {
  if (menuBarIconEnabled) return false
  return platform !== 'darwin'
}

export function shouldShowDockOnWindowShow({ platform = 'darwin' } = {}) {
  return platform === 'darwin'
}

export function applyMainWindowClosed({
  isQuitting = false,
  platform = 'darwin',
  menuBarIconEnabled = true,
  otherVisibleWindow = false,
  dock,
} = {}) {
  const effect = mainWindowCloseEffect({
    isQuitting,
    platform,
    menuBarIconEnabled,
    otherVisibleWindow,
  })
  if (effect.hideDock) dock?.hide?.()
  return effect
}

export function applyWindowShown({ platform = 'darwin', dock } = {}) {
  if (!shouldShowDockOnWindowShow({ platform })) return undefined
  return dock?.show?.()
}

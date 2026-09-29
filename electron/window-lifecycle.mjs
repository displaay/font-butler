/**
 * Red close button on the main window.
 *
 * The window closes and the process stays running. On macOS, when the menu-bar
 * icon is still available, the Dock icon hides until a window is shown again.
 * Quit (Font Buttler → Quit) is a separate path and does not hide the Dock here.
 */

export function mainWindowCloseEffect({
  isQuitting = false,
  platform = 'darwin',
  menuBarIconEnabled = true,
} = {}) {
  return {
    allowClose: true,
    hideDock: !isQuitting && platform === 'darwin' && Boolean(menuBarIconEnabled),
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
  dock,
} = {}) {
  const effect = mainWindowCloseEffect({ isQuitting, platform, menuBarIconEnabled })
  if (effect.hideDock) dock?.hide?.()
  return effect
}

export function applyWindowShown({ platform = 'darwin', dock } = {}) {
  if (!shouldShowDockOnWindowShow({ platform })) return undefined
  return dock?.show?.()
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  applyMainWindowClosed,
  applyWindowShown,
  appWindowNeedsDock,
  mainWindowCloseEffect,
  otherAppWindowNeedsDock,
  shouldQuitOnWindowAllClosed,
  shouldShowDockOnWindowShow,
} from './window-lifecycle.mjs'

function fakeDock() {
  const calls = []
  return {
    calls,
    hide() {
      calls.push('hide')
    },
    show() {
      calls.push('show')
      return Promise.resolve()
    },
  }
}

test('red close hides the Dock, keeps the menu bar, and does not quit', () => {
  const dock = fakeDock()
  const effect = applyMainWindowClosed({
    isQuitting: false,
    platform: 'darwin',
    menuBarIconEnabled: true,
    dock,
  })
  assert.deepEqual(effect, {
    allowClose: true,
    hideDock: true,
    keepMenuBar: true,
    quit: false,
  })
  assert.deepEqual(dock.calls, ['hide'])
})

function fakeWindow({ visible = false, minimized = false, destroyed = false } = {}) {
  return {
    isVisible: () => visible,
    isMinimized: () => minimized,
    isDestroyed: () => destroyed,
  }
}

test('red close keeps the Dock while another app window is visible', () => {
  const dock = fakeDock()
  const effect = applyMainWindowClosed({
    isQuitting: false,
    platform: 'darwin',
    menuBarIconEnabled: true,
    otherVisibleWindow: true,
    dock,
  })
  assert.equal(effect.hideDock, false)
  assert.equal(effect.keepMenuBar, true)
  assert.equal(effect.quit, false)
  assert.deepEqual(dock.calls, [])
})

test('the window that just closed does not keep the Dock by itself', () => {
  const closing = fakeWindow({ visible: true })
  const logs = fakeWindow({ visible: true })
  const hidden = fakeWindow({ visible: false })
  const minimized = fakeWindow({ minimized: true })
  const destroyed = fakeWindow({ visible: true, destroyed: true })
  assert.equal(appWindowNeedsDock(null), false)
  assert.equal(appWindowNeedsDock(destroyed), false)
  assert.equal(appWindowNeedsDock(hidden), false)
  assert.equal(appWindowNeedsDock(logs), true)
  assert.equal(appWindowNeedsDock(minimized), true)
  assert.equal(otherAppWindowNeedsDock([closing], closing), false)
  assert.equal(otherAppWindowNeedsDock([closing, hidden, destroyed], closing), false)
  assert.equal(otherAppWindowNeedsDock([closing, logs], closing), true)
  assert.equal(otherAppWindowNeedsDock([closing, minimized], closing), true)
})

test('quitting does not hide the Dock from the window close path', () => {
  const dock = fakeDock()
  const effect = applyMainWindowClosed({
    isQuitting: true,
    platform: 'darwin',
    menuBarIconEnabled: true,
    dock,
  })
  assert.equal(effect.hideDock, false)
  assert.equal(effect.quit, false)
  assert.deepEqual(dock.calls, [])
})

test('Dock stays when the menu bar icon is off so the app can be reopened from it', () => {
  const dock = fakeDock()
  const effect = applyMainWindowClosed({
    isQuitting: false,
    platform: 'darwin',
    menuBarIconEnabled: false,
    dock,
  })
  assert.equal(effect.allowClose, true)
  assert.equal(effect.hideDock, false)
  assert.equal(effect.keepMenuBar, true)
  assert.equal(effect.quit, false)
  assert.deepEqual(dock.calls, [])
})

test('non-mac close does not touch the Dock', () => {
  const dock = fakeDock()
  const effect = mainWindowCloseEffect({
    isQuitting: false,
    platform: 'linux',
    menuBarIconEnabled: true,
  })
  applyMainWindowClosed({
    isQuitting: false,
    platform: 'linux',
    menuBarIconEnabled: true,
    dock,
  })
  assert.equal(effect.hideDock, false)
  assert.equal(effect.quit, false)
  assert.deepEqual(dock.calls, [])
})

test('showing a window restores the Dock on macOS', () => {
  const dock = fakeDock()
  const shown = applyWindowShown({ platform: 'darwin', dock })
  assert.equal(shouldShowDockOnWindowShow({ platform: 'darwin' }), true)
  assert.equal(typeof shown?.then, 'function')
  assert.deepEqual(dock.calls, ['show'])
})

test('showing a window does not restore a Dock on other platforms', () => {
  const dock = fakeDock()
  const shown = applyWindowShown({ platform: 'win32', dock })
  assert.equal(shown, undefined)
  assert.deepEqual(dock.calls, [])
})

test('closing the last window does not quit while the menu bar or macOS can reopen it', () => {
  assert.equal(shouldQuitOnWindowAllClosed({ platform: 'darwin', menuBarIconEnabled: true }), false)
  assert.equal(shouldQuitOnWindowAllClosed({ platform: 'darwin', menuBarIconEnabled: false }), false)
  assert.equal(shouldQuitOnWindowAllClosed({ platform: 'linux', menuBarIconEnabled: true }), false)
  assert.equal(shouldQuitOnWindowAllClosed({ platform: 'linux', menuBarIconEnabled: false }), true)
})

test('main process closes the window, hides the Dock, and shows it again with the window', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(main, /applyMainWindowClosed\(/)
  assert.match(main, /applyWindowShown\(/)
  assert.match(main, /otherAppWindowNeedsDock\(BrowserWindow\.getAllWindows\(\), closingWindow\)/)
  assert.match(main, /shouldQuitOnWindowAllClosed\(/)
  assert.match(main, /label: 'Show Font Buttler'/)
  assert.match(main, /function openDebugConsole\(\) \{\n  showDockIcon\(\)\n  showDebugConsole\(/)
  assert.doesNotMatch(main, /mainWindow\?\.hide\(\)/)
  assert.doesNotMatch(main, /event\.preventDefault\(\)\s*\n\s*mainWindow\?\.hide\(\)/)
})

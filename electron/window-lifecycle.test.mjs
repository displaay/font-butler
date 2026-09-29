import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  applyMainWindowClosed,
  applyWindowShown,
  mainWindowCloseEffect,
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
  assert.match(main, /shouldQuitOnWindowAllClosed\(/)
  assert.match(main, /label: 'Show Font Buttler'/)
  assert.doesNotMatch(main, /mainWindow\?\.hide\(\)/)
  assert.doesNotMatch(main, /event\.preventDefault\(\)\s*\n\s*mainWindow\?\.hide\(\)/)
})

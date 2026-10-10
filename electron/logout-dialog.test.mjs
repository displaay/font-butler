import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { logoutFailedDialogOptions, presentLogoutFailure } from './logout-dialog.mjs'

const FAILURES = [
  'osascript is not allowed to send keystrokes. (-1743)',
  'osascript failed: Application is not running. (-600)',
  'spawn osascript ETIMEDOUT timed out',
]

test('a logout failure dialog appears when notifications are unavailable', () => {
  for (const error of FAILURES) {
    const dialogs = []
    let notified = 0
    presentLogoutFailure({
      message: "Logging out didn't happen. Use Apple menu > Log Out to finish rebuilding font caches.",
      showDialog(options) {
        dialogs.push(options)
      },
      notify() {
        notified += 1
        throw new Error(`notifications unavailable: ${error}`)
      },
    })
    assert.equal(dialogs.length, 1, error)
    assert.equal(dialogs[0].title, "Logging out didn't happen")
    assert.match(dialogs[0].message, /Logging out didn't happen/)
    assert.match(dialogs[0].detail, /Apple menu > Log Out/)
    assert.match(dialogs[0].detail, /rebuilding font caches/)
    assert.equal(notified, 1, error)
  }

  const fallback = logoutFailedDialogOptions('Could not log out')
  assert.match(fallback.detail, /Logging out didn't happen/)
  assert.match(fallback.detail, /Apple menu > Log Out/)

  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(main, /presentLogoutFailure/)
  assert.match(main, /source === 'logout'/)
  assert.match(main, /showMainWindow\(\)/)
})

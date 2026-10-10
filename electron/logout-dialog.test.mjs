import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LOGOUT_FAILED_MESSAGE,
  LOGOUT_STILL_WAITING_MESSAGE,
} from '../shared/logout.ts'
import {
  liveMessageBoxParent,
  logoutFailedDialogOptions,
  logoutMenuResultAction,
  logoutWaitingNoticeOptions,
  presentLogoutFailure,
  presentLogoutNotice,
  showLogoutMessageBox,
} from './logout-dialog.mjs'

const FAILURES = [
  'osascript is not allowed to send keystrokes. (-1743)',
  'osascript failed: Application is not running. (-600)',
  'spawn osascript ETIMEDOUT timed out',
]

function failureNotice(message = LOGOUT_FAILED_MESSAGE) {
  return { kind: 'warning', source: 'logout', message }
}

function waitingNotice() {
  return { kind: 'info', source: 'logout-waiting', message: LOGOUT_STILL_WAITING_MESSAGE }
}

test('a logout failure dialog appears when notifications are unavailable', () => {
  for (const error of FAILURES) {
    const dialogs = []
    let notified = 0
    presentLogoutFailure({
      message: LOGOUT_FAILED_MESSAGE,
      getParent: () => null,
      showDialog(parent, options) {
        dialogs.push({ parent, options })
      },
      notify() {
        notified += 1
        throw new Error(`notifications unavailable: ${error}`)
      },
    })
    assert.equal(dialogs.length, 1, error)
    assert.equal(dialogs[0].parent, null)
    assert.equal(dialogs[0].options.title, "Logging out didn't happen")
    assert.match(dialogs[0].options.message, /Logging out didn't happen/)
    assert.match(dialogs[0].options.detail, /Apple menu > Log Out/)
    assert.match(dialogs[0].options.detail, /rebuilding font caches/)
    assert.equal(notified, 1, error)
  }

  const fallback = logoutFailedDialogOptions('Could not log out')
  assert.equal(fallback.detail, LOGOUT_FAILED_MESSAGE)
  assert.match(fallback.detail, /Logging out didn't happen/)
  assert.match(fallback.detail, /Apple menu > Log Out/)
})

test('logout cancel is a flag, not the message text', () => {
  assert.equal(
    logoutMenuResultAction({ requested: false, cancelled: true, message: 'The confirm was dismissed.' }),
    'cancelled',
  )
  assert.equal(
    logoutMenuResultAction({ requested: false, message: 'Log out was cancelled.' }),
    'failed',
  )
  assert.equal(logoutMenuResultAction({ requested: false, message: LOGOUT_FAILED_MESSAGE }), 'failed')
  assert.equal(logoutMenuResultAction({ requested: true }), 'accepted')
  assert.equal(logoutMenuResultAction(null), 'failed')
})

test('a late logout failure shows one dialog when no window exists', () => {
  const dialogs = []
  const waiting = []
  presentLogoutNotice({
    notice: failureNotice(),
    getWindow: () => null,
    rendererVisible: false,
    showMessageBox(parent, options) {
      dialogs.push({ parent, options })
    },
    showWaitingNotice(parent, options) {
      waiting.push({ parent, options })
    },
    notify() {
      throw new Error('notifications unavailable')
    },
  })
  assert.equal(waiting.length, 0)
  assert.equal(dialogs.length, 1)
  assert.equal(dialogs[0].parent, null)
  assert.equal(dialogs[0].options.title, "Logging out didn't happen")
  assert.equal(dialogs[0].options.detail, LOGOUT_FAILED_MESSAGE)

  const calls = []
  showLogoutMessageBox(
    {
      showMessageBox(...args) {
        calls.push(args)
      },
    },
    null,
    dialogs[0].options,
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, 1)
  assert.equal(calls[0][0].title, "Logging out didn't happen")
})

test('a late logout failure is parented to the live main window', () => {
  const win = { id: 'main', isDestroyed: () => false }
  const destroyed = { id: 'gone', isDestroyed: () => true }
  const dialogs = []
  presentLogoutNotice({
    notice: failureNotice(),
    getWindow: () => win,
    rendererVisible: true,
    showMessageBox(parent, options) {
      dialogs.push({ parent, options })
    },
    showWaitingNotice() {
      throw new Error('waiting notice is not the failure dialog')
    },
    notify() {
      return false
    },
  })
  assert.equal(dialogs.length, 1)
  assert.equal(dialogs[0].parent, win)

  const calls = []
  const dialogApi = {
    showMessageBox(...args) {
      calls.push(args)
    },
  }
  showLogoutMessageBox(dialogApi, win, dialogs[0].options)
  showLogoutMessageBox(dialogApi, destroyed, dialogs[0].options)
  assert.equal(calls[0][0], win)
  assert.equal(calls[0][1].title, "Logging out didn't happen")
  assert.equal(calls[1].length, 1)
  assert.equal(liveMessageBoxParent(destroyed), null)
  assert.equal(liveMessageBoxParent(null), null)
})

test('a wait notice is not a failure dialog, and a later -1743 opens the failure dialog once', () => {
  const failureDialogs = []
  const waitingNotices = []
  const present = (notice, notify) =>
    presentLogoutNotice({
      notice,
      getWindow: () => null,
      rendererVisible: false,
      showMessageBox(parent, options) {
        failureDialogs.push({ parent, options })
      },
      showWaitingNotice(parent, options) {
        waitingNotices.push({ parent, options })
      },
      notify,
    })

  present(waitingNotice(), () => false)
  assert.equal(failureDialogs.length, 0)
  assert.equal(waitingNotices.length, 1)
  assert.equal(waitingNotices[0].parent, null)
  assert.equal(waitingNotices[0].options.title, 'Still waiting for macOS')
  assert.equal(waitingNotices[0].options.detail, LOGOUT_STILL_WAITING_MESSAGE)
  assert.equal(waitingNotices[0].options.type, 'info')
  assert.doesNotMatch(waitingNotices[0].options.detail, /didn't happen/)

  present(waitingNotice(), () => {
    throw new Error('notifications unavailable')
  })
  assert.equal(waitingNotices.length, 2)
  assert.equal(failureDialogs.length, 0)

  present(failureNotice(`denied (-1743) ${LOGOUT_FAILED_MESSAGE}`), () => {
    throw new Error('notifications unavailable')
  })
  assert.equal(failureDialogs.length, 1)
  assert.match(failureDialogs[0].options.detail, /-1743/)
  assert.match(failureDialogs[0].options.detail, /Logging out didn't happen/)

  const hidden = []
  presentLogoutNotice({
    notice: waitingNotice(),
    getWindow: () => null,
    rendererVisible: false,
    showMessageBox() {
      hidden.push('failure')
    },
    showWaitingNotice() {
      hidden.push('waiting')
    },
    notify: () => true,
  })
  assert.deepEqual(hidden, [])

  const visible = []
  presentLogoutNotice({
    notice: waitingNotice(),
    getWindow: () => ({ isDestroyed: () => false }),
    rendererVisible: true,
    showMessageBox() {
      visible.push('failure')
    },
    showWaitingNotice() {
      visible.push('waiting')
    },
    notify: () => false,
  })
  assert.deepEqual(visible, [])
  assert.equal(logoutWaitingNoticeOptions().detail, LOGOUT_STILL_WAITING_MESSAGE)
})

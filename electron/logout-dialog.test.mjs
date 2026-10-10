import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import {
  LOGOUT_CANCELLED as SHARED_LOGOUT_CANCELLED,
  LOGOUT_FAILED_MESSAGE,
  LOGOUT_PROBE_SIMULATED_NOTICE as SHARED_LOGOUT_PROBE_SIMULATED_NOTICE,
  LOGOUT_STILL_WAITING_MESSAGE,
} from '../shared/logout.ts'
import {
  LOGOUT_CANCELLED,
  liveMessageBoxParent,
  logoutFailedDialogOptions,
  logoutMenuResultAction,
  logoutWaitingNoticeOptions,
  LOGOUT_PROBE_SIMULATED_NOTICE,
  logoutOfferAfterCacheClear,
  presentLogoutFailure,
  presentLogoutNotice,
  resetLogoutDialogSession,
  shouldOfferLogoutAfterCacheClear,
  showLogoutMessageBox,
  visibleMessageBoxParent,
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
  resetLogoutDialogSession()
  const dialogs = []
  const waiting = []
  presentLogoutNotice({
    notice: failureNotice(),
    getWindow: () => null,
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
  resetLogoutDialogSession()
  const win = { id: 'main', isDestroyed: () => false }
  const destroyed = { id: 'gone', isDestroyed: () => true }
  const dialogs = []
  presentLogoutNotice({
    notice: failureNotice(),
    getWindow: () => win,
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
  resetLogoutDialogSession()
  const failureDialogs = []
  const waitingNotices = []
  const present = (notice, notify) =>
    presentLogoutNotice({
      notice,
      getWindow: () => null,
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

  const skipped = []
  presentLogoutNotice({
    notice: waitingNotice(),
    getWindow: () => ({ isDestroyed: () => false }),
    showMessageBox() {
      skipped.push('failure')
    },
    showWaitingNotice() {
      skipped.push('waiting')
    },
    notify: () => true,
  })
  assert.deepEqual(skipped, [])

  present(failureNotice(`denied (-1743) ${LOGOUT_FAILED_MESSAGE}`), () => {
    throw new Error('notifications unavailable')
  })
  assert.equal(failureDialogs.length, 1)
  assert.match(failureDialogs[0].options.detail, /-1743/)
  assert.match(failureDialogs[0].options.detail, /Logging out didn't happen/)

  present(failureNotice(`denied (-1743) ${LOGOUT_FAILED_MESSAGE}`), () => false)
  assert.equal(failureDialogs.length, 1)
  present(waitingNotice(), () => false)
  assert.equal(waitingNotices.length, 2)
  assert.equal(logoutWaitingNoticeOptions().detail, LOGOUT_STILL_WAITING_MESSAGE)
})

test('a hidden or minimized window is shown before the logout box is parented', () => {
  resetLogoutDialogSession()
  const options = logoutFailedDialogOptions(LOGOUT_FAILED_MESSAGE)
  const dialogApi = {
    showMessageBox(...args) {
      dialogApi.calls.push(args)
    },
    calls: [],
  }

  function windowState(mode) {
    const state = { visible: mode !== 'hidden', minimized: mode === 'minimized' }
    const win = {
      id: mode,
      isDestroyed: () => false,
      isVisible: () => state.visible,
      isMinimized: () => state.minimized,
    }
    return { state, win }
  }

  for (const mode of ['hidden', 'minimized']) {
    dialogApi.calls = []
    const { state, win } = windowState(mode)
    let revealed = 0
    assert.equal(visibleMessageBoxParent(win), null, mode)
    showLogoutMessageBox(dialogApi, win, options, {
      showMainWindow() {
        revealed += 1
        state.visible = true
        state.minimized = false
      },
      getWindow: () => win,
    })
    assert.equal(revealed, 1, mode)
    assert.equal(dialogApi.calls.length, 1, mode)
    assert.equal(dialogApi.calls[0][0], win, mode)
    assert.equal(dialogApi.calls[0][1].title, "Logging out didn't happen")
  }

  for (const mode of ['hidden', 'minimized']) {
    dialogApi.calls = []
    const { win } = windowState(mode)
    let revealed = 0
    showLogoutMessageBox(dialogApi, win, options, {
      showMainWindow() {
        revealed += 1
      },
      getWindow: () => win,
    })
    assert.equal(revealed, 1, mode)
    assert.equal(dialogApi.calls.length, 1, mode)
    assert.equal(dialogApi.calls[0].length, 1, mode)
    assert.equal(dialogApi.calls[0][0].title, "Logging out didn't happen")
  }

  const bare = { isDestroyed: () => false }
  dialogApi.calls = []
  showLogoutMessageBox(dialogApi, bare, options)
  assert.equal(dialogApi.calls[0][0], bare)
  assert.equal(visibleMessageBoxParent(bare), bare)
})

test('the main process shows the waiting box while a window is open', () => {
  resetLogoutDialogSession()
  const shown = []
  const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false }
  presentLogoutNotice({
    notice: waitingNotice(),
    getWindow: () => win,
    showMessageBox() {
      shown.push('failure')
    },
    showWaitingNotice(parent, options) {
      showLogoutMessageBox(
        {
          showMessageBox(...args) {
            shown.push(args.length === 2 ? 'parented' : 'unparented')
            assert.equal(args.at(-1).title, options.title)
          },
        },
        parent,
        options,
      )
    },
    notify: () => false,
  })
  assert.deepEqual(shown, ['parented'])
})

test('a test-build logout probe success shows the simulated notice', () => {
  assert.equal(LOGOUT_PROBE_SIMULATED_NOTICE, SHARED_LOGOUT_PROBE_SIMULATED_NOTICE)
  assert.equal(LOGOUT_PROBE_SIMULATED_NOTICE, 'Test build: logout simulated')
  const shown = []
  const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false }
  presentLogoutNotice({
    notice: { kind: 'info', source: 'logout-probe', message: LOGOUT_PROBE_SIMULATED_NOTICE },
    getWindow: () => win,
    showMessageBox() {
      shown.push('failure')
    },
    showWaitingNotice(_parent, options) {
      shown.push(options.message)
    },
    notify: () => false,
  })
  assert.deepEqual(shown, [LOGOUT_PROBE_SIMULATED_NOTICE])
  resetLogoutDialogSession()
  const afterFailure = []
  presentLogoutNotice({
    notice: failureNotice(),
    getWindow: () => win,
    showMessageBox() {
      afterFailure.push('failure')
    },
    showWaitingNotice() {
      afterFailure.push('waiting')
    },
    notify: () => false,
  })
  assert.deepEqual(afterFailure, ['failure'])
})

test('logout cancel uses the shared cancelled message', () => {
  assert.equal(LOGOUT_CANCELLED, SHARED_LOGOUT_CANCELLED)
  assert.equal(LOGOUT_CANCELLED, 'Log out was cancelled.')
  const main = fs.readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(main, /result\.message \|\| LOGOUT_CANCELLED/)
  assert.equal(shouldOfferLogoutAfterCacheClear({ mac: true, cleared: true }), true)
  assert.equal(shouldOfferLogoutAfterCacheClear({ mac: true, cleared: true, simulated: true }), false)
  assert.equal(shouldOfferLogoutAfterCacheClear({ mac: true, cleared: false, simulated: true }), false)
  assert.equal(shouldOfferLogoutAfterCacheClear({ mac: false, cleared: false }), false)
  assert.equal(shouldOfferLogoutAfterCacheClear(null), false)
  assert.equal(
    logoutOfferAfterCacheClear({ mac: true, cleared: false, simulated: true, logoutProbe: true }),
    'probe',
  )
  assert.equal(logoutOfferAfterCacheClear({ mac: true, cleared: false, simulated: true }), 'none')
  assert.equal(logoutOfferAfterCacheClear({ mac: true, cleared: true }), 'logout')
  assert.match(main, /\/api\/session\/logout-probe/)
  assert.match(main, /logoutOfferAfterCacheClear/)
})

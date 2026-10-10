import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setBuildIdentityCandidatesForTests } from '../core/build-identity.ts'
import {
  logoutResultFromExecError,
  requestLogoutProbe,
  resetLogoutAttemptIdsForTests,
  resetLogoutProbe,
  resetSharedMacLogout,
  setMacLogoutExecForTests,
  shareMacLogout,
} from '../core/caches.ts'
import { onEvent } from '../core/events.ts'
import { emitLateLogoutFailure, emitLogoutWaitNotice, FontButlerService } from '../core/service.ts'
import {
  LOGOUT_CANCELLED as SHARED_LOGOUT_CANCELLED,
  LOGOUT_FAILED_MESSAGE,
  LOGOUT_PROBE_WOULD_START_DETAIL as SHARED_LOGOUT_PROBE_WOULD_START_DETAIL,
  LOGOUT_PROBE_WOULD_START_NOTICE as SHARED_LOGOUT_PROBE_WOULD_START_NOTICE,
  LOGOUT_PROBE_WOULD_START_TITLE as SHARED_LOGOUT_PROBE_WOULD_START_TITLE,
  LOGOUT_STILL_WAITING_MESSAGE,
} from '../shared/logout.ts'
import {
  LOGOUT_CANCELLED,
  liveMessageBoxParent,
  logoutFailedDialogOptions,
  logoutMenuResultAction,
  logoutWaitingNoticeOptions,
  LOGOUT_PROBE_WOULD_START_DETAIL,
  LOGOUT_PROBE_WOULD_START_NOTICE,
  LOGOUT_PROBE_WOULD_START_TITLE,
  logoutOfferAfterCacheClear,
  logoutProbeWouldStartDialogOptions,
  logoutRequestFollowUp,
  menuLogoutPathAfterCacheClear,
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

test('a hidden or minimized window is shown and the logout box stays unparented', () => {
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
    assert.equal(dialogApi.calls[0].length, 1, mode)
    assert.equal(dialogApi.calls[0][0].title, "Logging out didn't happen")
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

  const cmdH = {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
  }
  dialogApi.calls = []
  let revealed = 0
  showLogoutMessageBox(dialogApi, cmdH, options, {
    showMainWindow() {
      revealed += 1
    },
    isAppHidden: () => true,
  })
  assert.equal(revealed, 1)
  assert.equal(dialogApi.calls.length, 1)
  assert.equal(dialogApi.calls[0].length, 1)
  assert.equal(dialogApi.calls[0][0].title, "Logging out didn't happen")
})

test('a hidden window shows one logout failure box for a late probe or release denial', async () => {
  const serviceSource = fs.readFileSync(new URL('../core/service.ts', import.meta.url), 'utf8')
  assert.equal(serviceSource.split('emitLateLogoutFailure(result)').length - 1, 2)
  const denied = { stderr: 'osascript is not allowed to send keystrokes. (-1743)' }

  async function oneHiddenFailureBox(run) {
    resetLogoutDialogSession()
    const calls = []
    const notices = []
    const win = {
      isDestroyed: () => false,
      isVisible: () => false,
      isMinimized: () => false,
    }
    const dialogApi = {
      showMessageBox(...args) {
        calls.push(args)
      },
    }
    const hooks = {
      showMainWindow() {},
      getWindow: () => win,
      log(message) {
        notices.push(message)
      },
    }
    let boxes = 0
    const showBox = (parent, options, attemptId) => {
      boxes += 1
      return showLogoutMessageBox(dialogApi, parent, options, { ...hooks, attemptId })
    }
    const stop = onEvent((event) => {
      if (!event || event.type !== 'notice') return
      notices.push(event.notice.source)
      presentLogoutNotice({
        notice: event.notice,
        getWindow: () => win,
        log(message) {
          notices.push(message)
        },
        showMessageBox: showBox,
        showWaitingNotice: showBox,
        notify: () => false,
      })
    })
    try {
      await run()
      assert.equal(boxes, 1)
      assert.equal(calls.length, 1)
      assert.equal(calls[0].length, 1)
      assert.equal(calls[0][0].title, "Logging out didn't happen")
      assert.equal(
        notices.filter((item) => item === 'logout').length,
        1,
      )
      assert.equal(notices.includes('logout-probe'), false)
      const received = notices.find((item) =>
        String(item).startsWith('logout notice received source=logout attemptId='),
      )
      assert.equal(typeof received, 'string')
      const attemptId = String(received).split('attemptId=')[1]
      assert.match(attemptId, /^logout-/)
      assert.equal(
        notices.includes(`logout dialog shown unparented; window hidden attemptId=${attemptId}`),
        true,
      )
    } finally {
      stop()
      resetLogoutDialogSession()
    }
  }

  const identityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-identity-'))
  const identityFile = path.join(identityDir, 'build-identity.json')
  fs.writeFileSync(identityFile, '{"testBuild":true}\n')
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-logout-hidden-'))
  const paths = {
    dataRoot,
    catalogPath: path.join(dataRoot, 'catalog.json'),
    settingsPath: path.join(dataRoot, 'settings.json'),
    apiTokenPath: path.join(dataRoot, 'token'),
    installDir: path.join(dataRoot, 'install'),
    disabledDir: path.join(dataRoot, 'disabled'),
    sourcesDir: path.join(dataRoot, 'sources'),
    uploadsDir: path.join(dataRoot, 'uploads'),
    systemCachePath: path.join(dataRoot, 'system.json'),
    seedDir: path.join(dataRoot, 'seed'),
    userFontsDir: path.join(dataRoot, 'user-fonts'),
    computerFontsDir: path.join(dataRoot, 'computer-fonts'),
    systemFontsDir: path.join(dataRoot, 'system-fonts'),
    supplementalFontsDir: path.join(dataRoot, 'supplemental'),
    officeFontCacheDir: path.join(dataRoot, 'office-cache'),
    atsCacheDir: path.join(dataRoot, 'ats-cache'),
    adobeFontsDir: path.join(dataRoot, 'adobe-fonts'),
  }
  setBuildIdentityCandidatesForTests([identityFile])
  let finishProbe = () => {}
  setMacLogoutExecForTests((_file, _args, callback) => {
    finishProbe = () => callback(denied)
    return { unref() {} }
  })
  resetLogoutProbe()
  const service = new FontButlerService(paths)
  try {
    await oneHiddenFailureBox(async () => {
      const acceptedPromise = service.requestLogoutProbe()
      await new Promise((resolve) => setTimeout(resolve, 1100))
      const accepted = await acceptedPromise
      assert.equal(accepted.requested, true)
      finishProbe()
    })

    await oneHiddenFailureBox(async () => {
      resetSharedMacLogout()
      let finishRelease = () => {}
      const acceptedPromise = shareMacLogout(
        (report) => {
          finishRelease = () => report(logoutResultFromExecError(denied))
        },
        emitLateLogoutFailure,
        undefined,
        20,
      )
      await new Promise((resolve) => setTimeout(resolve, 40))
      const accepted = await acceptedPromise
      assert.equal(accepted.requested, true)
      finishRelease()
    })
  } finally {
    service.dispose()
    setMacLogoutExecForTests(null)
    setBuildIdentityCandidatesForTests(null)
    resetLogoutProbe()
    resetSharedMacLogout()
    fs.rmSync(identityDir, { recursive: true, force: true })
    fs.rmSync(dataRoot, { recursive: true, force: true })
  }
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

test('a test-build Allow shows that logout would start and is not a logout success', () => {
  assert.equal(LOGOUT_PROBE_WOULD_START_NOTICE, SHARED_LOGOUT_PROBE_WOULD_START_NOTICE)
  assert.equal(LOGOUT_PROBE_WOULD_START_TITLE, SHARED_LOGOUT_PROBE_WOULD_START_TITLE)
  assert.equal(LOGOUT_PROBE_WOULD_START_DETAIL, SHARED_LOGOUT_PROBE_WOULD_START_DETAIL)
  assert.equal(LOGOUT_PROBE_WOULD_START_NOTICE, 'Test build: logout would start now')
  const probeBox = logoutProbeWouldStartDialogOptions()
  assert.equal(probeBox.title, 'Test build')
  assert.equal(probeBox.message, 'Test build: logout would start now')
  assert.equal(probeBox.detail, 'Font Buttler did not log out, and it did not quit.')
  assert.notEqual(probeBox.title, probeBox.message)
  assert.notEqual(probeBox.detail, probeBox.message)
  assert.notEqual(probeBox.title, probeBox.detail)
  const allowed = {
    requested: true,
    probeAllowed: true,
    message: LOGOUT_PROBE_WOULD_START_NOTICE,
  }
  assert.equal(logoutRequestFollowUp(allowed), 'probe-allowed')
  assert.equal(logoutMenuResultAction(allowed), 'accepted')
  assert.equal(logoutRequestFollowUp({ requested: true }), 'accepted')
  const shown = []
  const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false }
  presentLogoutNotice({
    notice: { kind: 'info', source: 'logout-probe', message: LOGOUT_PROBE_WOULD_START_NOTICE },
    getWindow: () => win,
    showMessageBox() {
      shown.push('failure')
    },
    showWaitingNotice(_parent, options) {
      shown.push(options)
    },
    notify: () => false,
  })
  assert.equal(shown.length, 1)
  assert.equal(shown[0].title, LOGOUT_PROBE_WOULD_START_TITLE)
  assert.equal(shown[0].message, LOGOUT_PROBE_WOULD_START_NOTICE)
  assert.equal(shown[0].detail, LOGOUT_PROBE_WOULD_START_DETAIL)
  assert.notEqual(shown[0].title, shown[0].message)
  assert.notEqual(shown[0].detail, shown[0].message)
  assert.equal(shown.includes("Logging out didn't happen"), false)
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
  assert.equal(
    logoutOfferAfterCacheClear({ mac: true, cleared: true, logoutProbe: true }),
    'probe',
  )
  assert.equal(logoutOfferAfterCacheClear({ mac: true, cleared: false, simulated: true }), 'none')
  assert.equal(logoutOfferAfterCacheClear({ mac: true, cleared: true }), 'logout')
  assert.equal(
    menuLogoutPathAfterCacheClear({ mac: true, cleared: true, logoutProbe: true }),
    '/api/session/logout-probe',
  )
  assert.equal(menuLogoutPathAfterCacheClear({ mac: true, cleared: true }), '/api/session/logout')
  assert.equal(menuLogoutPathAfterCacheClear({ mac: true, cleared: false, simulated: true }), null)
  assert.match(main, /menuLogoutPathAfterCacheClear/)
  assert.match(main, /logoutProbeWouldStartDialogOptions/)
  assert.doesNotMatch(main, /title: LOGOUT_PROBE_WOULD_START_NOTICE/)
})

test('each logout attempt shows one failure box and logs its own attemptId', async () => {
  resetLogoutDialogSession()
  resetLogoutProbe()
  resetLogoutAttemptIdsForTests()
  const logFile = path.join(os.tmpdir(), `font-butler-logout-attempts-${process.pid}.log`)
  const previousLog = process.env.FONT_BUTLER_LOG
  process.env.FONT_BUTLER_LOG = logFile
  fs.rmSync(logFile, { force: true })

  const failureCalls = []
  const waitingCalls = []
  const notices = []
  const win = {
    isDestroyed: () => false,
    isVisible: () => false,
    isMinimized: () => false,
  }
  const dialogApi = {
    showMessageBox() {},
  }
  const present = (notice) =>
    presentLogoutNotice({
      notice,
      getWindow: () => win,
      log(message) {
        notices.push(message)
      },
      showMessageBox(parent, options, attemptId) {
        failureCalls.push({ attemptId, title: options.title })
        return showLogoutMessageBox(dialogApi, parent, options, {
          showMainWindow() {},
          getWindow: () => win,
          attemptId,
          log(message) {
            notices.push(message)
          },
        })
      },
      showWaitingNotice(parent, options, attemptId) {
        waitingCalls.push({ attemptId, title: options.title })
        return showLogoutMessageBox(dialogApi, parent, options, {
          showMainWindow() {},
          getWindow: () => win,
          attemptId,
          log(message) {
            notices.push(message)
          },
        })
      },
      notify: () => false,
    })
  const stop = onEvent((event) => {
    if (!event || event.type !== 'notice') return
    present(event.notice)
  })
  const denied = { stderr: 'osascript is not allowed to send keystrokes. (-1743)' }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  function hangingExec() {
    let finish = () => {}
    return {
      exec(_file, _args, callback) {
        finish = () => callback(denied)
        return { unref() {} }
      },
      deny() {
        finish()
      },
    }
  }

  try {
    const firstExec = hangingExec()
    let joinedLate = 0
    const first = requestLogoutProbe(
      { testBuild: true },
      {
        acceptAfterMs: 20,
        stillWaitingAfterMs: 60_000,
        exec: firstExec.exec,
        onLateFailure: emitLateLogoutFailure,
        onStillWaiting: emitLogoutWaitNotice,
      },
    )
    const joined = requestLogoutProbe(
      { testBuild: true },
      {
        onLateFailure() {
          joinedLate += 1
          throw new Error('joined click must not install a second failure handler')
        },
      },
    )
    assert.equal(joined, first)
    await sleep(40)
    const accepted = await first
    assert.equal(accepted.requested, true)
    const id1 = accepted.attemptId
    assert.match(id1, /^logout-/)
    firstExec.deny()
    await sleep(30)
    assert.equal(joinedLate, 0)
    assert.equal(failureCalls.length, 1)
    assert.equal(failureCalls[0].attemptId, id1)
    assert.equal(waitingCalls.length, 0)

    present({
      kind: 'warning',
      source: 'logout',
      message: LOGOUT_FAILED_MESSAGE,
      attemptId: id1,
    })
    assert.equal(failureCalls.length, 1)
    assert.equal(
      notices.includes(`logout dialog skipped; failure dialog already shown attemptId=${id1}`),
      true,
    )

    const secondExec = hangingExec()
    const second = requestLogoutProbe(
      { testBuild: true },
      {
        acceptAfterMs: 15,
        stillWaitingAfterMs: 25,
        exec: secondExec.exec,
        onLateFailure: emitLateLogoutFailure,
        onStillWaiting: emitLogoutWaitNotice,
      },
    )
    assert.notEqual(second, first)
    await sleep(50)
    const accepted2 = await second
    assert.equal(accepted2.requested, true)
    const id2 = accepted2.attemptId
    assert.match(id2, /^logout-/)
    assert.notEqual(id2, id1)
    assert.equal(waitingCalls.length, 1)
    assert.equal(waitingCalls[0].attemptId, id2)
    assert.equal(waitingCalls[0].title, 'Still waiting for macOS')
    secondExec.deny()
    await sleep(30)
    assert.equal(failureCalls.length, 2)
    assert.equal(failureCalls[1].attemptId, id2)
    assert.equal(failureCalls[0].title, "Logging out didn't happen")
    assert.equal(failureCalls[1].title, "Logging out didn't happen")

    const lines = fs.readFileSync(logFile, 'utf8').split('\n')
    const has = (id, fragment) =>
      lines.some((line) => line.includes(fragment) && line.includes(`attemptId=${id}`))
    for (const id of [id1, id2]) {
      assert.equal(
        lines.some((line) => line.includes(`logout probe request attemptId=${id}`)),
        true,
        id,
      )
      assert.equal(has(id, 'logout result requested=true'), true, id)
      assert.equal(has(id, 'logout failed'), true, id)
      assert.equal(
        lines.some(
          (line) => line.includes('logout failed') && line.includes('-1743') && line.includes(`attemptId=${id}`),
        ),
        true,
        id,
      )
      assert.equal(has(id, 'logout settled after accept'), true, id)
      assert.equal(has(id, 'logout late failure notice emitted listeners='), true, id)
      assert.equal(notices.includes(`logout notice received source=logout attemptId=${id}`), true, id)
      assert.equal(
        notices.includes(`logout dialog shown unparented; window hidden attemptId=${id}`),
        true,
        id,
      )
    }
    assert.equal(has(id1, 'logout probe request joined'), true)
    assert.equal(has(id2, 'logout still waiting'), true)
    assert.equal(notices.includes(`logout notice received source=logout-waiting attemptId=${id2}`), true)
    assert.equal(
      notices.filter((item) => item === `logout dialog shown unparented; window hidden attemptId=${id2}`).length,
      2,
    )
    assert.equal(
      notices.some((item) => String(item).includes('logout dialog skipped') && String(item).includes(id2)),
      false,
    )
  } finally {
    stop()
    resetLogoutProbe()
    resetLogoutDialogSession()
    resetLogoutAttemptIdsForTests()
    if (previousLog === undefined) delete process.env.FONT_BUTLER_LOG
    else process.env.FONT_BUTLER_LOG = previousLog
    fs.rmSync(logFile, { force: true })
  }
})

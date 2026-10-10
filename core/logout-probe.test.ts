import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LOGOUT_FAILED_MESSAGE,
  LOGOUT_PROBE_WOULD_START_NOTICE,
  LOGOUT_STILL_WAITING_MESSAGE,
  MAC_LOGOUT_APPLESCRIPT,
  MAC_LOGOUT_PROBE_APPLESCRIPT,
  requestLogoutProbe,
  requestMacLogout,
  resetLogoutProbe,
  startMacLogoutProcess,
} from './caches.ts'

const DENIED = { stderr: 'osascript is not allowed to send keystrokes. (-1743)' }

test('the logout probe is ignored when testBuild is false', async () => {
  resetLogoutProbe()
  const previous = {
    feed: process.env.FONT_BUTLER_TEST_FEED_BUILD,
    test: process.env.FONT_BUTLER_TEST,
    data: process.env.FONT_BUTLER_DATA,
    native: process.env.FONT_BUTLER_NATIVE,
  }
  process.env.FONT_BUTLER_TEST_FEED_BUILD = '1'
  process.env.FONT_BUTLER_TEST = '1'
  process.env.FONT_BUTLER_DATA = '/tmp/font-butler-logout-probe'
  delete process.env.FONT_BUTLER_NATIVE
  let calls = 0
  const exec = () => {
    calls += 1
    return { unref() {} }
  }
  try {
    for (const identity of [undefined, null, {}, { testBuild: false }, { testBuild: 'true' }]) {
      const result = await requestLogoutProbe(identity as { testBuild?: boolean }, { exec })
      assert.deepEqual(result, { requested: false, ignored: true })
    }
    assert.equal(calls, 0)
    assert.doesNotMatch(requestLogoutProbe.toString(), /FONT_BUTLER_TEST/)
    assert.doesNotMatch(requestLogoutProbe.toString(), /FONT_BUTLER_TEST_FEED_BUILD/)
    assert.doesNotMatch(requestLogoutProbe.toString(), /startMacLogoutProcess/)
  } finally {
    restore(previous)
    resetLogoutProbe()
  }
})

test('Allow on the logout probe says logout would start and does not log out', async () => {
  resetLogoutProbe()
  const scripts: string[] = []
  const result = await requestLogoutProbe(
    { testBuild: true },
    {
      exec(_file, args, callback) {
        scripts.push(String(args[1]))
        callback(null)
        return { unref() {} }
      },
    },
  )
  assert.deepEqual(scripts, ['tell application "System Events" to get name'])
  assert.equal(scripts.some((script) => script.includes('log out')), false)
  assert.equal(result.probeAllowed, true)
  assert.equal(result.message, 'Test build: logout would start now')
  assert.equal(result.requested, true)
  assert.doesNotMatch(requestLogoutProbe.toString(), /app\.quit/)
  assert.doesNotMatch(requestLogoutProbe.toString(), /MAC_LOGOUT_APPLESCRIPT/)
  resetLogoutProbe()
})

test('the logout probe never calls the real logout script', async () => {
  resetLogoutProbe()
  const scripts: string[] = []
  const simulated: string[] = []
  const result = await requestLogoutProbe(
    { testBuild: true },
    {
      exec(_file, args, callback) {
        scripts.push(String(args[1]))
        callback(null)
        return { unref() {} }
      },
      onSimulated(message) {
        simulated.push(message)
      },
    },
  )
  assert.deepEqual(scripts, [MAC_LOGOUT_PROBE_APPLESCRIPT])
  assert.equal(MAC_LOGOUT_PROBE_APPLESCRIPT, 'tell application "System Events" to get name')
  assert.equal(scripts.includes(MAC_LOGOUT_APPLESCRIPT), false)
  assert.equal(scripts.some((script) => script.includes('log out')), false)
  assert.doesNotMatch(requestLogoutProbe.toString(), /MAC_LOGOUT_APPLESCRIPT/)
  assert.doesNotMatch(requestLogoutProbe.toString(), /to log out/)
  assert.match(requestLogoutProbe.toString(), /awaitMacLogoutRequest/)
  assert.equal(result.requested, true)
  assert.equal(result.probeAllowed, true)
  assert.equal(result.message, LOGOUT_PROBE_WOULD_START_NOTICE)
  assert.deepEqual(simulated, [])
  assert.equal(LOGOUT_PROBE_WOULD_START_NOTICE, 'Test build: logout would start now')
  assert.doesNotMatch(requestLogoutProbe.toString(), /app\.quit|process\.exit/)
  const realCalls: string[] = []
  startMacLogoutProcess((_file, args) => {
    realCalls.push(String(args[1]))
    return { unref() {} }
  }, () => {})
  assert.deepEqual(realCalls, [MAC_LOGOUT_APPLESCRIPT])
  assert.doesNotMatch(requestMacLogout.toString(), /MAC_LOGOUT_PROBE_APPLESCRIPT/)
  resetLogoutProbe()
})

test('a logout probe denial and a late success use the real logout result handling', async () => {
  resetLogoutProbe()
  const denied = await requestLogoutProbe(
    { testBuild: true },
    {
      exec(_file, _args, callback) {
        callback(DENIED)
        return { unref() {} }
      },
    },
  )
  assert.equal(denied.requested, false)
  assert.equal(denied.ignored, undefined)
  assert.equal(denied.message, LOGOUT_FAILED_MESSAGE)
  assert.match(denied.error ?? '', /-1743/)

  const waiting: string[] = []
  const failures: string[] = []
  const simulated: string[] = []
  let finish: (error: unknown) => void = () => {}
  const acceptedPromise = requestLogoutProbe(
    { testBuild: true },
    {
      acceptAfterMs: 5,
      stillWaitingAfterMs: 15,
      exec(_file, args, callback) {
        assert.equal(args[1], MAC_LOGOUT_PROBE_APPLESCRIPT)
        finish = callback
        return { unref() {} }
      },
      onStillWaiting(message) {
        waiting.push(message)
      },
      onLateFailure(result) {
        failures.push(result.message ?? '')
      },
      onSimulated(message) {
        simulated.push(message)
      },
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 30))
  const accepted = await acceptedPromise
  assert.equal(accepted.requested, true)
  assert.equal(accepted.message, undefined)
  assert.deepEqual(waiting, [LOGOUT_STILL_WAITING_MESSAGE])
  assert.deepEqual(failures, [])
  finish(null)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(simulated, [LOGOUT_PROBE_WOULD_START_NOTICE])
  assert.equal(simulated.includes('Test build: logout simulated'), false)
  assert.deepEqual(failures, [])

  waiting.length = 0
  simulated.length = 0
  let finishDenied: (error: unknown) => void = () => {}
  const deniedPromise = requestLogoutProbe(
    { testBuild: true },
    {
      acceptAfterMs: 5,
      stillWaitingAfterMs: 15,
      exec(_file, _args, callback) {
        finishDenied = callback
        return { unref() {} }
      },
      onStillWaiting(message) {
        waiting.push(message)
      },
      onLateFailure(result) {
        failures.push(`${result.message ?? ''}|${result.error ?? ''}`)
      },
      onSimulated(message) {
        simulated.push(message)
      },
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 30))
  await deniedPromise
  finishDenied(DENIED)
  finishDenied(DENIED)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(waiting, [LOGOUT_STILL_WAITING_MESSAGE])
  assert.equal(failures.length, 1)
  assert.match(failures[0] ?? '', /Logging out didn't happen/)
  assert.match(failures[0] ?? '', /-1743/)
  assert.deepEqual(simulated, [])
  resetLogoutProbe()
})

function restore(previous: {
  feed: string | undefined
  test: string | undefined
  data: string | undefined
  native: string | undefined
}) {
  if (previous.feed === undefined) delete process.env.FONT_BUTLER_TEST_FEED_BUILD
  else process.env.FONT_BUTLER_TEST_FEED_BUILD = previous.feed
  if (previous.test === undefined) delete process.env.FONT_BUTLER_TEST
  else process.env.FONT_BUTLER_TEST = previous.test
  if (previous.data === undefined) delete process.env.FONT_BUTLER_DATA
  else process.env.FONT_BUTLER_DATA = previous.data
  if (previous.native === undefined) delete process.env.FONT_BUTLER_NATIVE
  else process.env.FONT_BUTLER_NATIVE = previous.native
}

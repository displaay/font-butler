import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Hono } from 'hono'
import { menuLogoutPathAfterCacheClear } from '../electron/logout-dialog.mjs'
import { mountSessionLogoutRoutes } from '../server/session-logout.ts'
import { mountUserFontCacheRoute } from '../server/user-font-cache-route.ts'
import { setBuildIdentityCandidatesForTests } from './build-identity.ts'
import {
  allowRealCacheMutation,
  ATSUTIL_SKIPPED_LOG,
  LOGOUT_FAILED_MESSAGE,
  LOGOUT_PROBE_WOULD_START_NOTICE,
  LOGOUT_STILL_WAITING_MESSAGE,
  MAC_LOGOUT_APPLESCRIPT,
  MAC_LOGOUT_PROBE_APPLESCRIPT,
  requestLogoutProbe,
  requestMacLogout,
  resetLogoutProbe,
  setCacheToolExecForTests,
  setMacLogoutExecForTests,
  setUserFontCacheHostMacForTests,
  userFontCacheClearOutcome,
} from './caches.ts'
import { noopFontNative, realFontNative, setFontNative } from './native.ts'
import { FontButlerService } from './service.ts'
import type { AppPaths } from './paths.ts'

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
  assert.deepEqual(scripts, ['tell application "System Events" to count processes'])
  assert.equal(scripts.some((script) => script.includes('log out')), false)
  assert.equal(result.probeAllowed, true)
  assert.equal(result.message, 'Test build: logout would start now')
  assert.equal(result.requested, true)
  assert.equal(scripts.includes(MAC_LOGOUT_APPLESCRIPT), false)
  resetLogoutProbe()
})

test('the logout probe script sends count processes', () => {
  const script = MAC_LOGOUT_PROBE_APPLESCRIPT
  assert.match(script, /count processes/)
  const command = script.replace(/^tell application "System Events" to\s+/, '')
  assert.equal(command, 'count processes')
  assert.doesNotMatch(command, /\b(?:get\s+)?(?:name|id|version|running|frontmost)\b/)
})

test('requestMacLogout itself runs the probe on a test build', async () => {
  const identityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-logout-fn-'))
  const identityFile = path.join(identityDir, 'build-identity.json')
  fs.writeFileSync(identityFile, '{"testBuild":true}\n')
  setBuildIdentityCandidatesForTests([identityFile])
  const scripts: string[] = []
  setMacLogoutExecForTests((_file, args, callback) => {
    scripts.push(String(args[1]))
    callback(null)
    return { unref() {} }
  })
  resetLogoutProbe()
  try {
    const result = await requestMacLogout()
    assert.equal(result.probeAllowed, true)
    assert.equal(result.message, LOGOUT_PROBE_WOULD_START_NOTICE)
    assert.deepEqual(scripts, [MAC_LOGOUT_PROBE_APPLESCRIPT])
    assert.equal(scripts.includes(MAC_LOGOUT_APPLESCRIPT), false)
  } finally {
    setMacLogoutExecForTests(null)
    resetLogoutProbe()
    setBuildIdentityCandidatesForTests(null)
    fs.rmSync(identityDir, { recursive: true, force: true })
  }
})

test('a test build hitting /api/session/logout after a real clear runs the probe', async () => {
  const observed = await withRealClearTestBuild(async ({ app, cleared }) => {
    assert.equal(cleared.cleared, true)
    assert.equal(cleared.simulated, undefined)
    assert.equal(cleared.logoutProbe, true)
    return postLogout(app, '/api/session/logout')
  })
  assert.equal(observed.probeAllowed, true)
  assert.equal(observed.message, LOGOUT_PROBE_WOULD_START_NOTICE)
  assert.deepEqual(observed.calls, [{ file: 'osascript', script: MAC_LOGOUT_PROBE_APPLESCRIPT }])
  assert.equal(observed.calls.some((call) => call.script === MAC_LOGOUT_APPLESCRIPT), false)
  assert.equal(observed.calls.some((call) => call.script.includes('log out')), false)
})

test('the menu path after a real clear in a test build runs the probe', async () => {
  const observed = await withRealClearTestBuild(async ({ app, cleared }) => {
    const menuPath = menuLogoutPathAfterCacheClear(cleared)
    assert.equal(menuPath, '/api/session/logout-probe')
    return postLogout(app, menuPath)
  })
  assert.equal(observed.probeAllowed, true)
  assert.equal(observed.message, 'Test build: logout would start now')
  assert.deepEqual(observed.calls, [{ file: 'osascript', script: MAC_LOGOUT_PROBE_APPLESCRIPT }])
  assert.equal(observed.calls.some((call) => call.script === MAC_LOGOUT_APPLESCRIPT), false)
})

test('a test build clear never runs atsutil through the API', async () => {
  const observed = await withSimulatedTestBuildClear(async (app) => postFontCacheClear(app))
  assert.equal(observed.mac, true)
  assert.equal(observed.cleared, false)
  assert.equal(observed.simulated, true)
  assert.equal(observed.logoutProbe, true)
  assert.deepEqual(observed.calls, [])
  assert.match(observed.log, new RegExp(ATSUTIL_SKIPPED_LOG))
})

test('the menu path clear on a test build never runs atsutil', async () => {
  const observed = await withSimulatedTestBuildClear(async (app) => {
    const cleared = await postFontCacheClear(app)
    assert.equal(menuLogoutPathAfterCacheClear(cleared), '/api/session/logout-probe')
    return cleared
  })
  assert.equal(observed.cleared, false)
  assert.equal(observed.simulated, true)
  assert.deepEqual(observed.calls, [])
  assert.equal(
    observed.calls.some((call) => call.file === 'atsutil' || call.args.includes('-removeUser')),
    false,
  )
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

type ExecCall = { file: string; script: string }

function tempPaths(): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-logout-real-'))
  return {
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
}

async function postLogout(app: Hono, pathname: string): Promise<{
  probeAllowed?: boolean
  message?: string
  calls: ExecCall[]
}> {
  const calls: ExecCall[] = []
  setMacLogoutExecForTests((file, args, callback) => {
    calls.push({ file: String(file), script: String(args[1]) })
    callback(null)
    return { unref() {} }
  })
  resetLogoutProbe()
  const response = await app.request(pathname, { method: 'POST' })
  const body = (await response.json()) as { probeAllowed?: boolean; message?: string }
  assert.equal(response.status, 200)
  return { ...body, calls }
}

async function withRealClearTestBuild<T>(
  run: (input: {
    app: Hono
    cleared: { mac: boolean; cleared: boolean; simulated?: boolean; logoutProbe?: boolean }
  }) => Promise<T>,
): Promise<T> {
  const real = userFontCacheClearOutcome({ mac: true, confirmed: true, allowMutation: true })
  assert.equal(real.cleared, true)
  assert.equal(real.runAtsutil, true)
  assert.equal(real.simulated, undefined)
  const identityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-identity-'))
  const identityFile = path.join(identityDir, 'build-identity.json')
  fs.writeFileSync(identityFile, '{"testBuild":true}\n')
  setBuildIdentityCandidatesForTests([identityFile])
  const paths = tempPaths()
  setFontNative(
    noopFontNative({
      async clearUserFontCache() {
        return { mac: real.mac, cleared: real.cleared }
      },
    }),
  )
  const service = new FontButlerService(paths)
  const app = new Hono()
  mountSessionLogoutRoutes(app, service)
  resetLogoutProbe()
  try {
    const cleared = await service.clearUserFontCache({ confirm: true })
    return await run({ app, cleared })
  } finally {
    setMacLogoutExecForTests(null)
    resetLogoutProbe()
    setBuildIdentityCandidatesForTests(null)
    setFontNative(null)
    service.dispose()
    fs.rmSync(identityDir, { recursive: true, force: true })
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
}

type ToolCall = { file: string; args: string[] }

async function postFontCacheClear(app: Hono): Promise<{
  mac: boolean
  cleared: boolean
  simulated?: boolean
  logoutProbe?: boolean
}> {
  const response = await app.request('/api/caches/font', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  })
  const body = (await response.json()) as {
    mac: boolean
    cleared: boolean
    simulated?: boolean
    logoutProbe?: boolean
  }
  assert.equal(response.status, 200)
  return body
}

async function withSimulatedTestBuildClear<T extends object>(
  run: (app: Hono) => Promise<T>,
): Promise<T & { calls: ToolCall[]; log: string }> {
  const previous = {
    data: process.env.FONT_BUTLER_DATA,
    legacy: process.env.FONTCASE_DATA,
    caches: process.env.FONT_BUTLER_NATIVE_CACHES,
    log: process.env.FONT_BUTLER_LOG,
  }
  delete process.env.FONT_BUTLER_DATA
  delete process.env.FONTCASE_DATA
  delete process.env.FONT_BUTLER_NATIVE_CACHES
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-clear-log-'))
  const logPath = path.join(logDir, 'main.log')
  process.env.FONT_BUTLER_LOG = logPath
  assert.equal(allowRealCacheMutation(), true)
  const identityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-identity-'))
  const identityFile = path.join(identityDir, 'build-identity.json')
  fs.writeFileSync(identityFile, '{"testBuild":true}\n')
  setBuildIdentityCandidatesForTests([identityFile])
  assert.equal(allowRealCacheMutation(), false)
  process.env.FONT_BUTLER_NATIVE_CACHES = '1'
  assert.equal(allowRealCacheMutation(), false)
  delete process.env.FONT_BUTLER_NATIVE_CACHES
  setUserFontCacheHostMacForTests(true)
  const calls: ToolCall[] = []
  setCacheToolExecForTests((file, args, _options, callback) => {
    calls.push({ file: String(file), args: [...args] })
    callback(null)
    return {}
  })
  setFontNative(realFontNative())
  const paths = tempPaths()
  const service = new FontButlerService(paths)
  const app = new Hono()
  mountUserFontCacheRoute(app, service)
  try {
    const result = await run(app)
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''
    return { ...result, calls, log }
  } finally {
    setCacheToolExecForTests(null)
    setUserFontCacheHostMacForTests(null)
    setBuildIdentityCandidatesForTests(null)
    setFontNative(null)
    service.dispose()
    if (previous.data === undefined) delete process.env.FONT_BUTLER_DATA
    else process.env.FONT_BUTLER_DATA = previous.data
    if (previous.legacy === undefined) delete process.env.FONTCASE_DATA
    else process.env.FONTCASE_DATA = previous.legacy
    if (previous.caches === undefined) delete process.env.FONT_BUTLER_NATIVE_CACHES
    else process.env.FONT_BUTLER_NATIVE_CACHES = previous.caches
    if (previous.log === undefined) delete process.env.FONT_BUTLER_LOG
    else process.env.FONT_BUTLER_LOG = previous.log
    fs.rmSync(identityDir, { recursive: true, force: true })
    fs.rmSync(logDir, { recursive: true, force: true })
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
}

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

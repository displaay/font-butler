import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  ALREADY_REGISTERED_CODE,
  ATSUTIL_CLEAR_COMMANDS,
  atsutilCommands,
  FONT_ENABLE_SCRIPT,
  MAC_LOGOUT_APPLESCRIPT,
  FONT_LOOKUP_SCRIPT,
  fontActivationStates,
  fontManagerSucceeded,
  unregisterSucceeded,
  awaitMacLogoutRequest,
  InstalledFontKept,
  installedFontCheckError,
  LOOKUP_ATTEMPT_MS,
  LOGOUT_CANCELLED,
  LOGOUT_FAILED_MESSAGE,
  LOGOUT_FALLBACK,
  LOGOUT_STILL_WAITING_MESSAGE,
  LOGOUT_STILL_WAITING_MS,
  logoutResultFromExecError,
  startMacLogoutProcess,
  parseActivatedFontLookup,
  listUserFontFiles,
  requestMacLogout,
  resetSharedMacLogout,
  resetUserFontCopyCache,
  shareMacLogout,
  runInstalledFontVerification,
  userFontCopyReadCount,
  withVerificationBatch,
  verificationFaceChecks,
  REGISTRATION_SCOPES,
  registrationSucceeded,
  versionsMatch,
} from './caches.ts'
import {
  ensureFontActivation,
  getFontNative,
  noopFontNative,
  setFontNative,
} from './native.ts'
import { writeTestCollection, writeTestFont } from './test-util.ts'

test('the test adapter reports native failures without claiming success', async () => {
  const previous = getFontNative()
  try {
    setFontNative(
      noopFontNative({
        async setFontEnabled() {
          return { ok: false, native: true, error: 'failed' }
        },
      }),
    )
    const result = await getFontNative().setFontEnabled('/tmp/Face.ttf', false)
    assert.equal(result.ok, false)
    assert.equal(result.native, true)
    assert.equal(result.error, 'failed')
    const caches = await getFontNative().clearFontCaches()
    assert.equal(caches.mac, false)
    assert.equal(caches.office, false)
    assert.equal(caches.adobe, false)
  } finally {
    setFontNative(previous)
  }
})

test('ensureFontActivation throws when registration reports fail:-50', async () => {
  await assert.rejects(
    () =>
      ensureFontActivation(
        noopFontNative({
          async registerFont() {
            return { ok: false, native: true, error: 'Could not register the font (fail:-50).' }
          },
        }),
        '/tmp/Face.ttf',
        true,
      ),
    /fail:-50/,
  )
})

test('ensureFontActivation does not succeed when registration fails', async () => {
  await assert.rejects(
    () =>
      ensureFontActivation(
        noopFontNative({
          async registerFont() {
            return { ok: false, native: true, error: 'Core Text refused registration.' }
          },
        }),
        '/tmp/Face.ttf',
        true,
      ),
    /refused registration/,
  )
})

test('fontActivationStates treats user-fonts domain files as enabled when renderable', async (t) => {
  if (process.platform !== 'darwin' || process.env.FONT_BUTLER_NATIVE !== '1') {
    t.skip('requires macOS and FONT_BUTLER_NATIVE=1')
    return
  }
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-ct-user-'))
  const font = path.join(
    dataRoot,
    'Library/Application Support/Font Buttler/user-fonts/Probe.ttf',
  )
  try {
    fs.mkdirSync(path.dirname(font), { recursive: true })
    writeTestFont(font, 'Probe', 'Probe-Regular')
    const query = await fontActivationStates([font])
    assert.equal(query.ok, true)
    assert.equal(query.states[font], true)
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('ensure fails on register failure and never falls back to process scope', () => {
  assert.deepEqual([...REGISTRATION_SCOPES], [3, 2])
  assert.equal(ALREADY_REGISTERED_CODE, 105)
  assert.equal(registrationSucceeded([{ ok: false, code: 105 }]), true)
  assert.equal(registrationSucceeded([{ ok: false, code: -50 }, { ok: false, code: -50 }]), false)
  assert.match(FONT_ENABLE_SCRIPT, /const scopes = \[3,2\]/)
  assert.match(FONT_ENABLE_SCRIPT, /const alreadyRegistered = 105/)
  assert.doesNotMatch(FONT_ENABLE_SCRIPT, /fn\(url,\s*1/)
  assert.deepEqual(atsutilCommands(), [])
  assert.deepEqual(atsutilCommands({ confirm: false }), [])
  assert.deepEqual(atsutilCommands({ confirm: true }), ATSUTIL_CLEAR_COMMANDS.map((args) => [...args]))
  assert.deepEqual(
    atsutilCommands({ confirm: true }),
    [
      ['databases', '-removeUser'],
      ['server', '-shutdown'],
      ['server', '-ping'],
    ],
  )
  assert.equal(MAC_LOGOUT_APPLESCRIPT, 'tell application "System Events" to log out')
  assert.equal(fontManagerSucceeded('ok:105:3'), true)
  assert.equal(fontManagerSucceeded('fail:105'), true)
  assert.equal(fontManagerSucceeded('fail:-50'), false)
  assert.equal(fontManagerSucceeded('fail:0'), false)
  assert.equal(fontManagerSucceeded('fail:201'), false)
  assert.equal(unregisterSucceeded('fail:201'), true)
  assert.equal(unregisterSucceeded('fail:105'), true)
  assert.equal(unregisterSucceeded('ok'), true)
  assert.equal(unregisterSucceeded('fail:-50'), false)
  assert.match(FONT_ENABLE_SCRIPT, /if \(!enabled\) return registerAtScopes\(filePath, false\)/)
  assert.match(FONT_ENABLE_SCRIPT, /CTFontManagerEnableFontDescriptors\(descs, true\)/)
  assert.doesNotMatch(FONT_ENABLE_SCRIPT, /CTFontManagerEnableFontDescriptors\(descs, enabled\)/)
  assert.doesNotMatch(requestMacLogout.toString(), /timeout/)
  assert.match(FONT_ENABLE_SCRIPT, /ObjC\.castRefToObject\(err\)/)
  assert.match(FONT_LOOKUP_SCRIPT, /ObjC\.castRefToObject/)
  assert.match(FONT_LOOKUP_SCRIPT, /CTFontCopyPostScriptName/)
  assert.match(FONT_LOOKUP_SCRIPT, /ObjC\.import\('AppKit'\)/)
  assert.match(FONT_LOOKUP_SCRIPT, /\$\.CTFontCreateWithName\(\$\(psName\),\s*12,\s*null\)/)
  assert.match(FONT_LOOKUP_SCRIPT, /\$\.NSFont\.fontWithNameSize\(\$\(psName\),\s*12\)/)
  assert.match(FONT_LOOKUP_SCRIPT, /NSCTFontFileURLAttribute/)
  assert.doesNotMatch(FONT_LOOKUP_SCRIPT, /CTFontCreateWithName\(psName/)
  assert.doesNotMatch(FONT_LOOKUP_SCRIPT, /bindFunction/)
  assert.equal(versionsMatch('1.000', '1.0'), false)
  assert.equal(versionsMatch('11.000', '1.000'), false)
  assert.equal(versionsMatch('Version 1.000', '1.000'), true)
  assert.equal(versionsMatch('1.000', 'version 1.000'), true)
  assert.equal(versionsMatch('', '1.000'), true)
  const denied = logoutResultFromExecError({
    message: 'osascript failed',
    stderr: 'execution error: System Events got an error: osascript is not allowed to send keystrokes. (-1743)',
  })
  assert.equal(denied.requested, false)
  assert.equal(denied.cancelled, undefined)
  assert.equal(denied.message, LOGOUT_FAILED_MESSAGE)
  assert.match(denied.message, /Logging out didn't happen/)
  assert.match(denied.message, /Apple menu > Log Out/)
  assert.match(denied.error, /-1743/)
  const cancelled = logoutResultFromExecError({
    message: 'osascript failed',
    stderr: 'execution error: User canceled. (-128)',
  })
  assert.equal(cancelled.requested, false)
  assert.equal(cancelled.cancelled, true)
  assert.equal(cancelled.message, LOGOUT_CANCELLED)
  assert.notEqual(cancelled.message, LOGOUT_FALLBACK)
  assert.match(cancelled.error, /-128/)
  for (const script of [FONT_ENABLE_SCRIPT, FONT_LOOKUP_SCRIPT]) {
    const file = path.join(os.tmpdir(), `font-butler-script-${process.pid}-${Math.random().toString(16).slice(2)}.js`)
    fs.writeFileSync(file, script)
    try {
      const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
      assert.equal(checked.status, 0, checked.stderr)
    } finally {
      fs.rmSync(file, { force: true })
    }
  }
})

test('ensureFontActivation does not register a user-library font or fall back when registration would fail', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-ensure-user-'))
  const fonts = path.join(root, 'Fonts')
  const dest = path.join(fonts, 'Face.ttf')
  const previous = process.env.FONT_BUTLER_USER_FONTS_DIR
  process.env.FONT_BUTLER_USER_FONTS_DIR = fonts
  fs.mkdirSync(fonts, { recursive: true })
  fs.writeFileSync(dest, 'bytes')
  const calls: string[] = []
  try {
    await ensureFontActivation(
      noopFontNative({
        async registerFont(filePath) {
          calls.push(`register:${filePath}`)
          return { ok: false, native: true, error: 'Core Text refused registration.' }
        },
        async unregisterFont(filePath) {
          calls.push(`unregister:${filePath}`)
          return { ok: true, native: true }
        },
        async ensureActivation(filePath) {
          calls.push(`ensure:${filePath}`)
          return { ok: false, native: true, error: 'scope 1' }
        },
      }),
      dest,
      true,
    )
    await ensureFontActivation(
      noopFontNative({
        async unregisterFont(filePath) {
          calls.push(`unregister:${filePath}`)
          return { ok: true, native: true }
        },
      }),
      dest,
      false,
    )
    assert.deepEqual(calls, [])
  } finally {
    if (previous === undefined) delete process.env.FONT_BUTLER_USER_FONTS_DIR
    else process.env.FONT_BUTLER_USER_FONTS_DIR = previous
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a broken lookup returns fail:, and a user-font failure is kept', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-lookup-fail-'))
  const logFile = path.join(root, 'main.log')
  const fonts = path.join(root, 'Fonts')
  const previousLog = process.env.FONT_BUTLER_LOG
  const previousFonts = process.env.FONT_BUTLER_USER_FONTS_DIR
  process.env.FONT_BUTLER_LOG = logFile
  process.env.FONT_BUTLER_USER_FONTS_DIR = fonts
  try {
    const failSource = FONT_LOOKUP_SCRIPT.slice(
      FONT_LOOKUP_SCRIPT.indexOf('function fail'),
      FONT_LOOKUP_SCRIPT.indexOf('function objcString'),
    )
    const fail = new Function(`${failSource}; return fail`)() as (error: unknown) => string
    assert.equal(fail(new Error('Ref has no type')), 'fail:Ref has no type')
    assert.match(FONT_LOOKUP_SCRIPT, /return fail\(error\)/)
    assert.doesNotMatch(FONT_LOOKUP_SCRIPT, /catch \(fallback\)/)
    const missed = parseActivatedFontLookup(
      JSON.stringify({ ok: false, reason: 'missing', postscript: '', family: '', version: '', path: '', listed: false }),
      'Face-Regular',
    )
    assert.equal(missed.error, 'missing')
    const lookup = parseActivatedFontLookup('fail:Ref has no type', 'Face-Regular')
    assert.equal(lookup.ok, false)
    assert.equal(lookup.error, 'fail:Ref has no type')
    const kept = installedFontCheckError(path.join(fonts, 'Face.ttf'), lookup.error!, true)
    assert.equal(kept instanceof InstalledFontKept, true)
    assert.match(kept.message, /fail:Ref has no type/)
    assert.match(kept.message, /not visible to other apps yet/)
    const registered = installedFontCheckError(path.join(root, 'registered', 'Face.ttf'), lookup.error!, true)
    assert.equal(registered instanceof InstalledFontKept, false)
    assert.equal(registered.message, 'fail:Ref has no type')
    const log = fs.readFileSync(logFile, 'utf8')
    assert.match(log, /\[verify\s+\] lookup Face-Regular fail:Ref has no type/)
    assert.match(log, /\[verify\s+\] kept .*Fonts\/Face\.ttf fail:Ref has no type/)
    assert.match(log, /\[verify\s+\] fail .*registered\/Face\.ttf fail:Ref has no type/)
    const visible = installedFontCheckError(
      path.join(fonts, 'Face.ttf'),
      'Core Text did not resolve Face-Regular.',
      true,
    )
    assert.equal(visible instanceof InstalledFontKept, true)
    assert.match(visible.message, /not visible to other apps yet/)
  } finally {
    if (previousLog === undefined) delete process.env.FONT_BUTLER_LOG
    else process.env.FONT_BUTLER_LOG = previousLog
    if (previousFonts === undefined) delete process.env.FONT_BUTLER_USER_FONTS_DIR
    else process.env.FONT_BUTLER_USER_FONTS_DIR = previousFonts
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('verification caps each lookup and stops the batch after a timeout', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-lookup-budget-'))
  const filePath = path.join(root, 'Family.ttc')
  const fonts = path.join(root, 'Fonts')
  const userFile = path.join(fonts, 'Family.ttc')
  const previousFonts = process.env.FONT_BUTLER_USER_FONTS_DIR
  try {
    writeTestCollection(filePath, [
      { family: 'First', psName: 'First-Regular', version: 'Version 1.000' },
      { family: 'Second', psName: 'Second-Regular', version: 'Version 1.000' },
    ])
    const clock = 1_000_000
    const timeouts: number[] = []
    const names: string[] = []
    await assert.rejects(
      () =>
        runInstalledFontVerification(filePath, {
          now: () => clock,
          lookup: async (postscriptName, options) => {
            names.push(postscriptName)
            timeouts.push(options.timeoutMs)
            return {
              ok: false,
              postscript: '',
              family: '',
              version: '',
              path: '',
              listed: false,
              error: 'fail:Font lookup timed out.',
              timedOut: true,
            }
          },
        }),
      (error: unknown) => {
        assert.equal(error instanceof InstalledFontKept, false)
        assert.equal(error instanceof Error && error.message, 'fail:Font lookup timed out.')
        return true
      },
    )
    assert.deepEqual(names, ['First-Regular'])
    assert.deepEqual(timeouts, [LOOKUP_ATTEMPT_MS])

    const shortTimeouts: number[] = []
    await assert.rejects(
      () =>
        runInstalledFontVerification(filePath, {
          budgetMs: 1_500,
          now: () => clock,
          lookup: async (_postscriptName, options) => {
            shortTimeouts.push(options.timeoutMs)
            return {
              ok: false,
              postscript: '',
              family: '',
              version: '',
              path: '',
              listed: false,
              error: 'fail:Font lookup timed out.',
              timedOut: true,
            }
          },
        }),
      /fail:Font lookup timed out\./,
    )
    assert.deepEqual(shortTimeouts, [1_500])

    fs.mkdirSync(fonts, { recursive: true })
    fs.copyFileSync(filePath, userFile)
    process.env.FONT_BUTLER_USER_FONTS_DIR = fonts
    const userNames: string[] = []
    await assert.rejects(
      () =>
        runInstalledFontVerification(userFile, {
          now: () => clock,
          lookup: async (postscriptName) => {
            userNames.push(postscriptName)
            return {
              ok: false,
              postscript: '',
              family: '',
              version: '',
              path: '',
              listed: false,
              error: 'fail:Font lookup timed out.',
              timedOut: true,
            }
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof InstalledFontKept)
        assert.match(error.message, /timed out/)
        assert.match(error.message, /not visible to other apps yet/)
        return true
      },
    )
    assert.deepEqual(userNames, ['First-Regular'])
  } finally {
    if (previousFonts === undefined) delete process.env.FONT_BUTLER_USER_FONTS_DIR
    else process.env.FONT_BUTLER_USER_FONTS_DIR = previousFonts
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('verification checks the deadline between faces', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-lookup-deadline-'))
  const filePath = path.join(root, 'Family.ttc')
  try {
    writeTestCollection(filePath, [
      { family: 'First', psName: 'First-Regular', version: 'Version 1.000' },
      { family: 'Second', psName: 'Second-Regular', version: 'Version 1.000' },
    ])
    let clock = 1_000_000
    const names: string[] = []
    await assert.rejects(
      () =>
        runInstalledFontVerification(filePath, {
          budgetMs: 10_000,
          now: () => clock,
          lookup: async (postscriptName) => {
            names.push(postscriptName)
            clock += 10_000
            return {
              ok: true,
              postscript: postscriptName,
              family: 'First',
              version: 'Version 1.000',
              path: filePath,
              listed: true,
            }
          },
        }),
      /Core Text did not activate the installed font\./,
    )
    assert.deepEqual(names, ['First-Regular'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a nil NSFont is a miss, and a nil file URL is a miss', () => {
  const body = FONT_LOOKUP_SCRIPT.replace(/^ObjC\.import\([^\n]*\)\n/gm, '')
  const ObjC = {
    unwrap: (value: unknown) => value,
    castRefToObject: (value: unknown) => value,
  }
  function bridge(value: unknown) {
    return value
  }
  function runWith(nsFont: unknown): { ok?: boolean; reason?: string; raw: string } {
    const dollar = Object.assign(bridge, {
      CTFontCreateWithName: () => ({}),
      CTFontCopyPostScriptName: () => 'Missing-Regular',
      CTFontCopyFamilyName: () => 'Missing',
      CTFontCopyName: () => 'Version 1.000',
      kCTFontVersionNameKey: 5,
      NSFont: { fontWithNameSize: () => nsFont },
      CTFontManagerCopyAvailableFontFamilyNames: () => null,
    })
    const run = new Function('ObjC', '$', `${body}; return run`)(ObjC, dollar) as (argv: string[]) => string
    const raw = run(['Missing-Regular'])
    assert.equal(raw.startsWith('fail:'), false, raw)
    return { ...JSON.parse(raw), raw }
  }
  const nilFont = {
    isNil: () => true,
    get fontDescriptor(): never {
      throw new Error("undefined is not an object (evaluating 'nsFont.fontDescriptor.objectForKey')")
    },
  }
  const missingFont = runWith(nilFont)
  assert.equal(missingFont.ok, false)
  assert.match(missingFont.reason ?? '', /NSFont could not open Missing-Regular/)
  const nilUrl = {
    isNil: () => false,
    fontDescriptor: {
      objectForKey: () => ({
        isNil: () => true,
        get path(): never {
          throw new Error('nil url path')
        },
      }),
    },
  }
  const missingUrl = runWith(nilUrl)
  assert.equal(missingUrl.ok, false)
  assert.match(missingUrl.reason ?? '', /no file URL/)
})

test('unnamed collection faces keep the original face index', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-face-index-'))
  const filePath = path.join(root, 'Family.ttc')
  try {
    writeTestCollection(filePath, [
      { family: 'First', psName: 'First-Regular', version: 'Version 1.000' },
      { family: 'Second', psName: 'Second-Bold', style: 'Bold', version: 'Version 2.000' },
    ])
    const checks = verificationFaceChecks(filePath, [
      { postscriptName: '' },
      { postscriptName: 'Second-Bold' },
    ])
    assert.equal(checks.length, 1)
    assert.equal(checks[0]?.index, 1)
    assert.equal(checks[0]?.ps, 'Second-Bold')
    assert.match(checks[0]?.version ?? '', /2\.000/)
    assert.ok(checks[0]?.acceptable.has('Second-Bold'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('deactivating unregisters the file URL and does not disable by name', async () => {
  const calls: string[] = []
  await ensureFontActivation(
    noopFontNative({
      async unregisterFont(filePath) {
        calls.push(`unregister:${filePath}`)
        return { ok: true, native: true }
      },
      async setFontEnabled(filePath, enabled) {
        calls.push(`set:${filePath}:${enabled ? 1 : 0}`)
        return { ok: true, native: true }
      },
    }),
    '/tmp/registered/Face.ttf',
    false,
  )
  assert.deepEqual(calls, ['unregister:/tmp/registered/Face.ttf'])
})

test('logout reports an open confirm as accepted and keeps -128 and -1743', async () => {
  const accepted = await awaitMacLogoutRequest((report) => {
    setTimeout(() => {
      report(logoutResultFromExecError({ stderr: 'User canceled. (-128)' }))
    }, 40)
  }, 10)
  assert.equal(accepted.requested, true)
  assert.equal(accepted.message, undefined)

  const cancelled = await awaitMacLogoutRequest((report) => {
    report(logoutResultFromExecError({ stderr: 'User canceled. (-128)' }))
  }, 1_000)
  assert.equal(cancelled.requested, false)
  assert.equal(cancelled.cancelled, true)
  assert.equal(cancelled.message, LOGOUT_CANCELLED)

  const denied = await awaitMacLogoutRequest((report) => {
    report(logoutResultFromExecError({ stderr: 'osascript is not allowed to send keystrokes. (-1743)' }))
  }, 1_000)
  assert.equal(denied.requested, false)
  assert.equal(denied.cancelled, undefined)
  assert.equal(denied.message, LOGOUT_FAILED_MESSAGE)
})

test('a registered install warns when user Fonts already has that PostScript name', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-user-copy-'))
  const fonts = path.join(root, 'Library', 'Fonts')
  const installed = path.join(root, 'user-fonts', 'NewAzeret.ttf')
  const previousFonts = process.env.FONT_BUTLER_USER_FONTS_DIR
  process.env.FONT_BUTLER_USER_FONTS_DIR = fonts
  try {
    fs.mkdirSync(fonts, { recursive: true })
    writeTestFont(path.join(fonts, 'NewAzeret-Regular.ttf'), 'NewAzeret', 'NewAzeret-Regular', {
      version: 'Version 1.000',
    })
    writeTestFont(installed, 'NewAzeret', 'NewAzeret-Regular', { version: 'Version 2.000' })
    const lookups: string[] = []
    await assert.rejects(
      () =>
        runInstalledFontVerification(installed, {
          now: () => 1_000_000,
          lookup: async (postscriptName) => {
            lookups.push(postscriptName)
            return {
              ok: true,
              postscript: postscriptName,
              family: 'NewAzeret',
              version: 'Version 2.000',
              path: installed,
              listed: true,
            }
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof InstalledFontKept)
        assert.match(error.message, /Both copies of NewAzeret-Regular are installed/)
        assert.match(error.message, /NewAzeret-Regular\.ttf/)
        assert.doesNotMatch(error.message, /served/)
        return true
      },
    )
    assert.deepEqual(lookups, [])
  } finally {
    if (previousFonts === undefined) delete process.env.FONT_BUTLER_USER_FONTS_DIR
    else process.env.FONT_BUTLER_USER_FONTS_DIR = previousFonts
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a user-font duplicate scan reads name tables once per batch and stops at the budget', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-many-copies-'))
  const fonts = path.join(root, 'Library', 'Fonts')
  const installed = path.join(root, 'installed', 'NewAzeret.ttf')
  const previousFonts = process.env.FONT_BUTLER_USER_FONTS_DIR
  process.env.FONT_BUTLER_USER_FONTS_DIR = fonts
  resetUserFontCopyCache()
  try {
    fs.mkdirSync(fonts, { recursive: true })
    fs.mkdirSync(path.dirname(installed), { recursive: true })
    writeTestFont(path.join(fonts, '000-NewAzeret.ttf'), 'NewAzeret', 'NewAzeret-Regular', {
      version: 'Version 1.000',
    })
    for (let index = 0; index < 20; index += 1) {
      const name = `Decoy${String(index).padStart(2, '0')}`
      writeTestFont(path.join(fonts, `z-decoy-${String(index).padStart(2, '0')}.ttf`), name, `${name}-Regular`)
    }
    writeTestFont(installed, 'NewAzeret', 'NewAzeret-Regular', { version: 'Version 2.000' })
    let clock = 0
    const now = () => {
      const value = clock
      clock += 3_000
      return value
    }
    const lookups: string[] = []
    await withVerificationBatch(async () => {
      await assert.rejects(
        () =>
          runInstalledFontVerification(installed, {
            now,
            lookup: async (postscriptName) => {
              lookups.push(postscriptName)
              return {
                ok: true,
                postscript: postscriptName,
                family: 'NewAzeret',
                version: 'Version 2.000',
                path: installed,
                listed: true,
              }
            },
          }),
        (error: unknown) => {
          assert.ok(error instanceof InstalledFontKept)
          assert.match(error.message, /Both copies of NewAzeret-Regular are installed/)
          assert.match(error.message, /000-NewAzeret\.ttf/)
          assert.doesNotMatch(error.message, /served/)
          return true
        },
      )
      const reads = userFontCopyReadCount()
      assert.ok(reads > 0)
      assert.ok(reads < 21)
      await assert.rejects(
        () =>
          runInstalledFontVerification(installed, {
            now,
            lookup: async (postscriptName) => {
              lookups.push(postscriptName)
              return {
                ok: true,
                postscript: postscriptName,
                family: 'NewAzeret',
                version: 'Version 2.000',
                path: installed,
                listed: true,
              }
            },
          }),
        (error: unknown) => error instanceof InstalledFontKept,
      )
      assert.equal(userFontCopyReadCount(), reads)
    }, { now, budgetMs: 10_000 })
    assert.deepEqual(lookups, [])
  } finally {
    resetUserFontCopyCache()
    if (previousFonts === undefined) delete process.env.FONT_BUTLER_USER_FONTS_DIR
    else process.env.FONT_BUTLER_USER_FONTS_DIR = previousFonts
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('misses in one verification batch share a single deadline', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-batch-budget-'))
  const fonts = path.join(root, 'Library', 'Fonts')
  const first = path.join(root, 'A.ttf')
  const second = path.join(root, 'B.ttf')
  const previousFonts = process.env.FONT_BUTLER_USER_FONTS_DIR
  process.env.FONT_BUTLER_USER_FONTS_DIR = fonts
  resetUserFontCopyCache()
  try {
    fs.mkdirSync(fonts, { recursive: true })
    writeTestFont(first, 'BatchA', 'BatchA-Regular')
    writeTestFont(second, 'BatchB', 'BatchB-Regular')
    let clock = 0
    const now = () => clock
    const lookups: string[] = []
    await withVerificationBatch(
      async () => {
        await assert.rejects(() =>
          runInstalledFontVerification(first, {
            now,
            lookup: async (postscriptName) => {
              lookups.push(postscriptName)
              clock = 10_000
              return {
                ok: false,
                postscript: '',
                family: '',
                version: '',
                path: '',
                listed: false,
                error: 'Core Text did not resolve the font.',
              }
            },
          }),
        )
        await assert.rejects(() =>
          runInstalledFontVerification(second, {
            now,
            lookup: async (postscriptName) => {
              lookups.push(postscriptName)
              return {
                ok: true,
                postscript: postscriptName,
                family: 'BatchB',
                version: '',
                path: second,
                listed: true,
              }
            },
          }),
        )
      },
      { now, budgetMs: 10_000 },
    )
    assert.deepEqual(lookups, ['BatchA-Regular'])
  } finally {
    resetUserFontCopyCache()
    if (previousFonts === undefined) delete process.env.FONT_BUTLER_USER_FONTS_DIR
    else process.env.FONT_BUTLER_USER_FONTS_DIR = previousFonts
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('logout request and result are written to main.log', async () => {
  const logFile = path.join(os.tmpdir(), `font-butler-logout-${process.pid}.log`)
  const previous = process.env.FONT_BUTLER_LOG
  process.env.FONT_BUTLER_LOG = logFile
  try {
    assert.match(shareMacLogout.toString(), /logout request/)
    const accepted = await awaitMacLogoutRequest((report) => {
      report({ requested: true })
    })
    assert.equal(accepted.requested, true)
    const denied = await awaitMacLogoutRequest((report) => {
      report(logoutResultFromExecError({ stderr: 'osascript is not allowed to send keystrokes. (-1743)' }))
    })
    assert.equal(denied.requested, false)
    const text = fs.readFileSync(logFile, 'utf8')
    assert.match(text, /\[install\s+\] logout result requested=true/)
    assert.match(text, /\[install\s+\] logout result requested=false/)
    assert.match(text, /logout failed/)
    assert.match(text, /-1743/)
  } finally {
    if (previous === undefined) delete process.env.FONT_BUTLER_LOG
    else process.env.FONT_BUTLER_LOG = previous
    fs.rmSync(logFile, { force: true })
  }
})

test('a logout denial after the accept window still opens the failure path', async () => {
  const logFile = path.join(os.tmpdir(), `font-butler-logout-late-${process.pid}.log`)
  const previous = process.env.FONT_BUTLER_LOG
  process.env.FONT_BUTLER_LOG = logFile
  const cases = [
    {
      error: { stderr: 'osascript is not allowed to send keystrokes. (-1743)' },
      match: /-1743/,
    },
    {
      error: { message: 'osascript failed', stderr: 'Application is not running. (-600)' },
      match: /-600/,
    },
    {
      error: { code: 'ETIMEDOUT', message: 'spawn osascript ETIMEDOUT timed out' },
      match: /timed out/,
    },
  ]
  try {
    for (const item of cases) {
      const late: Array<{ message?: string; error?: string }> = []
      const accepted = await awaitMacLogoutRequest(
        (report) => {
          setTimeout(() => report(logoutResultFromExecError(item.error)), 20)
        },
        5,
        (result) => late.push(result),
      )
      assert.equal(accepted.requested, true)
      await new Promise((resolve) => setTimeout(resolve, 40))
      assert.equal(late.length, 1)
      assert.equal(late[0]?.message, LOGOUT_FAILED_MESSAGE)
      assert.match(late[0]?.error ?? '', item.match)
    }
    const ignored: unknown[] = []
    await awaitMacLogoutRequest(
      (report) => {
        setTimeout(() => report(logoutResultFromExecError({ stderr: 'User canceled. (-128)' })), 20)
      },
      5,
      (result) => ignored.push(result),
    )
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.deepEqual(ignored, [])
    const text = fs.readFileSync(logFile, 'utf8')
    assert.match(text, /logout failed[\s\S]*-1743/)
    assert.match(text, /logout failed[\s\S]*-600/)
    assert.match(text, /logout failed[\s\S]*timed out/)
  } finally {
    if (previous === undefined) delete process.env.FONT_BUTLER_LOG
    else process.env.FONT_BUTLER_LOG = previous
    fs.rmSync(logFile, { force: true })
  }
})

test('the logout process keeps running while macOS is still deciding', () => {
  const calls: unknown[][] = []
  let killed = false
  startMacLogoutProcess((...args) => {
    calls.push(args)
    return {
      unref() {},
      kill() {
        killed = true
      },
    }
  }, () => {})
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.[0], 'osascript')
  assert.deepEqual(calls[0]?.[1], ['-e', MAC_LOGOUT_APPLESCRIPT])
  assert.equal(typeof calls[0]?.[2], 'function')
  assert.equal(calls[0]?.[3], undefined)
  assert.equal(killed, false)
  assert.equal(LOGOUT_STILL_WAITING_MS, 30_000)
  assert.doesNotMatch(requestMacLogout.toString(), /timeout/)
  assert.doesNotMatch(startMacLogoutProcess.toString(), /\.kill\(/)
})

test('a wait followed by success shows no failure dialog, and a wait followed by -1743 shows it once', async () => {
  const logFile = path.join(os.tmpdir(), `font-butler-logout-wait-${process.pid}.log`)
  const previous = process.env.FONT_BUTLER_LOG
  process.env.FONT_BUTLER_LOG = logFile
  try {
    const successNotices: string[] = []
    const successFailures: Array<{ message?: string }> = []
    let successReported = false
    const accepted = await awaitMacLogoutRequest(
      (report) => {
        setTimeout(() => {
          successReported = true
          report({ requested: true })
          report({ requested: true })
        }, 40)
      },
      5,
      (result) => successFailures.push(result),
      {
        stillWaitingAfterMs: 15,
        onStillWaiting: (message) => successNotices.push(message),
      },
    )
    assert.equal(accepted.requested, true)
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.equal(successReported, true)
    assert.deepEqual(successFailures, [])
    assert.deepEqual(successNotices, [LOGOUT_STILL_WAITING_MESSAGE])

    const failureNotices: string[] = []
    const failureDialogs: Array<{ message?: string; error?: string; cancelled?: boolean }> = []
    await awaitMacLogoutRequest(
      (report) => {
        setTimeout(() => {
          const result = logoutResultFromExecError({
            stderr: 'osascript is not allowed to send keystrokes. (-1743)',
          })
          report(result)
          report(result)
        }, 40)
      },
      5,
      (result) => failureDialogs.push(result),
      {
        stillWaitingAfterMs: 15,
        onStillWaiting: (message) => failureNotices.push(message),
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.deepEqual(failureNotices, [LOGOUT_STILL_WAITING_MESSAGE])
    assert.equal(failureDialogs.length, 1)
    assert.equal(failureDialogs[0]?.message, LOGOUT_FAILED_MESSAGE)
    assert.equal(failureDialogs[0]?.cancelled, undefined)
    assert.match(failureDialogs[0]?.error ?? '', /-1743/)
    assert.doesNotMatch(LOGOUT_STILL_WAITING_MESSAGE, /didn't happen/)

    const earlyNotices: string[] = []
    const earlyFailures: unknown[] = []
    await awaitMacLogoutRequest(
      (report) => {
        setTimeout(() => report({ requested: true }), 10)
      },
      5,
      (result) => earlyFailures.push(result),
      {
        stillWaitingAfterMs: 50,
        onStillWaiting: (message) => earlyNotices.push(message),
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 70))
    assert.deepEqual(earlyNotices, [])
    assert.deepEqual(earlyFailures, [])

    const text = fs.readFileSync(logFile, 'utf8')
    assert.match(text, /logout still waiting/)
    assert.match(text, /Still waiting for macOS/)
    assert.match(text, /logout failed[\s\S]*-1743/)
  } finally {
    if (previous === undefined) delete process.env.FONT_BUTLER_LOG
    else process.env.FONT_BUTLER_LOG = previous
    fs.rmSync(logFile, { force: true })
  }
})

test('two logout requests share one osascript until that process reports', async () => {
  resetSharedMacLogout()
  try {
    let starts = 0
    let report: (result: { requested: boolean }) => void = () => {}
    const late: string[] = []
    const first = shareMacLogout(
      (deliver) => {
        starts += 1
        report = deliver
      },
      (result) => late.push(result.error ?? ''),
      undefined,
      15,
    )
    const second = shareMacLogout(() => {
      starts += 1
    })
    assert.equal(starts, 1)
    assert.equal(first, second)
    await new Promise((resolve) => setTimeout(resolve, 25))
    const duringWait = shareMacLogout(() => {
      starts += 1
    })
    assert.equal(starts, 1)
    assert.equal(duringWait, first)
    assert.equal((await first).requested, true)
    report(logoutResultFromExecError({ stderr: 'osascript is not allowed to send keystrokes. (-1743)' }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(late.length, 1)
    assert.match(late[0] ?? '', /-1743/)

    let nextStarts = 0
    const third = shareMacLogout((deliver) => {
      nextStarts += 1
      deliver({ requested: true })
    })
    assert.equal((await third).requested, true)
    assert.equal(nextStarts, 1)
  } finally {
    resetSharedMacLogout()
  }
})

test('listUserFontFiles stops before the next directory once the budget is spent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-walk-budget-'))
  const fonts = path.join(root, 'Fonts')
  const nested = path.join(fonts, 'nested')
  const realReaddir = fs.readdirSync
  let nestedReads = 0
  fs.readdirSync = ((dir: fs.PathLike, options?: unknown) => {
    if (String(dir).includes(`${path.sep}nested`)) nestedReads += 1
    return realReaddir(dir, options as { withFileTypes: true })
  }) as typeof fs.readdirSync
  try {
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(fonts, '000-NewAzeret.ttf'), 'font')
    fs.writeFileSync(path.join(nested, 'secret.ttf'), 'font')
    let ticks = 0
    const now = () => {
      ticks += 1
      return ticks === 1 ? 0 : 10_000
    }
    const files = listUserFontFiles(fonts, now, 1_000)
    assert.deepEqual(
      files.map((file) => path.basename(file)),
      ['000-NewAzeret.ttf'],
    )
    assert.equal(nestedReads, 0)
    assert.deepEqual(listUserFontFiles(fonts, () => 5_000, 1), [])
  } finally {
    fs.readdirSync = realReaddir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

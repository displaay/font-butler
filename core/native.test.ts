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
  REGISTRATION_SCOPES,
  registrationSucceeded,
} from './caches.ts'
import {
  ensureFontActivation,
  getFontNative,
  noopFontNative,
  setFontNative,
} from './native.ts'
import { writeTestFont } from './test-util.ts'

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

test('ensureFontActivation does not succeed when the registry still disagrees', async () => {
  await assert.rejects(
    () =>
      ensureFontActivation(
        noopFontNative({
          async setFontEnabled() {
            return { ok: true, native: true }
          },
          async fontActivationStates(filePaths) {
            const states: Record<string, boolean> = {}
            for (const filePath of filePaths) states[filePath] = true
            return { ok: true, native: true, states }
          },
        }),
        '/tmp/Face.ttf',
        false,
      ),
    /did not deactivate/,
  )
})

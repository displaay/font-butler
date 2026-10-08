import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fontActivationStates } from './caches.ts'
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

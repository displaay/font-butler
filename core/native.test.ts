import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ensureFontActivation,
  getFontNative,
  noopFontNative,
  setFontNative,
} from './native.ts'

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

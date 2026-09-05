import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getFontNative, noopFontNative, setFontNative } from './native.ts'

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

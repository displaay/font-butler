import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  signFontAccess,
  verifyFontAccess,
  verifyFontPreviewQuery,
} from './font-access.ts'

const secret = 'local-secret-token'
const now = 1_700_000_000_000

test('signed font-file access verifies for the same id and expires', () => {
  const payload = { kind: 'font-file' as const, id: 'abc', which: 'installed', revision: '' }
  const access = signFontAccess(secret, payload, now)
  assert.equal(verifyFontAccess(secret, payload, access, now), true)
  assert.equal(verifyFontAccess(secret, payload, access, now + 60 * 60 * 1000 - 1), true)
  assert.equal(verifyFontAccess(secret, payload, access, now + 60 * 60 * 1000 + 60_000 + 1), false)
  assert.equal(
    verifyFontAccess(secret, { ...payload, id: 'other' }, access, now),
    false,
  )
  assert.equal(verifyFontAccess('wrong-secret', payload, access, now), false)
})

test('font preview query tokens are bound to path and which', () => {
  const access = signFontAccess(
    secret,
    { kind: 'font-file', id: 'abc', which: 'source', revision: '' },
    now,
  )
  assert.equal(
    verifyFontPreviewQuery(
      secret,
      '/api/font-file/abc',
      { ...access, which: 'source' },
      now,
    ),
    true,
  )
  assert.equal(
    verifyFontPreviewQuery(
      secret,
      '/api/font-file/abc',
      { ...access, which: 'installed' },
      now,
    ),
    false,
  )
  const system = signFontAccess(secret, { kind: 'system-font', path: '/Library/Fonts/A.ttf' }, now)
  assert.equal(
    verifyFontPreviewQuery(
      secret,
      '/api/system-font',
      { ...system, path: '/Library/Fonts/A.ttf' },
      now,
    ),
    true,
  )
  assert.equal(
    verifyFontPreviewQuery(
      secret,
      '/api/system-font',
      { ...system, path: '/tmp/evil.ttf' },
      now,
    ),
    false,
  )
  assert.equal(verifyFontPreviewQuery(secret, '/api/font-file/abc', {}, now), false)
})

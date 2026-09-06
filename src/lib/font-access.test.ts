import assert from 'node:assert/strict'
import { test } from 'node:test'
import { signFontAccess as signNode } from '../../core/font-access.ts'
import { signFontAccess as signWeb } from './font-access.ts'

test('renderer HMAC matches the Node signer used by the API', async () => {
  const secret = 'local-secret-token'
  const now = 1_700_000_000_000
  const payload = {
    kind: 'font-file' as const,
    id: 'preview',
    which: 'revision',
    revision: 'a'.repeat(64),
  }
  const node = signNode(secret, payload, now)
  const web = await signWeb(secret, payload, now)
  assert.deepEqual(web, node)
})

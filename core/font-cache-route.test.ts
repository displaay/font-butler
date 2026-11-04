import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { mountUserFontCacheRoute } from '../server/user-font-cache-route.ts'

test('POST /api/caches/all runs nothing without confirmation and reports every part with it', async () => {
  const calls: string[] = []
  const app = new Hono()
  mountUserFontCacheRoute(app, {
    async clearUserFontCache() {
      calls.push('user-route')
      return { mac: true, cleared: true }
    },
    async clearAllFontCaches() {
      calls.push('all')
      return {
        mac: true,
        cleared: true,
        confirmed: true,
        parts: [
          { part: 'user', status: 'cleared', mac: true, cleared: true },
          { part: 'office', status: 'failed', mac: true, cleared: false, error: 'locked' },
          { part: 'adobe', status: 'cleared', mac: true, cleared: true },
        ],
      }
    },
  })

  const declined = await app.request('/api/caches/all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(declined.status, 400)
  assert.deepEqual(calls, [])

  const cleared = await app.request('/api/caches/all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  })
  assert.equal(cleared.status, 200)
  assert.deepEqual(calls, ['all'])
  const body = (await cleared.json()) as {
    parts: Array<{ part: string; status: string; error?: string }>
  }
  assert.deepEqual(
    body.parts.map((part) => [part.part, part.status]),
    [
      ['user', 'cleared'],
      ['office', 'failed'],
      ['adobe', 'cleared'],
    ],
  )
  assert.equal(body.parts[1]?.error, 'locked')
})

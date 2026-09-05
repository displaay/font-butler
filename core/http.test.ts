import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Hono } from 'hono'
import {
  denyRemoteRequest,
  isAllowedHost,
  isAllowedOrigin,
  requestAuthorityError,
  resolveStaticAsset,
} from './http.ts'

test('loopback hosts are accepted and untrusted hosts are not', () => {
  assert.equal(isAllowedHost('127.0.0.1:43182', 43182), true)
  assert.equal(isAllowedHost('localhost:43182', 43182), true)
  assert.equal(isAllowedHost('untrusted.example', 43182), false)
  assert.equal(isAllowedHost('127.0.0.1:80', 43182), false)
})

test('browser origins must be the app UI or the bound API', () => {
  assert.equal(isAllowedOrigin('http://127.0.0.1:43181', 43182), true)
  assert.equal(isAllowedOrigin('http://127.0.0.1:43182', 43182), true)
  assert.equal(isAllowedOrigin('http://untrusted.example', 43182), false)
})

test('untrusted Host cannot bootstrap even without Origin', () => {
  assert.equal(
    requestAuthorityError({ host: 'untrusted.example', origin: undefined }, 43182),
    'Forbidden host',
  )
  assert.equal(requestAuthorityError({ host: '127.0.0.1:43182' }, 43182), null)
  assert.equal(
    requestAuthorityError({ host: '127.0.0.1:43182', origin: 'http://evil.test' }, 43182),
    'Forbidden origin',
  )
})

test('API middleware rejects untrusted hosts before bootstrap or mutation', async () => {
  const app = new Hono()
  app.use('*', async (c, next) => {
    const denied = denyRemoteRequest(c, 43182)
    if (denied) return denied
    return next()
  })
  app.get('/api/bootstrap', (c) => c.json({ token: 'secret' }))
  app.get('/api/catalog', (c) => c.json({ entries: [] }))
  app.post('/api/settings', (c) => c.json({ ok: true }))

  const blocked = await app.request('/api/bootstrap', {
    headers: { host: 'untrusted.example' },
  })
  assert.equal(blocked.status, 403)
  assert.equal(((await blocked.json()) as { error?: string }).error, 'Forbidden host')

  const catalog = await app.request('/api/catalog', {
    headers: { host: 'untrusted.example', origin: 'http://untrusted.example' },
  })
  assert.equal(catalog.status, 403)

  const mutate = await app.request('/api/settings', {
    method: 'POST',
    headers: { host: 'untrusted.example', origin: 'http://untrusted.example' },
  })
  assert.equal(mutate.status, 403)

  const allowed = await app.request('/api/bootstrap', {
    headers: { host: '127.0.0.1:43182' },
  })
  assert.equal(allowed.status, 200)
  assert.equal(((await allowed.json()) as { token?: string }).token, 'secret')
})

test('resolveStaticAsset rejects prefix-sharing siblings and traversals', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-static-'))
  const staticRoot = path.join(root, 'static')
  const sibling = path.join(root, 'static-private')
  try {
    fs.mkdirSync(staticRoot)
    fs.mkdirSync(sibling)
    fs.writeFileSync(path.join(staticRoot, 'index.html'), 'ok')
    fs.writeFileSync(path.join(sibling, 'probe.txt'), 'secret')
    assert.equal(resolveStaticAsset(staticRoot, '/index.html'), path.join(staticRoot, 'index.html'))
    assert.equal(resolveStaticAsset(staticRoot, '/..%2Fstatic-private/probe.txt'), 'forbidden')
    assert.equal(resolveStaticAsset(staticRoot, '/../static-private/probe.txt'), 'forbidden')
    assert.equal(resolveStaticAsset(staticRoot, '/%2e%2e/static-private/probe.txt'), 'forbidden')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

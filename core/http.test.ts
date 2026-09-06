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
  isAuthorizedApiRequest,
  isPublicApiGet,
  requestAuthorityError,
  resolveStaticAsset,
} from './http.ts'
import { shouldIncludeBootstrapToken } from './auth.ts'

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

test('public GET routes stay unauthenticated; catalog and mutations need a bearer token', () => {
  const token = 'local-secret-token'
  assert.equal(isPublicApiGet('/api/health'), true)
  assert.equal(isPublicApiGet('/api/bootstrap'), true)
  assert.equal(isPublicApiGet('/api/system-font'), true)
  assert.equal(isPublicApiGet('/api/font-file/abc'), true)
  assert.equal(isPublicApiGet('/api/catalog'), false)
  assert.equal(isPublicApiGet('/api/events'), false)
  assert.equal(isPublicApiGet('/api/settings'), false)
  assert.equal(
    isAuthorizedApiRequest({ method: 'GET', pathname: '/api/catalog', token }),
    false,
  )
  assert.equal(
    isAuthorizedApiRequest({
      method: 'GET',
      pathname: '/api/catalog',
      authorization: `Bearer ${token}`,
      token,
    }),
    true,
  )
  assert.equal(
    isAuthorizedApiRequest({ method: 'GET', pathname: '/api/font-file/id', token }),
    true,
  )
  assert.equal(
    isAuthorizedApiRequest({ method: 'POST', pathname: '/api/install', token }),
    false,
  )
  assert.equal(
    isAuthorizedApiRequest({
      method: 'POST',
      pathname: '/api/install',
      authorization: `Bearer ${token}`,
      token,
    }),
    true,
  )
})

test('API auth middleware rejects unauthenticated catalog reads', async () => {
  const token = 'local-secret-token'
  const app = new Hono()
  app.use('/api/*', async (c, next) => {
    if (
      isAuthorizedApiRequest({
        method: c.req.method,
        pathname: c.req.path,
        authorization: c.req.header('Authorization'),
        token,
      })
    ) {
      return next()
    }
    return c.json({ error: 'Unauthorized' }, 401)
  })
  app.get('/api/bootstrap', (c) => c.json({ ok: true }))
  app.get('/api/catalog', (c) => c.json({ entries: [] }))
  app.get('/api/font-file/id', (c) => c.body('font'))

  const openBootstrap = await app.request('/api/bootstrap', {
    headers: { host: '127.0.0.1:43182' },
  })
  assert.equal(openBootstrap.status, 200)

  const blocked = await app.request('/api/catalog', {
    headers: { host: '127.0.0.1:43182' },
  })
  assert.equal(blocked.status, 401)

  const allowed = await app.request('/api/catalog', {
    headers: { host: '127.0.0.1:43182', authorization: `Bearer ${token}` },
  })
  assert.equal(allowed.status, 200)

  const fontBytes = await app.request('/api/font-file/id', {
    headers: { host: '127.0.0.1:43182' },
  })
  assert.equal(fontBytes.status, 200)
})

test('bootstrap token is only included in test or local-dev server env', () => {
  assert.equal(shouldIncludeBootstrapToken({}), false)
  assert.equal(shouldIncludeBootstrapToken({ FONT_BUTLER_TEST: '1' }), true)
  assert.equal(shouldIncludeBootstrapToken({ FONT_BUTLER_DEV_BOOTSTRAP: '1' }), true)
  assert.equal(shouldIncludeBootstrapToken({ FONT_BUTLER_TEST: '0' }), false)
})

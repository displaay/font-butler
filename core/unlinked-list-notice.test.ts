import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {
  acknowledgeUnlinkedListReset,
  peekPendingUnlinkedListResetNotice,
  publishUnlinkedListReset,
  setUnlinkedListResetWriteFaultForTest,
  unlinkedListResetPendingPath,
} from './events.ts'
import { buildPaths, ensureDirs } from './paths.ts'
import { mountEventsRoutes } from '../server/events-stream.ts'

type SseEvent = { type?: string; notice?: { source?: string; message?: string; resetId?: string } }

function listen(app: Hono): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve({
        port: info.port,
        close: () =>
          new Promise((done) => {
            server.close(() => done())
          }),
      })
    })
    server.once('error', reject)
  })
}

async function readSse(
  response: Response,
  done: (events: SseEvent[]) => boolean,
  idleMs = 0,
  onEvents?: (events: SseEvent[]) => void,
): Promise<SseEvent[]> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('missing event stream')
  const decoder = new TextDecoder()
  const events: SseEvent[] = []
  let buffer = ''
  let settled = false
  let idle: ReturnType<typeof setTimeout> | undefined
  const finish = () => {
    settled = true
    void reader.cancel()
  }
  const timer = setTimeout(finish, 3000)
  try {
    while (!settled) {
      const { done: streamDone, value } = await reader.read()
      if (streamDone) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((item) => item.startsWith('data:'))
        if (!line) continue
        events.push(JSON.parse(line.slice(5).trim()) as SseEvent)
      }
      onEvents?.(events)
      if (done(events)) {
        if (idleMs <= 0) break
        if (idle) clearTimeout(idle)
        idle = setTimeout(finish, idleMs)
      }
    }
  } finally {
    clearTimeout(timer)
    if (idle) clearTimeout(idle)
    await reader.cancel().catch(() => {})
  }
  return events
}

function hasCatalog(events: SseEvent[]): boolean {
  return events.some((event) => event.type === 'catalog')
}

function unlinkedNotices(events: SseEvent[]): SseEvent[] {
  return events.filter((event) => event.type === 'notice' && event.notice?.source === 'unlinked-list')
}

function unlinkedNotice(events: SseEvent[]): SseEvent | undefined {
  return unlinkedNotices(events)[0]
}

test('a background client does not drain the unlinked-list reset notice', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-reset-clients-'))
  const paths = buildPaths({ override: root, mac: false })
  ensureDirs(paths)
  const notice = {
    kind: 'warning' as const,
    source: 'unlinked-list' as const,
    message:
      "Cuttler couldn't read its list of unlinked fonts and started a new one. Fonts you unlinked earlier may reappear from watch folders. You can unlink them again.",
  }
  const app = new Hono()
  mountEventsRoutes(app, {
    paths,
    catalogEvent: () => ({ type: 'catalog', entries: [] }),
  })
  const server = await listen(app)
  const base = `http://127.0.0.1:${server.port}`
  try {
    publishUnlinkedListReset(paths, notice)
    assert.equal(fs.existsSync(unlinkedListResetPendingPath(paths)), true)

    const background = await fetch(`${base}/api/events?client=background`)
    const backgroundEvents = await readSse(background, hasCatalog, 250)
    assert.equal(unlinkedNotice(backgroundEvents), undefined)
    const pending = peekPendingUnlinkedListResetNotice(paths)
    assert.equal(pending?.message, notice.message)
    assert.ok(pending?.resetId)

    const windowResponse = await fetch(`${base}/api/events?client=window`)
    const windowEvents = await readSse(windowResponse, (events) => Boolean(unlinkedNotice(events)))
    assert.equal(unlinkedNotice(windowEvents)?.notice?.message, notice.message)
    assert.equal(fs.existsSync(unlinkedListResetPendingPath(paths)), true)

    const reopened = await fetch(`${base}/api/events?client=window`)
    const reopenedEvents = await readSse(reopened, (events) => Boolean(unlinkedNotice(events)))
    assert.equal(unlinkedNotice(reopenedEvents)?.notice?.message, notice.message)

    const current = peekPendingUnlinkedListResetNotice(paths)
    const stale = await fetch(`${base}/api/notices/unlinked-list-reset/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetId: 'not-the-current-reset' }),
    })
    assert.equal(stale.status, 200)
    assert.equal(peekPendingUnlinkedListResetNotice(paths)?.resetId, current?.resetId)
    const ack = await fetch(`${base}/api/notices/unlinked-list-reset/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetId: current?.resetId }),
    })
    assert.equal(ack.status, 200)
    assert.equal(peekPendingUnlinkedListResetNotice(paths), null)
    assert.equal(fs.existsSync(unlinkedListResetPendingPath(paths)), false)

    const afterAck = await fetch(`${base}/api/events?client=window`)
    const afterAckEvents = await readSse(afterAck, hasCatalog, 250)
    assert.equal(unlinkedNotice(afterAckEvents), undefined)
  } finally {
    const leftover = peekPendingUnlinkedListResetNotice(paths)
    if (leftover?.resetId) acknowledgeUnlinkedListReset(paths, leftover.resetId)
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a legacy pending reset without an id reaches a window once and clears on ack', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-reset-legacy-sse-'))
  const paths = buildPaths({ override: root, mac: false })
  ensureDirs(paths)
  const notice = {
    kind: 'warning' as const,
    source: 'unlinked-list' as const,
    message: 'Legacy pending reset from before reset ids.',
  }
  fs.writeFileSync(unlinkedListResetPendingPath(paths), JSON.stringify({ pending: true, notice }))
  const app = new Hono()
  mountEventsRoutes(app, {
    paths,
    catalogEvent: () => ({ type: 'catalog', entries: [] }),
  })
  const server = await listen(app)
  const base = `http://127.0.0.1:${server.port}`
  try {
    const windowResponse = await fetch(`${base}/api/events?client=window`)
    const windowEvents = await readSse(windowResponse, (events) => Boolean(unlinkedNotice(events)))
    const delivered = unlinkedNotice(windowEvents)?.notice
    assert.equal(delivered?.message, notice.message)
    assert.ok(delivered?.resetId)
    assert.equal(peekPendingUnlinkedListResetNotice(paths)?.resetId, delivered?.resetId)
    const stored = JSON.parse(fs.readFileSync(unlinkedListResetPendingPath(paths), 'utf8')) as {
      id?: string
      notice?: { resetId?: string }
    }
    assert.equal(stored.id, delivered?.resetId)
    assert.equal(stored.notice?.resetId, delivered?.resetId)

    const ack = await fetch(`${base}/api/notices/unlinked-list-reset/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetId: delivered?.resetId }),
    })
    assert.equal(ack.status, 200)
    assert.equal(peekPendingUnlinkedListResetNotice(paths), null)
    assert.equal(fs.existsSync(unlinkedListResetPendingPath(paths)), false)

    const afterAck = await fetch(`${base}/api/events?client=window`)
    const afterAckEvents = await readSse(afterAck, hasCatalog, 250)
    assert.equal(unlinkedNotice(afterAckEvents), undefined)
  } finally {
    const leftover = peekPendingUnlinkedListResetNotice(paths)
    if (leftover?.resetId) acknowledgeUnlinkedListReset(paths, leftover.resetId)
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a duplicate live unlinked-list event cannot produce two notices', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-reset-once-'))
  const paths = buildPaths({ override: root, mac: false })
  ensureDirs(paths)
  const notice = {
    kind: 'warning' as const,
    source: 'unlinked-list' as const,
    message: 'Font Buttler could not read the unlinked list.',
  }
  const app = new Hono()
  mountEventsRoutes(app, {
    paths,
    catalogEvent: () => ({ type: 'catalog', entries: [] }),
  })
  const server = await listen(app)
  const base = `http://127.0.0.1:${server.port}`
  let backgroundReady = false
  let windowReady = false
  let published = false
  const publishOnce = () => {
    if (published || !backgroundReady || !windowReady) return
    published = true
    publishUnlinkedListReset(paths, notice)
  }
  try {
    const background = await fetch(`${base}/api/events?client=background`)
    const windowResponse = await fetch(`${base}/api/events?client=window`)
    const [backgroundEvents, windowEvents] = await Promise.all([
      readSse(background, hasCatalog, 600, (events) => {
        if (!hasCatalog(events)) return
        backgroundReady = true
        publishOnce()
      }),
      readSse(
        windowResponse,
        (events) => hasCatalog(events) && published && unlinkedNotices(events).length > 0,
        300,
        (events) => {
          if (!hasCatalog(events)) return
          windowReady = true
          publishOnce()
        },
      ),
    ])
    assert.equal(published, true)
    assert.equal(unlinkedNotices(backgroundEvents).length, 0)
    assert.equal(unlinkedNotices(windowEvents).length, 1)
    assert.equal(unlinkedNotices(windowEvents)[0]?.notice?.resetId, peekPendingUnlinkedListResetNotice(paths)?.resetId)
  } finally {
    const leftover = peekPendingUnlinkedListResetNotice(paths)
    if (leftover?.resetId) acknowledgeUnlinkedListReset(paths, leftover.resetId)
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a failed pending write still reaches the next window connection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-reset-keep-'))
  const paths = buildPaths({ override: root, mac: false })
  ensureDirs(paths)
  const notice = {
    kind: 'warning' as const,
    source: 'unlinked-list' as const,
    message: 'Kept after the pending file could not be written.',
  }
  const app = new Hono()
  mountEventsRoutes(app, {
    paths,
    catalogEvent: () => ({ type: 'catalog', entries: [] }),
  })
  const server = await listen(app)
  const base = `http://127.0.0.1:${server.port}`
  setUnlinkedListResetWriteFaultForTest(() => {
    throw new Error('disk full')
  })
  try {
    publishUnlinkedListReset(paths, notice)
    assert.equal(fs.existsSync(unlinkedListResetPendingPath(paths)), false)
    const pending = peekPendingUnlinkedListResetNotice(paths)
    assert.equal(pending?.message, notice.message)
    const windowResponse = await fetch(`${base}/api/events?client=window`)
    const windowEvents = await readSse(windowResponse, (events) => Boolean(unlinkedNotice(events)))
    assert.equal(unlinkedNotice(windowEvents)?.notice?.message, notice.message)
    assert.equal(unlinkedNotice(windowEvents)?.notice?.resetId, pending?.resetId)
    const ack = await fetch(`${base}/api/notices/unlinked-list-reset/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetId: pending?.resetId }),
    })
    assert.equal(ack.status, 200)
    assert.equal(peekPendingUnlinkedListResetNotice(paths), null)
  } finally {
    setUnlinkedListResetWriteFaultForTest(undefined)
    const leftover = peekPendingUnlinkedListResetNotice(paths)
    if (leftover?.resetId) acknowledgeUnlinkedListReset(paths, leftover.resetId)
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('an ack for an older unlinked-list reset does not clear the current one', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-reset-stale-'))
  const paths = buildPaths({ override: root, mac: false })
  ensureDirs(paths)
  const app = new Hono()
  mountEventsRoutes(app, {
    paths,
    catalogEvent: () => ({ type: 'catalog', entries: [] }),
  })
  const server = await listen(app)
  const base = `http://127.0.0.1:${server.port}`
  try {
    publishUnlinkedListReset(paths, {
      kind: 'warning',
      source: 'unlinked-list',
      message: 'First reset.',
    })
    const firstId = peekPendingUnlinkedListResetNotice(paths)?.resetId
    assert.ok(firstId)
    publishUnlinkedListReset(paths, {
      kind: 'warning',
      source: 'unlinked-list',
      message: 'Second reset.',
    })
    const second = peekPendingUnlinkedListResetNotice(paths)
    assert.equal(second?.message, 'Second reset.')
    assert.notEqual(second?.resetId, firstId)
    const stale = await fetch(`${base}/api/notices/unlinked-list-reset/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetId: firstId }),
    })
    assert.equal(stale.status, 200)
    assert.equal(peekPendingUnlinkedListResetNotice(paths)?.resetId, second?.resetId)
    assert.equal(peekPendingUnlinkedListResetNotice(paths)?.message, 'Second reset.')
    const ack = await fetch(`${base}/api/notices/unlinked-list-reset/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetId: second?.resetId }),
    })
    assert.equal(ack.status, 200)
    assert.equal(peekPendingUnlinkedListResetNotice(paths), null)
  } finally {
    const leftover = peekPendingUnlinkedListResetNotice(paths)
    if (leftover?.resetId) acknowledgeUnlinkedListReset(paths, leftover.resetId)
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

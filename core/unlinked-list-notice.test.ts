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
  unlinkedListResetPendingPath,
} from './events.ts'
import { buildPaths, ensureDirs } from './paths.ts'
import { mountEventsRoutes } from '../server/events-stream.ts'

type SseEvent = { type?: string; notice?: { source?: string; message?: string } }

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

function unlinkedNotice(events: SseEvent[]): SseEvent | undefined {
  return events.find((event) => event.type === 'notice' && event.notice?.source === 'unlinked-list')
}

test('a background client does not drain the unlinked-list reset notice', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-reset-clients-'))
  const paths = buildPaths({ override: root, mac: false })
  ensureDirs(paths)
  const notice = {
    kind: 'warning' as const,
    source: 'unlinked-list' as const,
    message:
      "Font Buttler couldn't read its list of unlinked fonts and started a new one. Fonts you unlinked earlier may reappear from watch folders. You can unlink them again.",
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
    assert.deepEqual(peekPendingUnlinkedListResetNotice(paths), notice)

    const windowResponse = await fetch(`${base}/api/events?client=window`)
    const windowEvents = await readSse(windowResponse, (events) => Boolean(unlinkedNotice(events)))
    assert.equal(unlinkedNotice(windowEvents)?.notice?.message, notice.message)
    assert.equal(fs.existsSync(unlinkedListResetPendingPath(paths)), true)

    const reopened = await fetch(`${base}/api/events?client=window`)
    const reopenedEvents = await readSse(reopened, (events) => Boolean(unlinkedNotice(events)))
    assert.equal(unlinkedNotice(reopenedEvents)?.notice?.message, notice.message)

    const ack = await fetch(`${base}/api/notices/unlinked-list-reset/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(ack.status, 200)
    assert.equal(peekPendingUnlinkedListResetNotice(paths), null)
    assert.equal(fs.existsSync(unlinkedListResetPendingPath(paths)), false)

    const afterAck = await fetch(`${base}/api/events?client=window`)
    const afterAckEvents = await readSse(afterAck, hasCatalog, 250)
    assert.equal(unlinkedNotice(afterAckEvents), undefined)
  } finally {
    acknowledgeUnlinkedListReset(paths)
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

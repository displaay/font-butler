import { streamSSE } from 'hono/streaming'
import type { Hono } from 'hono'
import {
  acknowledgeUnlinkedListReset,
  onEvent,
  peekPendingUnlinkedListResetNotice,
  takePendingWatchFailureNotices,
} from '../core/events.ts'
import type { AppPaths } from '../core/paths.ts'

/**
 * SSE for catalog events.
 * A window client (`?client=window`) is the only one that receives an unlinked-list
 * reset, live or pending. Background and tray clients do not: they do not clear the
 * pending notice, so a live copy there plus the pending copy on the next window
 * would show the notice twice. The same reset id is written at most once per connection.
 * It stays pending until that renderer acks that id.
 */
export function mountEventsRoutes(
  app: Hono,
  options: {
    paths: AppPaths
    catalogEvent: () => unknown
    onOpen?: (close: () => void) => void
    onClose?: (close: () => void) => void
  },
): void {
  app.post('/api/notices/unlinked-list-reset/ack', async (c) => {
    let resetId = ''
    try {
      const body = await c.req.json<{ resetId?: unknown }>()
      if (body && typeof body.resetId === 'string') resetId = body.resetId
    } catch {
      resetId = ''
    }
    acknowledgeUnlinkedListReset(options.paths, resetId)
    return c.json({ ok: true })
  })

  app.get('/api/events', (c) => {
    const windowClient = c.req.query('client') === 'window'
    return streamSSE(c, async (stream) => {
      let closed = false
      const close = () => {
        closed = true
        unsubscribe()
        options.onClose?.(close)
      }
      const seenWatchFailures = new Set<string>()
      let deliveredResetId = ''
      const watchFailureKey = (notice: { operationId?: string; message: string }) =>
        notice.operationId || notice.message
      const markUnlinkedReset = (resetId: string | undefined): boolean => {
        if (!windowClient) return false
        const id = resetId || ''
        if (id) {
          if (id === deliveredResetId) return false
          deliveredResetId = id
          return true
        }
        if (deliveredResetId) return false
        deliveredResetId = '*'
        return true
      }
      const unsubscribe = onEvent(async (event) => {
        if (closed) {
          return
        }
        if (event.type === 'notice' && event.notice.kind === 'error' && event.notice.source === 'watch') {
          const key = watchFailureKey(event.notice)
          if (seenWatchFailures.has(key)) return
          seenWatchFailures.add(key)
        }
        if (event.type === 'notice' && event.notice.source === 'unlinked-list') {
          if (!markUnlinkedReset(event.notice.resetId)) return
        }
        try {
          await stream.writeSSE({ data: JSON.stringify(event) })
        } catch {
          close()
        }
      })
      options.onOpen?.(close)
      stream.onAbort(close)
      await stream.writeSSE({
        data: JSON.stringify(options.catalogEvent()),
      })
      if (windowClient) {
        const unlinkedReset = peekPendingUnlinkedListResetNotice(options.paths)
        if (unlinkedReset && markUnlinkedReset(unlinkedReset.resetId)) {
          try {
            await stream.writeSSE({ data: JSON.stringify({ type: 'notice', notice: unlinkedReset }) })
          } catch {
            close()
          }
        }
      }
      for (const notice of takePendingWatchFailureNotices()) {
        if (closed) break
        const key = watchFailureKey(notice)
        if (seenWatchFailures.has(key)) continue
        seenWatchFailures.add(key)
        try {
          await stream.writeSSE({ data: JSON.stringify({ type: 'notice', notice }) })
        } catch {
          close()
          break
        }
      }
      while (!closed) {
        await stream.sleep(15_000)
        if (!closed) {
          try {
            await stream.writeSSE({ data: JSON.stringify({ type: 'ping' }) })
          } catch {
            close()
          }
        }
      }
    })
  })
}

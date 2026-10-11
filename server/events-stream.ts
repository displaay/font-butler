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
 * A window client (`?client=window`) is the only one that is offered the pending
 * unlinked-list reset. It stays pending until that renderer acks. Background and
 * tray clients receive live events and must not clear the flag.
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
  app.post('/api/notices/unlinked-list-reset/ack', (c) => {
    acknowledgeUnlinkedListReset(options.paths)
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
      let deliveredUnlinkedReset = false
      const watchFailureKey = (notice: { operationId?: string; message: string }) =>
        notice.operationId || notice.message
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
          if (deliveredUnlinkedReset) return
          deliveredUnlinkedReset = true
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
        if (unlinkedReset && !deliveredUnlinkedReset) {
          deliveredUnlinkedReset = true
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

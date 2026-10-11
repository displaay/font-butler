import { EventEmitter } from 'node:events'
import { logMain } from './main-log.ts'
import type { Notice, ServiceEvent } from './types.ts'

const bus = new EventEmitter()
bus.setMaxListeners(20)
const pendingWatchFailures: Notice[] = []
let pendingUnlinkedListReset: Notice | null = null

export function emitEvent(event: ServiceEvent): void {
  if (
    event.type === 'notice' &&
    event.notice.kind === 'error' &&
    event.notice.source === 'watch' &&
    bus.listenerCount('event') === 0
  ) {
    pendingWatchFailures.push(event.notice)
    if (pendingWatchFailures.length > 50) pendingWatchFailures.shift()
  }
  if (event.type === 'notice' && event.notice.source === 'logout') {
    const listeners = bus.listenerCount('event')
    const attemptId = event.notice.attemptId || ''
    logMain(
      'install',
      `logout late failure notice emitted listeners=${listeners} attemptId=${attemptId}`,
    )
  }
  bus.emit('event', event)
}

/** Watch failures emitted while nobody was listening. The next subscriber takes them. */
export function takePendingWatchFailureNotices(): Notice[] {
  return pendingWatchFailures.splice(0, pendingWatchFailures.length)
}

/**
 * Queue the reset notice until a window connects.
 * If a window is already listening, deliver it live and drop the queue
 * so a reconnect does not show it again.
 */
export function publishUnlinkedListReset(notice: Notice): void {
  if (bus.listenerCount('event') === 0) {
    pendingUnlinkedListReset = notice
    return
  }
  pendingUnlinkedListReset = null
  emitEvent({ type: 'notice', notice })
}

export function takePendingUnlinkedListResetNotice(): Notice | null {
  const notice = pendingUnlinkedListReset
  pendingUnlinkedListReset = null
  return notice
}

export function onEvent(listener: (event: ServiceEvent) => void): () => void {
  bus.on('event', listener)
  return () => {
    bus.off('event', listener)
  }
}

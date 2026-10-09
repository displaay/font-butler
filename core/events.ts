import { EventEmitter } from 'node:events'
import type { Notice, ServiceEvent } from './types.ts'

const bus = new EventEmitter()
bus.setMaxListeners(20)
const pendingWatchFailures: Notice[] = []

export function emitEvent(event: ServiceEvent): void {
  if (event.type === 'notice' && event.notice.kind === 'error' && event.notice.source === 'watch') {
    pendingWatchFailures.push(event.notice)
    if (pendingWatchFailures.length > 50) pendingWatchFailures.shift()
  }
  bus.emit('event', event)
}

/** Watch failures emitted before any event stream was open. The first subscriber takes them. */
export function takePendingWatchFailureNotices(): Notice[] {
  return pendingWatchFailures.splice(0, pendingWatchFailures.length)
}

export function onEvent(listener: (event: ServiceEvent) => void): () => void {
  bus.on('event', listener)
  return () => {
    bus.off('event', listener)
  }
}

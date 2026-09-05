import { EventEmitter } from 'node:events'
import type { ServiceEvent } from './types.ts'

const bus = new EventEmitter()

export function emitEvent(event: ServiceEvent): void {
  bus.emit('event', event)
}

export function onEvent(listener: (event: ServiceEvent) => void): () => void {
  bus.on('event', listener)
  return () => {
    bus.off('event', listener)
  }
}

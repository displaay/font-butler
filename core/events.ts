import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { logMain } from './main-log.ts'
import type { AppPaths } from './paths.ts'
import type { Notice, ServiceEvent } from './types.ts'

const bus = new EventEmitter()
bus.setMaxListeners(20)
const pendingWatchFailures: Notice[] = []

export function unlinkedListResetPendingPath(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'unlinked-list-reset-pending.json')
}

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
 * Keep the reset notice until a window renderer acknowledges it was shown.
 * The flag is on disk so quitting before that ack does not drop it.
 * Live listeners still receive it, and that delivery does not clear the flag.
 */
export function publishUnlinkedListReset(paths: AppPaths, notice: Notice): void {
  const file = unlinkedListResetPendingPath(paths)
  try {
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify({ pending: true, notice }))
    fs.renameSync(temp, file)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logMain('catalog', `could not save the unlinked-list reset notice: ${reason}`)
  }
  emitEvent({ type: 'notice', notice })
}

/** Read the pending notice. Does not clear it. */
export function peekPendingUnlinkedListResetNotice(paths: AppPaths): Notice | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(unlinkedListResetPendingPath(paths), 'utf8')) as {
      pending?: boolean
      notice?: Notice
    }
    if (parsed.pending === true && parsed.notice?.source === 'unlinked-list' && parsed.notice.message) {
      return parsed.notice
    }
  } catch {
    return null
  }
  return null
}

/** A window renderer calls this after the notice is on screen. */
export function acknowledgeUnlinkedListReset(paths: AppPaths): void {
  fs.rmSync(unlinkedListResetPendingPath(paths), { force: true })
}

export function onEvent(listener: (event: ServiceEvent) => void): () => void {
  bus.on('event', listener)
  return () => {
    bus.off('event', listener)
  }
}

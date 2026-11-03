import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { logMain } from './main-log.ts'
import type { AppPaths } from './paths.ts'
import type { Notice, ServiceEvent } from './types.ts'

const bus = new EventEmitter()
bus.setMaxListeners(20)
const pendingWatchFailures: Notice[] = []
/**
 * Latest reset whose pending file could not be written, keyed by data root.
 * The next window connection reads this instead of dropping the notice.
 */
const pendingUnlinkedResets = new Map<string, Notice>()
let unlinkedListResetWriteFault: (() => void) | undefined

/** Tests make the pending-file write throw. Production does not set this. */
export function setUnlinkedListResetWriteFaultForTest(fault: (() => void) | undefined): void {
  unlinkedListResetWriteFault = fault
}

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

function writeUnlinkedListResetPending(paths: AppPaths, stamped: Notice): void {
  const resetId = stamped.resetId || ''
  const file = unlinkedListResetPendingPath(paths)
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify({ pending: true, id: resetId, notice: stamped }))
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}

function readStoredUnlinkedListReset(paths: AppPaths): Notice | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(unlinkedListResetPendingPath(paths), 'utf8')) as {
      pending?: boolean
      id?: string
      notice?: Notice
    }
    if (parsed.pending === true && parsed.notice?.source === 'unlinked-list' && parsed.notice.message) {
      const existingId = parsed.notice.resetId || (typeof parsed.id === 'string' ? parsed.id : '')
      if (existingId) {
        return { ...parsed.notice, resetId: existingId }
      }
      // Pre-resetId pending files had no id. Stamp one and rewrite so a window can ack.
      const resetId = crypto.randomUUID()
      const stamped: Notice = { ...parsed.notice, resetId }
      try {
        writeUnlinkedListResetPending(paths, stamped)
        pendingUnlinkedResets.delete(paths.dataRoot)
      } catch (error) {
        pendingUnlinkedResets.set(paths.dataRoot, stamped)
        const reason = error instanceof Error ? error.message : String(error)
        logMain('catalog', `could not migrate the unlinked-list reset notice: ${reason}`)
      }
      return stamped
    }
  } catch {
    return null
  }
  return null
}

/**
 * Keep the reset notice until a window renderer acknowledges that reset.
 * The flag is on disk so quitting before that ack does not drop it.
 * A failed write stays in memory for the next window connection.
 * Live listeners still receive it, and that delivery does not clear the flag.
 * Each publish is its own reset id. An ack names the reset it saw.
 */
export function publishUnlinkedListReset(paths: AppPaths, notice: Notice): void {
  const resetId = crypto.randomUUID()
  const stamped: Notice = { ...notice, resetId }
  try {
    unlinkedListResetWriteFault?.()
    writeUnlinkedListResetPending(paths, stamped)
    pendingUnlinkedResets.delete(paths.dataRoot)
  } catch (error) {
    pendingUnlinkedResets.set(paths.dataRoot, stamped)
    const reason = error instanceof Error ? error.message : String(error)
    logMain('catalog', `could not save the unlinked-list reset notice: ${reason}`)
  }
  emitEvent({ type: 'notice', notice: stamped })
}

/**
 * Read the pending notice. Does not clear it.
 * A reset kept in memory after a failed write wins over an older file.
 */
export function peekPendingUnlinkedListResetNotice(paths: AppPaths): Notice | null {
  return pendingUnlinkedResets.get(paths.dataRoot) ?? readStoredUnlinkedListReset(paths)
}

/**
 * A window renderer calls this after that reset is on screen.
 * An id that is not the current reset is ignored, so an older window
 * cannot clear a reset that happened later.
 */
export function acknowledgeUnlinkedListReset(paths: AppPaths, resetId: string): boolean {
  const current = peekPendingUnlinkedListResetNotice(paths)
  if (!resetId || current?.resetId !== resetId) return false
  pendingUnlinkedResets.delete(paths.dataRoot)
  fs.rmSync(unlinkedListResetPendingPath(paths), { force: true })
  return true
}

export function onEvent(listener: (event: ServiceEvent) => void): () => void {
  bus.on('event', listener)
  return () => {
    bus.off('event', listener)
  }
}

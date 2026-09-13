import { AsyncLocalStorage } from 'node:async_hooks'
import { yieldEventLoop } from './event-loop.ts'
import type { FontNative } from './native.ts'

/**
 * Serialise font-file work (install / uninstall / native register) so callers can
 * queue another operation without overlapping Core Text or file copies.
 *
 * Each task yields before it starts so HTTP, SSE, Settings, and onboarding stay
 * responsive while native register/unregister is in flight.
 */
let queue: Promise<void> = Promise.resolve()
let pending = 0
const lock = new AsyncLocalStorage<boolean>()

export function pendingFontFileTasks(): number {
  return pending
}

export async function runFontFileTask<T>(task: () => Promise<T> | T): Promise<T> {
  if (lock.getStore()) {
    await yieldEventLoop()
    return task()
  }
  pending += 1
  const run = async () => {
    await yieldEventLoop()
    return lock.run(true, () => task())
  }
  const result = queue.then(run, run)
  queue = result.then(
    () => undefined,
    () => undefined,
  )
  try {
    return await result
  } finally {
    pending -= 1
  }
}

export function serializeFontNative(native: FontNative): FontNative {
  return {
    registerFont: (filePath) => runFontFileTask(() => native.registerFont(filePath)),
    unregisterFont: (filePath) => runFontFileTask(() => native.unregisterFont(filePath)),
    setFontEnabled: (filePath, enabled) =>
      runFontFileTask(() => native.setFontEnabled(filePath, enabled)),
    ensureActivation: native.ensureActivation
      ? (filePath, enabled) => runFontFileTask(() => native.ensureActivation!(filePath, enabled))
      : undefined,
    fontActivationStates: (filePaths) => runFontFileTask(() => native.fontActivationStates(filePaths)),
    clearUserFontCache: () => runFontFileTask(() => native.clearUserFontCache()),
    clearOfficeFontCache: () => runFontFileTask(() => native.clearOfficeFontCache()),
    clearAdobeFontCache: () => runFontFileTask(() => native.clearAdobeFontCache()),
    clearFontCaches: (options) => runFontFileTask(() => native.clearFontCaches(options)),
  }
}

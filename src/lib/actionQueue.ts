/**
 * FIFO queue for font-file work started from the UI (install, uninstall, drop import).
 * A second action can be started while one is running; they run in order.
 */
export type SerialQueue = {
  readonly pending: number
  enqueue<T>(task: () => Promise<T>): Promise<T>
}

export function createSerialQueue(): SerialQueue {
  let chain = Promise.resolve()
  let pending = 0
  return {
    get pending() {
      return pending
    },
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      pending += 1
      const result = chain.then(task, task)
      chain = result.then(
        () => undefined,
        () => undefined,
      )
      return result.finally(() => {
        pending -= 1
      })
    },
  }
}

export const fontActionQueue = createSerialQueue()

/**
 * Enqueue font-file work and return immediately so the renderer stays interactive.
 * Callers must not await native install/uninstall; progress and errors surface from the job.
 */
export function startQueuedAction(queue: SerialQueue, task: () => Promise<unknown>): void {
  void queue.enqueue(task)
}

export function startQueuedFontAction(task: () => Promise<unknown>): void {
  startQueuedAction(fontActionQueue, task)
}

/** True when this is the last job currently counted on the queue (including the running one). */
export function isLastQueuedFontAction(): boolean {
  return fontActionQueue.pending <= 1
}

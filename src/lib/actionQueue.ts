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

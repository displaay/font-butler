/** Yield to the event loop so HTTP, SSE, and UI timers can run during bulk work. */
export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

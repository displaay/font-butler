/**
 * The main process keeps one announcement until the renderer asks for it
 * and later acknowledges it. A push before the renderer is listening is dropped.
 */
export function createAnnouncementSlot() {
  let pending = null
  let mounted = false
  const listeners = new Set()
  return {
    markMounted() {
      mounted = true
    },
    onShow(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stage(announcement) {
      pending = announcement ?? null
      if (mounted && pending) {
        for (const listener of listeners) listener(pending)
      }
      return pending
    },
    pull() {
      return pending
    },
    acknowledge(id) {
      if (!pending || pending.id !== id) return pending
      pending = null
      return null
    },
  }
}

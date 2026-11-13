/**
 * The main process keeps one announcement until the renderer asks for it
 * and later acknowledges it. A push before the renderer is listening is dropped.
 */
export function createAnnouncementSlot() {
  let pending = null
  return {
    stage(announcement) {
      pending = announcement ?? null
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

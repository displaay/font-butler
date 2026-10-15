/**
 * Tracks external font open/import depth in main and broadcasts absolute depth to the renderer.
 */
export function createExternalFontOpenNotifier(sendDepth) {
  let depth = 0

  function broadcast() {
    sendDepth({ depth })
  }

  return {
    getDepth() {
      return depth
    },
    pending() {
      depth += 1
      broadcast()
    },
    done() {
      depth = Math.max(0, depth - 1)
      broadcast()
    },
  }
}

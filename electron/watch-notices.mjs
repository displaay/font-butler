export function isWatchFailureNotice(notice) {
  return Boolean(
    notice && notice.kind === 'error' && notice.source === 'watch' && typeof notice.message === 'string',
  )
}

function noticeKey(notice) {
  return `${notice.operationId ?? ''}:${notice.message ?? ''}`
}

/** Hold watch-folder failure toasts until the renderer can show them. */
export function createWatchNoticeBuffer() {
  let ready = false
  const pending = []
  const seen = new Set()
  return {
    push(notice) {
      if (!isWatchFailureNotice(notice)) return []
      const key = noticeKey(notice)
      if (seen.has(key)) return []
      seen.add(key)
      if (!ready) {
        pending.push(notice)
        return []
      }
      return [notice]
    },
    markReady() {
      ready = true
      return pending.splice(0, pending.length)
    },
    markNotReady() {
      ready = false
    },
  }
}

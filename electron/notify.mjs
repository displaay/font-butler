export function noticeDedupeKey(notice) {
  return `${notice?.kind ?? ''}:${notice?.entryId ?? ''}:${notice?.message ?? ''}`
}

export function shouldShowNativeNotice({
  enabled,
  windowHidden,
  kind,
  key,
  lastKey,
  now,
  lastAt,
  windowMs = 2000,
}) {
  if (!enabled) return false
  if (!windowHidden) return false
  if (kind !== 'installed' && kind !== 'reinstalled') return false
  if (key && key === lastKey && typeof lastAt === 'number' && now - lastAt < windowMs) {
    return false
  }
  return true
}

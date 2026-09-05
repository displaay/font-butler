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

export function electronNotificationPermission(NotificationCtor) {
  if (!NotificationCtor || typeof NotificationCtor.isSupported !== 'function') {
    return 'denied'
  }
  return NotificationCtor.isSupported() ? 'granted' : 'denied'
}

export function deliverNativeNotice({
  notice,
  enabled,
  windowHidden,
  lastKey,
  lastAt,
  now,
  windowMs = 2000,
  createNotification,
}) {
  const key = noticeDedupeKey(notice)
  if (
    !shouldShowNativeNotice({
      enabled,
      windowHidden,
      kind: notice?.kind,
      key,
      lastKey,
      now,
      lastAt,
      windowMs,
    })
  ) {
    return { shown: false, lastKey, lastAt }
  }
  const notification = createNotification({
    title: 'Font Buttler',
    body: notice.message,
  })
  notification.show()
  return { shown: true, lastKey: key, lastAt: now, notification }
}

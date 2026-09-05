import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deliverNativeNotice,
  electronNotificationPermission,
  noticeDedupeKey,
  shouldShowNativeNotice,
} from './notify.mjs'

const notice = { kind: 'installed', entryId: '1', message: 'Installed Inter' }

function fakeNotification() {
  const events = {}
  return {
    shown: false,
    clicks: 0,
    on(name, handler) {
      events[name] = handler
    },
    show() {
      this.shown = true
    },
    click() {
      events.click?.()
      this.clicks += 1
    },
  }
}

test('native notices only fire when enabled, hidden, and not duplicated', () => {
  const key = noticeDedupeKey(notice)
  assert.equal(
    shouldShowNativeNotice({
      enabled: true,
      windowHidden: true,
      kind: 'installed',
      key,
      lastKey: null,
      now: 1000,
      lastAt: 0,
    }),
    true,
  )
  assert.equal(
    shouldShowNativeNotice({
      enabled: false,
      windowHidden: true,
      kind: 'installed',
      key,
      lastKey: null,
      now: 1000,
      lastAt: 0,
    }),
    false,
  )
  assert.equal(
    shouldShowNativeNotice({
      enabled: true,
      windowHidden: false,
      kind: 'installed',
      key,
      lastKey: null,
      now: 1000,
      lastAt: 0,
    }),
    false,
  )
  assert.equal(
    shouldShowNativeNotice({
      enabled: true,
      windowHidden: true,
      kind: 'installed',
      key,
      lastKey: key,
      now: 1500,
      lastAt: 1000,
    }),
    false,
  )
})

test('deliverNativeNotice constructs a notification only for a hidden enabled window', () => {
  const created = []
  const shown = deliverNativeNotice({
    notice,
    enabled: true,
    windowHidden: true,
    lastKey: null,
    lastAt: 0,
    now: 1000,
    createNotification(options) {
      created.push(options)
      return fakeNotification()
    },
  })
  assert.equal(shown.shown, true)
  assert.equal(created.length, 1)
  assert.equal(created[0].title, 'Font Buttler')
  assert.equal(created[0].body, 'Installed Inter')

  const skippedHiddenOff = deliverNativeNotice({
    notice,
    enabled: false,
    windowHidden: true,
    lastKey: null,
    lastAt: 0,
    now: 2000,
    createNotification() {
      created.push({})
      return fakeNotification()
    },
  })
  assert.equal(skippedHiddenOff.shown, false)

  const skippedVisible = deliverNativeNotice({
    notice,
    enabled: true,
    windowHidden: false,
    lastKey: null,
    lastAt: 0,
    now: 3000,
    createNotification() {
      created.push({})
      return fakeNotification()
    },
  })
  assert.equal(skippedVisible.shown, false)
  assert.equal(created.length, 1)
})

test('notification click is wired by the caller', () => {
  let opened = 0
  const n = fakeNotification()
  n.on('click', () => {
    opened += 1
  })
  deliverNativeNotice({
    notice,
    enabled: true,
    windowHidden: true,
    lastKey: null,
    lastAt: 0,
    now: 1000,
    createNotification() {
      return n
    },
  })
  n.click()
  assert.equal(n.shown, true)
  assert.equal(opened, 1)
})

test('electronNotificationPermission follows Notification.isSupported', () => {
  assert.equal(electronNotificationPermission(undefined), 'denied')
  assert.equal(electronNotificationPermission({ isSupported: () => false }), 'denied')
  assert.equal(electronNotificationPermission({ isSupported: () => true }), 'granted')
})

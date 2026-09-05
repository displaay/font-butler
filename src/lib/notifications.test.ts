import assert from 'node:assert/strict'
import { test } from 'node:test'
import { persistNativeNotificationsEnabled } from './notifications.ts'

test('notification permission denial keeps the setting off', () => {
  assert.equal(persistNativeNotificationsEnabled(true, 'granted'), true)
  assert.equal(persistNativeNotificationsEnabled(true, 'denied'), false)
  assert.equal(persistNativeNotificationsEnabled(true, 'default'), false)
  assert.equal(persistNativeNotificationsEnabled(false, 'granted'), false)
})

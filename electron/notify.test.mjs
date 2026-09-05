import assert from 'node:assert/strict'
import { test } from 'node:test'
import { noticeDedupeKey, shouldShowNativeNotice } from './notify.mjs'

test('native notices only fire when enabled, hidden, and not duplicated', () => {
  const notice = { kind: 'installed', entryId: '1', message: 'Installed Inter' }
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

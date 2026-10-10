import assert from 'node:assert/strict'
import { test } from 'node:test'
import { logoutNoticeAction } from './logout-notice.ts'

test('the renderer never owns the logout failure dialog', () => {
  assert.equal(logoutNoticeAction('logout', true), 'ignore')
  assert.equal(logoutNoticeAction('logout', false), 'ignore')
  assert.equal(logoutNoticeAction('logout-waiting', true), 'waiting')
  assert.equal(logoutNoticeAction('logout-waiting', false), 'ignore')
  assert.equal(logoutNoticeAction('watch', true), 'pass')
  assert.equal(logoutNoticeAction(undefined, false), 'pass')
})

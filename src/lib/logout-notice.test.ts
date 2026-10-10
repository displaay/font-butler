import assert from 'node:assert/strict'
import { test } from 'node:test'
import { logoutNoticeAction } from './logout-notice.ts'

test('the renderer leaves logout notices to the main process', () => {
  assert.equal(logoutNoticeAction('logout'), 'ignore')
  assert.equal(logoutNoticeAction('logout-waiting'), 'ignore')
  assert.equal(logoutNoticeAction('watch'), 'pass')
  assert.equal(logoutNoticeAction(undefined), 'pass')
})

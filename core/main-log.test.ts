import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { APP_LOG_FOLDER, TEST_APP_LOG_FOLDER, mainLogPath } from './main-log.ts'

test('a test-feed log name writes main.log under Font Buttler Test', () => {
  const home = '/Users/tester'
  assert.equal(TEST_APP_LOG_FOLDER, 'Font Buttler Test')
  assert.equal(
    mainLogPath(home, 'darwin', { FONT_BUTLER_LOG_NAME: 'Font Buttler Test' }),
    path.join(home, 'Library', 'Logs', 'Font Buttler Test', 'main.log'),
  )
  assert.equal(
    mainLogPath(home, 'darwin', {}),
    path.join(home, 'Library', 'Logs', APP_LOG_FOLDER, 'main.log'),
  )
  assert.equal(
    mainLogPath(home, 'linux', { FONT_BUTLER_LOG_NAME: TEST_APP_LOG_FOLDER }),
    path.join(home, '.local', 'state', TEST_APP_LOG_FOLDER, 'logs', 'main.log'),
  )
  const override = '/tmp/custom-main.log'
  assert.equal(
    mainLogPath(home, 'darwin', {
      FONT_BUTLER_LOG: override,
      FONT_BUTLER_LOG_NAME: 'Font Buttler Test',
    }),
    path.resolve(override),
  )
})

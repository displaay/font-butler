import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWatchNoticeBuffer } from './watch-notices.mjs'

test('a notice emitted before ready is delivered after ready', () => {
  const buffer = createWatchNoticeBuffer()
  const notice = {
    kind: 'error',
    source: 'watch',
    message: 'Bad.ttf: Not a font file.',
    operationId: 'op-1',
  }
  assert.deepEqual(buffer.push(notice), [])
  assert.deepEqual(buffer.push({ kind: 'installed', message: 'Installed Inter' }), [])
  assert.deepEqual(buffer.markReady(), [notice])
  const later = {
    kind: 'error',
    source: 'watch',
    message: 'Later.ttf: Not a font file.',
    operationId: 'op-2',
  }
  assert.deepEqual(buffer.push(later), [later])
  assert.deepEqual(buffer.push(notice), [])
})

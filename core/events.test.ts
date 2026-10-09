import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emitEvent, onEvent, takePendingWatchFailureNotices } from './events.ts'

test('a watch failure delivered live is not replayed to a later subscriber', () => {
  takePendingWatchFailureNotices()
  const notice = {
    kind: 'error' as const,
    source: 'watch' as const,
    message: 'Live.ttf: Not a font file.',
    operationId: 'live-notice',
  }
  const seen: string[] = []
  const stop = onEvent((event) => {
    if (event.type === 'notice' && event.notice.source === 'watch') seen.push(event.notice.message)
  })
  emitEvent({ type: 'notice', notice })
  stop()
  assert.deepEqual(seen, [notice.message])
  assert.deepEqual(takePendingWatchFailureNotices(), [])
})

test('a watch failure emitted before anyone is listening still arrives for the next subscriber', () => {
  takePendingWatchFailureNotices()
  const notice = {
    kind: 'error' as const,
    source: 'watch' as const,
    message: 'Early.ttf: Not a font file.',
    operationId: 'early-notice',
  }
  emitEvent({ type: 'notice', notice })
  assert.deepEqual(takePendingWatchFailureNotices(), [notice])
  assert.deepEqual(takePendingWatchFailureNotices(), [])
})

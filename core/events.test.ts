import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildPaths, ensureDirs } from './paths.ts'
import {
  acknowledgeUnlinkedListReset,
  emitEvent,
  onEvent,
  peekPendingUnlinkedListResetNotice,
  publishUnlinkedListReset,
  takePendingWatchFailureNotices,
  unlinkedListResetPendingPath,
} from './events.ts'

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

test('an unlinked-list reset stays on disk until a window acknowledges it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-reset-notice-'))
  const paths = buildPaths({ override: root, mac: false })
  ensureDirs(paths)
  const notice = {
    kind: 'warning' as const,
    source: 'unlinked-list' as const,
    message: 'Font Buttler could not read the unlinked list.',
  }
  try {
    publishUnlinkedListReset(paths, notice)
    assert.equal(fs.existsSync(unlinkedListResetPendingPath(paths)), true)
    assert.deepEqual(peekPendingUnlinkedListResetNotice(paths), notice)
    assert.deepEqual(peekPendingUnlinkedListResetNotice(paths), notice)
    const seen: string[] = []
    const stop = onEvent((event) => {
      if (event.type === 'notice' && event.notice.source === 'unlinked-list') seen.push(event.notice.message)
    })
    try {
      publishUnlinkedListReset(paths, notice)
      assert.deepEqual(seen, [notice.message])
      assert.deepEqual(peekPendingUnlinkedListResetNotice(paths), notice)
    } finally {
      stop()
    }
    acknowledgeUnlinkedListReset(paths)
    assert.equal(peekPendingUnlinkedListResetNotice(paths), null)
    assert.equal(fs.existsSync(unlinkedListResetPendingPath(paths)), false)
  } finally {
    acknowledgeUnlinkedListReset(paths)
    fs.rmSync(root, { recursive: true, force: true })
  }
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

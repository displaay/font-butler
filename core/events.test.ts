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
  setUnlinkedListResetWriteFaultForTest,
  takePendingWatchFailureNotices,
  unlinkedListResetPendingPath,
} from './events.ts'
import type { Notice } from './types.ts'

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
    message: 'Cuttler could not read the unlinked list.',
  }
  try {
    publishUnlinkedListReset(paths, notice)
    assert.equal(fs.existsSync(unlinkedListResetPendingPath(paths)), true)
    const first = peekPendingUnlinkedListResetNotice(paths)
    assert.ok(first?.resetId)
    assert.deepEqual(noticeWithoutResetId(first), notice)
    assert.deepEqual(peekPendingUnlinkedListResetNotice(paths), first)
    const seen: string[] = []
    const stop = onEvent((event) => {
      if (event.type === 'notice' && event.notice.source === 'unlinked-list') seen.push(event.notice.message)
    })
    try {
      publishUnlinkedListReset(paths, notice)
      assert.deepEqual(seen, [notice.message])
      const second = peekPendingUnlinkedListResetNotice(paths)
      assert.ok(second?.resetId)
      assert.notEqual(second?.resetId, first.resetId)
      assert.deepEqual(noticeWithoutResetId(second), notice)
    } finally {
      stop()
    }
    const current = peekPendingUnlinkedListResetNotice(paths)
    assert.equal(acknowledgeUnlinkedListReset(paths, first.resetId!), false)
    assert.equal(peekPendingUnlinkedListResetNotice(paths)?.resetId, current?.resetId)
    assert.equal(acknowledgeUnlinkedListReset(paths, current?.resetId ?? ''), true)
    assert.equal(peekPendingUnlinkedListResetNotice(paths), null)
    assert.equal(fs.existsSync(unlinkedListResetPendingPath(paths)), false)
  } finally {
    const leftover = peekPendingUnlinkedListResetNotice(paths)
    if (leftover?.resetId) acknowledgeUnlinkedListReset(paths, leftover.resetId)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function noticeWithoutResetId(notice: Notice | null): Omit<Notice, 'resetId'> | null {
  if (!notice) return null
  const { resetId: _resetId, ...rest } = notice
  return rest
}

test('a legacy pending file without a reset id is rewritten with a stable id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-reset-legacy-'))
  const paths = buildPaths({ override: root, mac: false })
  ensureDirs(paths)
  const notice = {
    kind: 'warning' as const,
    source: 'unlinked-list' as const,
    message: 'Font Buttler could not read the unlinked list.',
  }
  const file = unlinkedListResetPendingPath(paths)
  fs.writeFileSync(file, JSON.stringify({ pending: true, notice }))
  try {
    const first = peekPendingUnlinkedListResetNotice(paths)
    assert.ok(first?.resetId)
    assert.deepEqual(noticeWithoutResetId(first), notice)
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      pending?: boolean
      id?: string
      notice?: Notice
    }
    assert.equal(stored.pending, true)
    assert.equal(stored.id, first.resetId)
    assert.equal(stored.notice?.resetId, first.resetId)
    assert.equal(peekPendingUnlinkedListResetNotice(paths)?.resetId, first.resetId)
    assert.equal(acknowledgeUnlinkedListReset(paths, first.resetId!), true)
    assert.equal(peekPendingUnlinkedListResetNotice(paths), null)
    assert.equal(fs.existsSync(file), false)
  } finally {
    const leftover = peekPendingUnlinkedListResetNotice(paths)
    if (leftover?.resetId) acknowledgeUnlinkedListReset(paths, leftover.resetId)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a failed unlinked-list pending write keeps the notice for the next reader', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-reset-write-'))
  const paths = buildPaths({ override: root, mac: false })
  ensureDirs(paths)
  const notice = {
    kind: 'warning' as const,
    source: 'unlinked-list' as const,
    message: 'Font Buttler could not read the unlinked list.',
  }
  setUnlinkedListResetWriteFaultForTest(() => {
    throw new Error('disk full')
  })
  try {
    publishUnlinkedListReset(paths, notice)
    assert.equal(fs.existsSync(unlinkedListResetPendingPath(paths)), false)
    const pending = peekPendingUnlinkedListResetNotice(paths)
    assert.ok(pending?.resetId)
    assert.deepEqual(noticeWithoutResetId(pending), notice)
    assert.equal(acknowledgeUnlinkedListReset(paths, 'stale-reset'), false)
    assert.equal(peekPendingUnlinkedListResetNotice(paths)?.resetId, pending?.resetId)
    assert.equal(acknowledgeUnlinkedListReset(paths, pending?.resetId ?? ''), true)
    assert.equal(peekPendingUnlinkedListResetNotice(paths), null)
  } finally {
    setUnlinkedListResetWriteFaultForTest(undefined)
    const leftover = peekPendingUnlinkedListResetNotice(paths)
    if (leftover?.resetId) acknowledgeUnlinkedListReset(paths, leftover.resetId)
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

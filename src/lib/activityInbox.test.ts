import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  activityRowLabel,
  mergeUnreadFlags,
  unreadActivityCount,
  unreadOperationIdsToMark,
} from './activityInbox.ts'

function op(
  id: string,
  extra: { outcome?: string; unread?: boolean; trigger?: string; action?: string; familyName?: string } = {},
) {
  return {
    id,
    outcome: extra.outcome ?? 'succeeded',
    unread: extra.unread,
    trigger: extra.trigger ?? 'manual',
    action: extra.action ?? 'install',
    familyName: extra.familyName,
  }
}

test('activityRowLabel uses the action and family', () => {
  assert.equal(activityRowLabel({ action: 'install', familyName: 'Inter' }), 'Install · Inter')
  assert.equal(activityRowLabel({ action: 'apply-plan' }), 'Import')
})

test('unreadActivityCount ignores read operations', () => {
  assert.equal(unreadActivityCount([op('a', { unread: true }), op('b'), op('c', { unread: true })]), 2)
})

test('foreground busy operations stay read', () => {
  assert.deepEqual(
    unreadOperationIdsToMark({
      previous: [],
      next: [op('install-1', { trigger: 'manual' })],
      foregroundBusy: true,
      windowHidden: false,
      markVisibleBackground: true,
    }),
    [],
  )
})

test('visible background operations are unread when the user is not busy', () => {
  assert.deepEqual(
    unreadOperationIdsToMark({
      previous: [],
      next: [op('install-1', { trigger: 'manual', action: 'install' })],
      foregroundBusy: false,
      windowHidden: false,
      markVisibleBackground: true,
    }),
    ['install-1'],
  )
})

test('hidden-window operations are unread even without visible-background marking', () => {
  assert.deepEqual(
    unreadOperationIdsToMark({
      previous: [],
      next: [op('activate-1', { trigger: 'manual', action: 'activate' })],
      foregroundBusy: false,
      windowHidden: true,
      markVisibleBackground: false,
    }),
    ['activate-1'],
  )
})

test('electron does not badge visible foreground ops when the window is shown', () => {
  assert.deepEqual(
    unreadOperationIdsToMark({
      previous: [],
      next: [op('install-1', { trigger: 'manual' })],
      foregroundBusy: false,
      windowHidden: false,
      markVisibleBackground: false,
    }),
    [],
  )
})

test('watch and startup triggers are unread even while the user is busy', () => {
  assert.deepEqual(
    unreadOperationIdsToMark({
      previous: [],
      next: [
        op('watch-1', { trigger: 'watch', action: 'apply-plan' }),
        op('boot-1', { trigger: 'startup', action: 'recover-journal' }),
      ],
      foregroundBusy: true,
      windowHidden: false,
      markVisibleBackground: false,
    }),
    ['watch-1', 'boot-1'],
  )
})

test('already unread or pending operations are not marked again', () => {
  assert.deepEqual(
    unreadOperationIdsToMark({
      previous: [op('old', { unread: true }), op('pending', { outcome: 'pending' })],
      next: [
        op('old', { unread: true }),
        op('pending', { outcome: 'pending' }),
        op('same', { trigger: 'manual' }),
      ],
      foregroundBusy: false,
      windowHidden: true,
      markVisibleBackground: true,
    }),
    ['same'],
  )
})

test('newly finished operations become unread candidates', () => {
  assert.deepEqual(
    unreadOperationIdsToMark({
      previous: [op('op-1', { outcome: 'pending', trigger: 'watch' })],
      next: [op('op-1', { outcome: 'succeeded', trigger: 'watch' })],
      foregroundBusy: false,
      windowHidden: false,
      markVisibleBackground: false,
    }),
    ['op-1'],
  )
})

test('mergeUnreadFlags only sets the requested ids', () => {
  const merged = mergeUnreadFlags(
    [
      { ...op('a'), startedAt: 1, items: [], undoable: false, undone: false },
      { ...op('b'), startedAt: 1, items: [], undoable: false, undone: false },
    ],
    ['b'],
  )
  assert.equal(merged[0]?.unread, undefined)
  assert.equal(merged[1]?.unread, true)
})

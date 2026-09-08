import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  activityItemLabel,
  activityRowLabel,
  entryActivityLabel,
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

test('activityRowLabel uses past tense with the family first', () => {
  assert.equal(activityRowLabel({ action: 'install', familyName: 'Inter' }), 'Inter installed')
  assert.equal(activityRowLabel({ action: 'uninstall', familyName: 'Fenul' }), 'Fenul uninstalled')
  assert.equal(activityRowLabel({ action: 'deactivate', familyName: 'Fenul' }), 'Fenul deactivated')
  assert.equal(activityRowLabel({ action: 'apply-plan', familyName: 'News' }), 'News imported')
  assert.equal(activityRowLabel({ action: 'apply-plan' }), 'Imported')
})

test('entryActivityLabel names the style and format', () => {
  assert.equal(
    entryActivityLabel({
      faces: [
        {
          familyName: 'Fenul',
          styleName: 'Regular',
          fullName: 'Fenul Regular',
          postscriptName: 'Fenul-Regular',
          isVariable: false,
          instanceCount: 1,
          instanceNames: [],
          weight: 400,
          italic: false,
        },
      ],
      format: 'otf',
      sourcePath: '/Fonts/Fenul/Fenul-Regular.otf',
    }),
    'Regular · OTF',
  )
})

test('activityItemLabel upgrades family-only labels from the catalog', () => {
  const entry = {
    faces: [
      {
        familyName: 'Fenul',
        styleName: 'Bold',
        fullName: 'Fenul Bold',
        postscriptName: 'Fenul-Bold',
        isVariable: false,
        instanceCount: 1,
        instanceNames: [],
        weight: 700,
        italic: false,
      },
    ],
    format: 'otf',
    sourcePath: '/Fonts/Fenul/Fenul-Bold.otf',
  }
  assert.equal(activityItemLabel({ label: 'Fenul', entryId: '1' }, entry), 'Bold · OTF')
  assert.equal(
    activityItemLabel(
      { label: 'Fenul', entryId: '1' },
      {
        ...entry,
        sourcePath: '/uploads/1788535075094-Fenul-Bold.otf',
      },
    ),
    'Bold · OTF',
  )
  assert.equal(
    activityItemLabel({ label: 'subdir/Fenul-Bold.otf', entryId: '1' }, entry),
    'subdir/Fenul-Bold.otf',
  )
  assert.equal(activityItemLabel({ label: 'Fenul' }), 'Fenul')
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
      markVisibleBackground: false,
    }),
    [],
  )
})

test('idle visible manual operations stay read after busy clears', () => {
  assert.deepEqual(
    unreadOperationIdsToMark({
      previous: [],
      next: [
        op('install-1', { trigger: 'manual', action: 'install' }),
        op('activate-1', { trigger: 'manual', action: 'activate' }),
        op('import-1', { trigger: 'import', action: 'apply-plan' }),
      ],
      foregroundBusy: false,
      windowHidden: false,
      markVisibleBackground: false,
    }),
    [],
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
      markVisibleBackground: false,
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

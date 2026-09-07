import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  activityRowLabel,
  buildTrayMenuModel,
  menuBarUpdateBadge,
  outdatedFamilies,
  TRAY_SECTION_LIMIT,
  unreadOperationIdsToMark,
} from './updates-menu.mjs'

function entry(id, familyName, status, customFamilyName) {
  return {
    id,
    status,
    customFamilyName,
    faces: [{ familyName, styleName: 'Regular' }],
  }
}

function operation(id, action, familyName, unread = false) {
  return { id, action, familyName, unread, trigger: 'manual', outcome: 'succeeded' }
}

test('outdatedFamilies lists update-tab families in A–Z order', () => {
  const families = outdatedFamilies([
    entry('zeta', 'Zeta', 'outdated'),
    entry('alpha-1', 'Alpha', 'outdated'),
    entry('keep', 'Keep', 'installed'),
    entry('alpha-2', 'Alpha', 'outdated'),
  ])
  assert.deepEqual(families, [
    { name: 'Alpha', ids: ['alpha-1', 'alpha-2'] },
    { name: 'Zeta', ids: ['zeta'] },
  ])
})

test('outdatedFamilies uses a custom family name when present', () => {
  const families = outdatedFamilies([
    entry('renamed', 'Source Sans', 'outdated', 'Display'),
  ])
  assert.deepEqual(families, [{ name: 'Display', ids: ['renamed'] }])
})

test('menuBarUpdateBadge is a dot when unread or updates exist, never a count', () => {
  assert.equal(menuBarUpdateBadge(0), '')
  assert.equal(menuBarUpdateBadge(1), '•')
  assert.equal(menuBarUpdateBadge(12), '•')
  assert.equal(menuBarUpdateBadge(100), '•')
  assert.equal(menuBarUpdateBadge({ hasUnread: false, hasUpdates: false }), '')
  assert.equal(menuBarUpdateBadge({ hasUnread: true, hasUpdates: false }), '•')
  assert.equal(menuBarUpdateBadge({ hasUnread: false, hasUpdates: true }), '•')
})

test('buildTrayMenuModel orders Activity then Updates with headlines and a 5-row cap', () => {
  const operations = Array.from({ length: 7 }, (_, index) =>
    operation(`op-${index}`, 'install', `Family ${index}`, index === 0),
  )
  const families = Array.from({ length: 7 }, (_, index) => ({
    name: `Update ${index}`,
    ids: [`id-${index}`],
  }))
  const model = buildTrayMenuModel({ operations, families })
  assert.equal(model.activityHeadline, 'Activity')
  assert.equal(model.updatesHeadline, 'Updates')
  assert.equal(model.activityRows.length, TRAY_SECTION_LIMIT)
  assert.equal(model.updateRows.length, TRAY_SECTION_LIMIT)
  assert.equal(model.activityShowAll, true)
  assert.equal(model.updatesShowAll, true)
  assert.equal(model.markAllAsRead, true)
  assert.equal(model.activityRows[0]?.label, 'Install · Family 0')
  assert.equal(model.reinstallAll, true)
  assert.equal(model.hasUnread, true)
  assert.equal(model.hasUpdates, true)
})

test('buildTrayMenuModel hides Mark all as read and Show all when they are not needed', () => {
  const model = buildTrayMenuModel({
    operations: [operation('op-1', 'activate', 'Inter', false)],
    families: [{ name: 'Inter', ids: ['inter'] }],
  })
  assert.equal(model.markAllAsRead, false)
  assert.equal(model.activityShowAll, false)
  assert.equal(model.updatesShowAll, false)
  assert.equal(model.activityEmpty, false)
  assert.equal(model.updatesEmpty, false)
})

test('activityRowLabel maps apply-plan to Import', () => {
  assert.equal(activityRowLabel({ action: 'apply-plan', familyName: 'News' }), 'Import · News')
})

test('unreadOperationIdsToMark badges hidden-window ops and skips visible foreground', () => {
  assert.deepEqual(
    unreadOperationIdsToMark({
      previous: [],
      next: [{ id: 'a', outcome: 'succeeded', trigger: 'manual' }],
      windowHidden: true,
    }),
    ['a'],
  )
  assert.deepEqual(
    unreadOperationIdsToMark({
      previous: [],
      next: [{ id: 'b', outcome: 'succeeded', trigger: 'manual' }],
      windowHidden: false,
    }),
    [],
  )
})

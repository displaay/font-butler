import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  activityRowLabel,
  buildTrayMenuModel,
  menuBarNeedsAttention,
  menuBarTrayIconPath,
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

test('menuBarUpdateBadge stays empty because attention lives on the template icon', () => {
  assert.equal(menuBarUpdateBadge(0), '')
  assert.equal(menuBarUpdateBadge(1), '')
  assert.equal(menuBarUpdateBadge(12), '')
  assert.equal(menuBarUpdateBadge({ hasUnread: false, hasUpdates: false }), '')
  assert.equal(menuBarUpdateBadge({ hasUnread: true, hasUpdates: false }), '')
  assert.equal(menuBarUpdateBadge({ hasUnread: false, hasUpdates: true }), '')
})

test('menuBarNeedsAttention is true for unread activity or outdated updates', () => {
  assert.equal(menuBarNeedsAttention(0), false)
  assert.equal(menuBarNeedsAttention(1), true)
  assert.equal(menuBarNeedsAttention({ hasUnread: false, hasUpdates: false }), false)
  assert.equal(menuBarNeedsAttention({ hasUnread: true, hasUpdates: false }), true)
  assert.equal(menuBarNeedsAttention({ hasUnread: false, hasUpdates: true }), true)
})

test('menuBarTrayIconPath uses the notification SVG only when attention is needed', () => {
  const paths = { quiet: 'quiet.png', attention: 'menubarNotificationTemplate.svg' }
  assert.equal(menuBarTrayIconPath({ hasUnread: false, hasUpdates: false }, paths), paths.quiet)
  assert.equal(menuBarTrayIconPath({ hasUnread: true, hasUpdates: false }, paths), paths.attention)
  assert.equal(menuBarTrayIconPath({ hasUnread: false, hasUpdates: true }, paths), paths.attention)
  assert.equal(menuBarTrayIconPath({ hasUnread: true, hasUpdates: true }, paths), paths.attention)
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

test('attention tray SVG is a black 60×59 template asset', () => {
  const svgPath = fileURLToPath(new URL('../build/menubarNotificationTemplate.svg', import.meta.url))
  const svg = readFileSync(svgPath, 'utf8')
  assert.match(svg, /viewBox="0 0 60 59"/)
  assert.match(svg, /fill="#000"/)
  assert.equal((svg.match(/#[0-9a-fA-F]{3,8}/g) ?? []).every((color) => color === '#000'), true)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.build.files.includes('build/menubarNotificationTemplate.svg'))
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(main, /nativeImage\.createFromPath\(iconPath\)/)
  assert.match(main, /image\.setTemplateImage\(true\)/)
  assert.match(main, /menubarNotificationTemplate\.svg/)
  assert.match(main, /tray\.setImage\(icon\)/)
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

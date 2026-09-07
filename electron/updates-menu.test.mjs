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

test('attention tray SVG is Daniel’s black 60×59 template', () => {
  const svgPath = fileURLToPath(new URL('../build/menubarNotificationTemplate.svg', import.meta.url))
  const svg = readFileSync(svgPath, 'utf8')
  assert.match(svg, /viewBox="0 0 60 59"/)
  assert.match(svg, /clip0_387_16/)
  assert.match(
    svg,
    /d="M7\.70383e-07 10L-2\.86102e-06 49C11\.1294 48\.4242 20 39\.8855 20 29\.4457C20 19\.0059 11\.1294 10\.5758 7\.70383e-07 10Z"/,
  )
  assert.match(
    svg,
    /d="M31\.1504 34\.5088C28\.8484 42\.525 21\.2174 48\.5207 12\.0332 49V47\.5625C17\.8487 44\.4291 22\.0225 38\.931 23\.0322 32\.4795L31\.1504 34\.5088ZM31\.6582 26\.7168C31\.7923 27\.6078 31\.8633 28\.5185 31\.8633 29\.4453C31\.8633 30\.5052 31\.7711 31\.5452 31\.5967 32\.5596L23\.2393 30\.4697C23\.257 30\.1293 23\.2705 29\.7869 23\.2705 29\.4424C23\.2705 29\.2333 23\.2644 29\.025 23\.2578 28\.8174L31\.6582 26\.7168ZM12\.0332 10C21\.3573 10\.4866 29\.0817 16\.5809 31\.2529 24\.7568L23\.0889 26\.7998C22\.1902 20\.1889 17\.9667 14\.5767 12\.0332 11\.4102V10Z"/,
  )
  assert.match(
    svg,
    /d="M48\.1768 19C50\.4335 19 52\.3729 20\.3671 53\.209 22\.3223L53\.4365 22\.8545L54\.0107 22\.9229C56\.722 23\.2468 58\.8242 25\.555 58\.8242 28\.3535C58\.824 31\.0311 56\.8986 33\.2592 54\.3555 33\.7295L53\.6787 33\.8545L53\.5537 34\.5312C53\.0834 37\.0744 50\.8546 39 48\.1768 39C46\.5436 38\.9999 45\.0795 38\.2836 44\.0752 37\.1455L43\.4912 36\.4844L42\.7617 36\.9814C42\.1757 37\.3813 41\.4843 37\.6359 40\.7363 37\.6934L40\.4121 37\.7061C38\.3815 37\.7061 36\.6878 36\.2553 36\.3135 34\.333L36\.1924 33\.709L21\.999 30\.1602V29\.1328L36\.2949 25\.5586L36\.2441 24\.7295L36\.2354 24\.4707C36\.2354 22\.1641 38\.1055 20\.2939 40\.4121 20\.2939L40\.7363 20\.3066C41\.4847 20\.364 42\.1761 20\.6181 42\.7617 21\.0176L43\.4912 21\.5146L44\.0752 20\.8535C45\.0793 19\.7159 46\.5436 19\.0001 48\.1768 19Z"/,
  )
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

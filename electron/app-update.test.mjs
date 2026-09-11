import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { appUpdateRowLabel, isAllowedAppUpdateUrl, trayTooltip } from './app-update.mjs'

test('isAllowedAppUpdateUrl only allows this GitHub repo', () => {
  assert.equal(isAllowedAppUpdateUrl('https://github.com/displaay/font-butler'), true)
  assert.equal(
    isAllowedAppUpdateUrl('https://github.com/displaay/font-butler/releases/tag/v0.2.0'),
    true,
  )
  assert.equal(isAllowedAppUpdateUrl('https://github.com/displaay/other'), false)
  assert.equal(isAllowedAppUpdateUrl('http://github.com/displaay/font-butler'), false)
  assert.equal(isAllowedAppUpdateUrl('not-a-url'), false)
})

test('trayTooltip keeps existing copy and names an app release', () => {
  assert.equal(trayTooltip({}), 'Font Buttler')
  assert.equal(trayTooltip({ hasUnread: true }), 'Font Buttler — unread activity')
  assert.equal(
    trayTooltip({ hasUnread: true, hasUpdates: true, fontUpdateCount: 2 }),
    'Font Buttler — unread activity and updates',
  )
  assert.equal(trayTooltip({ hasUpdates: true, fontUpdateCount: 3 }), 'Font Buttler — 3 updates')
  assert.equal(
    trayTooltip({ hasAppUpdate: true }),
    'Font Buttler — app update available',
  )
  assert.equal(appUpdateRowLabel({ updateAvailable: true, latestVersion: '0.2.0' }), 'Font Buttler 0.2.0')
})

test('main process never auto-downloads or auto-installs GitHub assets', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(main, /electron-updater/)
  assert.doesNotMatch(main, /autoDownload/)
  assert.doesNotMatch(main, /autoInstallOnAppQuit/)
  assert.match(main, /Check for Updates/)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.build.files.includes('electron/**/*'))
  assert.equal(pkg.build.publish.provider, 'github')
  assert.equal(pkg.build.publish.owner, 'displaay')
  assert.equal(pkg.build.publish.repo, 'font-butler')
  assert.match(pkg.build.artifactName, /Font-Buttler/)
})

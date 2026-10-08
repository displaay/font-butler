import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appUpdateBadgeLabel,
  appUpdateBadgeText,
  appUpdateClickIgnored,
  appUpdateInstallFromMain,
  appUpdateDownloadUrl,
  appUpdateReleaseUrl,
  appUpdateRowLabel,
  isAllowedAppUpdateUrl,
  shouldShowUpdatesTab,
} from './app-update.ts'
import type { AppUpdateStatus } from './types'

function status(partial: Partial<AppUpdateStatus> = {}): AppUpdateStatus {
  return {
    currentVersion: '0.1.1',
    latestVersion: '0.2.0',
    updateAvailable: true,
    releaseName: '0.2.0',
    releaseNotes: 'Notes',
    htmlUrl: 'https://github.com/displaay/font-butler/releases/tag/v0.2.0',
    publishedAt: '2026-09-08T00:00:00Z',
    assets: [],
    preferredAsset: {
      name: 'Font-Buttler-0.2.0-arm64.dmg',
      url: 'https://github.com/displaay/font-butler/releases/download/v0.2.0/Font-Buttler-0.2.0-arm64.dmg',
    },
    autoInstall: 'parked',
    checkedAt: 1,
    ...partial,
  }
}

test('appUpdateRowLabel names the GitHub release version', () => {
  assert.equal(appUpdateRowLabel(status()), 'Font Buttler 0.2.0')
  assert.equal(appUpdateRowLabel(status({ updateAvailable: false })), '')
})

test('appUpdateDownloadUrl is the asset only; Open release uses the GitHub page', () => {
  assert.match(appUpdateDownloadUrl(status()) ?? '', /arm64\.dmg$/)
  assert.equal(appUpdateDownloadUrl(status({ preferredAsset: null })), null)
  assert.equal(
    appUpdateReleaseUrl(status({ preferredAsset: null })),
    'https://github.com/displaay/font-butler/releases/tag/v0.2.0',
  )
})

test('shouldShowUpdatesTab stays closed for an app release with no font updates', () => {
  assert.equal(shouldShowUpdatesTab(0), false)
  assert.equal(shouldShowUpdatesTab(1), true)
  assert.equal(shouldShowUpdatesTab(0, 1), true)
})

test('the Updates tab does not render or count an application update', async () => {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const app = await readFile(fileURLToPath(new URL('../../src/App.tsx', import.meta.url)), 'utf8')
  assert.equal(/<AppUpdateCard/.test(app), false)
  assert.equal(/tab === 'updates' && appUpdate/.test(app), false)
  const leaveUpdates = app.match(/tab === 'updates' && allUpdates\.length === 0[\s\S]*?setTab\('library'\)/)
  assert.ok(leaveUpdates, 'expected the Updates tab to close when no font updates remain')
  assert.equal(/appUpdate/.test(leaveUpdates[0]), false)

  const sidebar = await readFile(fileURLToPath(new URL('../components/Sidebar.tsx', import.meta.url)), 'utf8')
  const updatesItem = sidebar.match(/item\.id === 'updates'[\s\S]*?hoverAction=/)
  assert.ok(updatesItem, 'expected the Updates sidebar item')
  assert.equal(/hasAppUpdate/.test(updatesItem[0]), false)
  assert.match(sidebar, /shouldShowUpdatesTab\(counts\.updates, retailPending\)/)
})

test('isAllowedAppUpdateUrl rejects other hosts', () => {
  assert.equal(isAllowedAppUpdateUrl('https://github.com/displaay/font-butler/releases'), true)
  assert.equal(isAllowedAppUpdateUrl('https://example.com'), false)
})

test('cold start does not await appUpdate in the boot Promise.all', async () => {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const source = await readFile(fileURLToPath(new URL('../../src/App.tsx', import.meta.url)), 'utf8')
  const bootAll = source.match(
    /const \[catalog, settingsResult, projectResult, activityResult, duplicatesResult, retailResult\] =\s*await Promise\.all\(\[([\s\S]*?)\]\)/,
  )
  assert.ok(bootAll, 'expected cold-start Promise.all')
  assert.equal(/api\.appUpdate\(/.test(bootAll[1]), false)
  assert.match(source, /setLoading\(false\)[\s\S]*void loadAppUpdate\(\)/)
})

test('settings button shows a blue Update badge when an app release is available', async () => {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const source = await readFile(fileURLToPath(new URL('../components/Sidebar.tsx', import.meta.url)), 'utf8')
  const openAt = source.lastIndexOf('onClick={onOpenSettings}')
  const buttonAt = source.lastIndexOf('<Button', openAt)
  const buttonEnd = source.indexOf('</Button>', openAt)
  assert.ok(openAt !== -1 && buttonAt !== -1 && buttonEnd !== -1, 'expected Settings button in the sidebar')
  const settingsButton = source.slice(buttonAt, buttonEnd + '</Button>'.length)
  assert.doesNotMatch(settingsButton, /<button/)
  assert.match(settingsButton, /hasAppUpdate \?/)
  assert.match(source.slice(source.lastIndexOf('<div className="', buttonAt), buttonAt), /group\/settings relative/)
  assert.match(settingsButton, /group-hover\/settings:bg-black\/\[0\.05\]/)
  assert.match(settingsButton, /dark:group-hover\/settings:bg-white\/\[0\.08\]/)
  const badge = source.slice(buttonEnd, source.indexOf('</aside>', buttonEnd))
  assert.match(badge, /<button/)
  assert.match(badge, /bg-blue-50 text-blue-700/)
  assert.match(badge, /cursor-pointer/)
  assert.match(badge, /focus-visible:ring-2/)
  assert.match(badge, /appUpdateBadgeLabel/)
  assert.match(badge, /appUpdateClickIgnored/)
  assert.match(badge, /onInstallAppUpdate/)
  const badgeButton = badge.slice(0, badge.indexOf('</button>') + '</button>'.length)
  assert.doesNotMatch(badgeButton, /onOpenSettings/)
  assert.doesNotMatch(badgeButton, /group-hover/)
})

test('the Update badge names the version and ignores clicks while busy', () => {
  assert.equal(appUpdateBadgeText(), 'Update')
  assert.equal(appUpdateBadgeText('downloading', 40), '40%')
  assert.equal(appUpdateBadgeText('verifying'), '…')
  assert.equal(appUpdateBadgeText('error'), 'Error')
  assert.equal(appUpdateBadgeLabel('0.4.0'), 'Update to Font Buttler 0.4.0')
  assert.equal(appUpdateBadgeLabel('0.4.0', 'downloading'), 'Updating to Font Buttler 0.4.0')
  assert.equal(appUpdateClickIgnored('downloading'), true)
  assert.equal(appUpdateClickIgnored('idle'), false)
  assert.equal(appUpdateClickIgnored('error'), false)
})

test('an ignored install adopts the main-process phase, or idle when that phase is missing', () => {
  assert.deepEqual(appUpdateInstallFromMain({ phase: 'opening' }), { phase: 'opening' })
  assert.deepEqual(appUpdateInstallFromMain({ phase: 'downloading', percent: 40 }), {
    phase: 'downloading',
    percent: 40,
  })
  assert.deepEqual(appUpdateInstallFromMain({ phase: 'error', error: 'disk' }), {
    phase: 'error',
    error: 'disk',
  })
  assert.deepEqual(appUpdateInstallFromMain({}), { phase: 'idle' })
  assert.deepEqual(appUpdateInstallFromMain({ phase: 'later' }), { phase: 'idle' })
  assert.deepEqual(appUpdateInstallFromMain(null), { phase: 'idle' })
})

test('a new window reads the installer phase and an ignored result replaces downloading', async () => {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const source = await readFile(fileURLToPath(new URL('../../src/App.tsx', import.meta.url)), 'utf8')
  const ignored = source.match(/if \(result\?\.ignored\) \{[\s\S]*?return/)
  assert.ok(ignored, 'expected an ignored install result to update renderer state')
  assert.match(ignored[0], /appUpdateInstallFromMain\(result\)/)
  assert.match(ignored[0], /setAppUpdateInstall\(next\)/)
  assert.match(source, /getAppUpdateInstallState\?\.\(\)/)
  assert.match(source, /appUpdateInstallEpoch\.current !== epoch/)
  assert.match(source, /appUpdateInstallPhase\.current !== 'idle'/)
})

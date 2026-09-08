import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
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

test('shouldShowUpdatesTab keeps the Updates tab for an app release', () => {
  assert.equal(shouldShowUpdatesTab(0, true), true)
  assert.equal(shouldShowUpdatesTab(0, false), false)
})

test('isAllowedAppUpdateUrl rejects other hosts', () => {
  assert.equal(isAllowedAppUpdateUrl('https://github.com/displaay/font-butler/releases'), true)
  assert.equal(isAllowedAppUpdateUrl('https://example.com'), false)
})

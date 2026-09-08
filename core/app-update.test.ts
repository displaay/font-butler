import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  APP_UPDATE_AUTO_INSTALL,
  APP_UPDATE_GITHUB_LATEST_API,
  APP_UPDATE_GITHUB_TOKEN_ENV,
  APP_UPDATE_GITHUB_TOKEN_FALLBACK_ENV,
  PARKED_AUTO_INSTALL_MESSAGE,
  appUpdateRowLabel,
  compareVersions,
  createAppUpdateChecker,
  isAllowedAppUpdateUrl,
  isNewerVersion,
  normalizeVersion,
  parseGithubRelease,
  parkedAutoInstallState,
  preferredReleaseAsset,
  shouldShowUpdatesTab,
  readAppVersion,
  resolveGithubReleasesToken,
  startParkedAutoInstall,
  withTimeout,
  type AppUpdateFetch,
  type GithubReleaseJson,
} from './app-update.ts'

function release(partial: GithubReleaseJson = {}): GithubReleaseJson {
  return {
    tag_name: 'v0.2.0',
    name: 'Font Buttler 0.2.0',
    body: '## Changes\n- Check GitHub Releases',
    html_url: 'https://github.com/displaay/font-butler/releases/tag/v0.2.0',
    published_at: '2026-09-08T12:00:00Z',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'Font-Buttler-0.2.0-arm64.dmg',
        browser_download_url:
          'https://github.com/displaay/font-butler/releases/download/v0.2.0/Font-Buttler-0.2.0-arm64.dmg',
        content_type: 'application/x-apple-diskimage',
        size: 42,
      },
      {
        name: 'Font-Buttler-0.2.0-x64.dmg',
        browser_download_url:
          'https://github.com/displaay/font-butler/releases/download/v0.2.0/Font-Buttler-0.2.0-x64.dmg',
        size: 40,
      },
    ],
    ...partial,
  }
}

function jsonFetch(status: number, body: unknown): AppUpdateFetch {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  })
}

test('normalizeVersion strips a leading v', () => {
  assert.equal(normalizeVersion('v0.2.0'), '0.2.0')
  assert.equal(normalizeVersion('0.1.1'), '0.1.1')
  assert.equal(normalizeVersion('  V1.0.0 '), '1.0.0')
})

test('compareVersions orders numeric cores and treats pre-release as older', () => {
  assert.equal(compareVersions('0.1.1', 'v0.1.1'), 0)
  assert.equal(compareVersions('0.1.0', '0.1.1'), -1)
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1)
  assert.equal(compareVersions('0.2.0-beta.1', '0.2.0'), -1)
  assert.equal(compareVersions('0.2.0', '0.2.0-beta.1'), 1)
  assert.equal(isNewerVersion('0.2.0', '0.1.1'), true)
  assert.equal(isNewerVersion('0.1.1', '0.1.1'), false)
  assert.equal(isNewerVersion('0.1.0', '0.1.1'), false)
})

test('parseGithubRelease flags a newer public release and parks auto-install', () => {
  const status = parseGithubRelease(release(), '0.1.1', {
    now: 100,
    platform: { platform: 'darwin', arch: 'arm64' },
  })
  assert.equal(status.updateAvailable, true)
  assert.equal(status.latestVersion, '0.2.0')
  assert.equal(status.currentVersion, '0.1.1')
  assert.equal(status.autoInstall, APP_UPDATE_AUTO_INSTALL)
  assert.equal(status.releaseName, 'Font Buttler 0.2.0')
  assert.match(status.releaseNotes ?? '', /Check GitHub Releases/)
  assert.equal(status.htmlUrl, 'https://github.com/displaay/font-butler/releases/tag/v0.2.0')
  assert.equal(status.preferredAsset?.name, 'Font-Buttler-0.2.0-arm64.dmg')
  assert.equal(appUpdateRowLabel(status), 'Font Buttler 0.2.0')
})

test('parseGithubRelease does not treat the current version as an update', () => {
  const status = parseGithubRelease(release({ tag_name: 'v0.1.1', name: '0.1.1' }), '0.1.1')
  assert.equal(status.updateAvailable, false)
  assert.equal(appUpdateRowLabel(status), '')
})

test('parseGithubRelease ignores drafts, prereleases, and non-GitHub URLs', () => {
  assert.equal(parseGithubRelease(release({ draft: true }), '0.1.1').updateAvailable, false)
  assert.equal(parseGithubRelease(release({ prerelease: true }), '0.1.1').updateAvailable, false)
  const status = parseGithubRelease(
    release({
      html_url: 'https://evil.example/download',
      assets: [
        {
          name: 'Font-Buttler-0.2.0-arm64.dmg',
          browser_download_url: 'https://evil.example/Font-Buttler-0.2.0-arm64.dmg',
        },
      ],
    }),
    '0.1.1',
  )
  assert.equal(status.htmlUrl, 'https://github.com/displaay/font-butler/releases')
  assert.equal(status.assets.length, 0)
  assert.equal(status.preferredAsset, null)
})

test('preferredReleaseAsset prefers a matching dmg for the running arch', () => {
  const assets = parseGithubRelease(release(), '0.1.1').assets
  assert.equal(
    preferredReleaseAsset(assets, { platform: 'darwin', arch: 'x64' })?.name,
    'Font-Buttler-0.2.0-x64.dmg',
  )
})

test('isAllowedAppUpdateUrl only allows this repo on github.com', () => {
  assert.equal(isAllowedAppUpdateUrl('https://github.com/displaay/font-butler'), true)
  assert.equal(
    isAllowedAppUpdateUrl('https://github.com/displaay/font-butler/releases/tag/v0.2.0'),
    true,
  )
  assert.equal(
    isAllowedAppUpdateUrl(
      'https://github.com/displaay/font-butler/releases/download/v0.2.0/Font-Buttler-0.2.0-arm64.dmg',
    ),
    true,
  )
  assert.equal(isAllowedAppUpdateUrl('https://github.com/displaay/other'), false)
  assert.equal(isAllowedAppUpdateUrl('http://github.com/displaay/font-butler'), false)
  assert.equal(isAllowedAppUpdateUrl('https://evil.example/displaay/font-butler'), false)
})

test('checkAppUpdate uses the latest Releases API and caches the result', async () => {
  let calls = 0
  const fetchImpl: AppUpdateFetch = async (url) => {
    calls += 1
    assert.equal(url, APP_UPDATE_GITHUB_LATEST_API)
    return jsonFetch(200, release())(url)
  }
  const checker = createAppUpdateChecker({ cacheMs: 60_000 })
  const first = await checker.check({
    currentVersion: '0.1.1',
    fetch: fetchImpl,
    now: 1_000,
  })
  const second = await checker.check({
    currentVersion: '0.1.1',
    fetch: fetchImpl,
    now: 2_000,
  })
  assert.equal(first.updateAvailable, true)
  assert.equal(second.latestVersion, '0.2.0')
  assert.equal(calls, 1)
  await checker.check({
    currentVersion: '0.1.1',
    fetch: fetchImpl,
    now: 2_000,
    refresh: true,
  })
  assert.equal(calls, 2)
})

test('checkAppUpdate treats a 404 latest release as up to date', async () => {
  const checker = createAppUpdateChecker()
  const status = await checker.check({
    currentVersion: '0.1.1',
    fetch: jsonFetch(404, { message: 'Not Found' }),
    now: 10,
  })
  assert.equal(status.updateAvailable, false)
  assert.equal(status.latestVersion, null)
  assert.equal(status.error, undefined)
})

test('offline and GitHub API failures stay a quiet no-update and do not throw', async () => {
  const checker = createAppUpdateChecker()
  const http = await checker.check({
    currentVersion: '0.1.1',
    fetch: jsonFetch(500, { message: 'nope' }),
    now: 11,
  })
  assert.equal(http.updateAvailable, false)
  assert.equal(http.error, undefined)
  assert.equal(http.latestVersion, null)
  const network = await checker.check({
    currentVersion: '0.1.1',
    fetch: async () => {
      throw new Error('offline')
    },
    now: 12,
    refresh: true,
  })
  assert.equal(network.updateAvailable, false)
  assert.equal(network.error, undefined)
})

test('a failed refresh keeps the last good GitHub release', async () => {
  let calls = 0
  const checker = createAppUpdateChecker({ cacheMs: 1 })
  const fetchImpl: AppUpdateFetch = async () => {
    calls += 1
    if (calls === 1) return jsonFetch(200, release())('')
    throw new Error('offline')
  }
  const first = await checker.check({
    currentVersion: '0.1.1',
    fetch: fetchImpl,
    now: 1_000,
  })
  assert.equal(first.updateAvailable, true)
  const kept = await checker.check({
    currentVersion: '0.1.1',
    fetch: fetchImpl,
    now: 2_000,
    refresh: true,
  })
  assert.equal(kept.updateAvailable, true)
  assert.equal(kept.latestVersion, '0.2.0')
  assert.equal(kept.error, undefined)
})

test('withTimeout rejects a hung promise instead of waiting forever', async () => {
  const started = Date.now()
  await assert.rejects(() => withTimeout(new Promise(() => {}), 20), /timed out/)
  assert.ok(Date.now() - started < 500)
})

test('startParkedAutoInstall refuses to download or install', () => {
  assert.throws(() => startParkedAutoInstall(), { message: PARKED_AUTO_INSTALL_MESSAGE })
  assert.match(parkedAutoInstallState().reason, /electron-updater/)
  assert.equal(parkedAutoInstallState().autoInstall, 'parked')
})

test('shouldShowUpdatesTab appears for font updates or an app release', () => {
  assert.equal(shouldShowUpdatesTab(0, false), false)
  assert.equal(shouldShowUpdatesTab(1, false), true)
  assert.equal(shouldShowUpdatesTab(0, true), true)
})

test('readAppVersion matches package.json', () => {
  assert.match(readAppVersion(), /^\d+\.\d+\.\d+/)
})

test('resolveGithubReleasesToken prefers FONT_BUTLER_GITHUB_TOKEN for a private repo', () => {
  assert.equal(resolveGithubReleasesToken(' explicit '), 'explicit')
  assert.equal(
    resolveGithubReleasesToken(undefined, {
      [APP_UPDATE_GITHUB_TOKEN_ENV]: 'read-only',
      [APP_UPDATE_GITHUB_TOKEN_FALLBACK_ENV]: 'ci-token',
    }),
    'read-only',
  )
  assert.equal(
    resolveGithubReleasesToken(undefined, { [APP_UPDATE_GITHUB_TOKEN_FALLBACK_ENV]: 'ci-token' }),
    'ci-token',
  )
  assert.equal(resolveGithubReleasesToken(undefined, {}), '')
})

test('a hung GitHub fetch times out as a quiet no-update', async () => {
  const checker = createAppUpdateChecker({ timeoutMs: 25 })
  const started = Date.now()
  const status = await checker.check({
    currentVersion: '0.1.1',
    fetch: () => new Promise(() => {}),
    now: 14,
  })
  assert.ok(Date.now() - started < 500, `hung fetch took ${Date.now() - started}ms; expected a hard timeout`)
  assert.equal(status.updateAvailable, false)
  assert.equal(status.error, undefined)
})

test('a hung GitHub response body times out as a quiet no-update', async () => {
  const checker = createAppUpdateChecker({ timeoutMs: 25 })
  const started = Date.now()
  const status = await checker.check({
    currentVersion: '0.1.1',
    fetch: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => new Promise(() => {}),
    }),
    now: 15,
  })
  assert.ok(Date.now() - started < 500, `hung body took ${Date.now() - started}ms; expected a hard timeout`)
  assert.equal(status.updateAvailable, false)
  assert.equal(status.error, undefined)
})

test('checkAppUpdate sends the read-only token only on the GitHub Releases request', async () => {
  const checker = createAppUpdateChecker()
  let authorization = ''
  const status = await checker.check({
    currentVersion: '0.1.1',
    githubToken: 'read-only-token',
    fetch: async (_url, init) => {
      authorization = init?.headers?.Authorization ?? ''
      return jsonFetch(404, { message: 'Not Found' })(_url)
    },
    now: 13,
  })
  assert.equal(authorization, 'Bearer read-only-token')
  assert.equal(status.updateAvailable, false)
  assert.equal(status.error, undefined)
})

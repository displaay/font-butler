import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitEvent } from './events.ts'
import {
  APP_UPDATE_FEED_ENV,
  detectAppUpdateRuntime,
  loadUpdateFeed,
  macArm64ArchiveName,
  resolveUpdateFeedUrl,
  type AppUpdateRuntimeFacts,
} from '../electron/app-update-install.mjs'
import {
  APP_UPDATE_AUTO_INSTALL,
  APP_UPDATE_CACHE_MS,
  APP_UPDATE_FETCH_TIMEOUT_MS,
  APP_UPDATE_GITHUB_LATEST_API,
  APP_UPDATE_GITHUB_RELEASES_URL,
  APP_UPDATE_GITHUB_TOKEN_ENV,
  APP_UPDATE_GITHUB_TOKEN_FALLBACK_ENV,
  emptyAppUpdateStatus,
  isNewerVersion,
  normalizeVersion,
  parseGithubRelease,
  withTimeout,
  type AppUpdateStatus,
  type GithubReleaseJson,
} from '../shared/app-update.ts'

export {
  APP_UPDATE_AUTO_INSTALL,
  APP_UPDATE_CACHE_MS,
  APP_UPDATE_FETCH_TIMEOUT_MS,
  APP_UPDATE_GITHUB_LATEST_API,
  APP_UPDATE_GITHUB_OWNER,
  APP_UPDATE_GITHUB_RELEASES_URL,
  APP_UPDATE_GITHUB_REPO,
  APP_UPDATE_GITHUB_TOKEN_ENV,
  APP_UPDATE_GITHUB_TOKEN_FALLBACK_ENV,
  PARKED_AUTO_INSTALL_MESSAGE,
  PARKED_AUTO_INSTALL_NOTICE,
  appUpdateRowLabel,
  compareVersions,
  isAllowedAppUpdateUrl,
  isNewerVersion,
  normalizeVersion,
  parseGithubRelease,
  preferredReleaseAsset,
  shouldShowUpdatesTab,
  startParkedAutoInstall,
  withTimeout,
} from '../shared/app-update.ts'
export type { AppUpdateAsset, AppUpdateStatus, GithubReleaseJson } from '../shared/app-update.ts'

export type AppUpdateFetch = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  text?: () => Promise<string>
}>

export type CheckAppUpdateOptions = {
  currentVersion?: string
  fetch?: AppUpdateFetch
  now?: number
  refresh?: boolean
  githubToken?: string
  skipNetworkInTest?: boolean
  timeoutMs?: number
  /** Test seam. Production reads `process.env` and probes the running app. */
  env?: NodeJS.ProcessEnv
  runtime?: AppUpdateRuntimeFacts
}

type CacheEntry = { at: number; status: AppUpdateStatus }

export function readAppVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, '../package.json'),
    path.resolve(process.cwd(), 'package.json'),
  ]
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string }
      if (pkg.version && typeof pkg.version === 'string') return pkg.version
    } catch {
      // Try the next location.
    }
  }
  return process.env.npm_package_version || '0.0.0'
}

/**
 * Public repo / public releases: no token.
 * Private repo: unauthenticated /releases/latest 404s (looks up to date). Set a
 * read-only FONT_BUTLER_GITHUB_TOKEN (GITHUB_TOKEN as fallback) until Releases are public.
 */
export function resolveGithubReleasesToken(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    explicit ||
    env[APP_UPDATE_GITHUB_TOKEN_ENV] ||
    env[APP_UPDATE_GITHUB_TOKEN_FALLBACK_ENV] ||
    ''
  ).trim()
}

function requestHeaders(version: string, token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': `Font-Butler/${version}`,
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function quietFailure(
  cached: CacheEntry | null,
  currentVersion: string,
  now: number,
  reason: string,
): AppUpdateStatus {
  console.warn(`Font Butler update check skipped (${reason})`)
  if (cached?.status) {
    return cached.status
  }
  return emptyAppUpdateStatus(currentVersion, { checkedAt: now })
}

export function createAppUpdateChecker(options: { cacheMs?: number; timeoutMs?: number } = {}) {
  const cacheMs = options.cacheMs ?? APP_UPDATE_CACHE_MS
  const timeoutMs = options.timeoutMs ?? APP_UPDATE_FETCH_TIMEOUT_MS
  let cached: CacheEntry | null = null

  async function check(input: CheckAppUpdateOptions = {}): Promise<AppUpdateStatus> {
    const currentVersion = input.currentVersion || readAppVersion()
    const now = input.now ?? Date.now()
    if (!input.refresh && cached && now - cached.at < cacheMs) {
      return cached.status
    }
    const skipNetwork =
      input.skipNetworkInTest ?? (process.env.FONT_BUTLER_TEST === '1' && !input.fetch)
    if (skipNetwork) {
      const status = emptyAppUpdateStatus(currentVersion, { checkedAt: now })
      cached = { at: now, status }
      return status
    }
    const fetchImpl: AppUpdateFetch = input.fetch ?? (globalThis.fetch as AppUpdateFetch)
    const feedUrl = resolveFeedForCheck(input)
    if (feedUrl) {
      try {
        const pieces = await withTimeout(
          loadUpdateFeed(feedUrl, fetchImpl),
          input.timeoutMs ?? timeoutMs,
        )
        const status = statusFromLocalFeed(pieces, currentVersion, now)
        cached = { at: now, status }
        emitEvent({ type: 'app-update', update: status })
        return status
      } catch (error) {
        return quietFailure(
          cached,
          currentVersion,
          now,
          error instanceof Error ? error.message : 'Could not read the local update feed',
        )
      }
    }
    const controller = new AbortController()
    try {
      const github = await withTimeout(
        (async () => {
          const response = await fetchImpl(APP_UPDATE_GITHUB_LATEST_API, {
            headers: requestHeaders(currentVersion, resolveGithubReleasesToken(input.githubToken)),
            signal: controller.signal,
          })
          if (response.status === 404 || !response.ok) {
            return { response, json: null as GithubReleaseJson | null }
          }
          return { response, json: (await response.json()) as GithubReleaseJson }
        })(),
        input.timeoutMs ?? timeoutMs,
      )
      const { response, json } = github
      if (response.status === 404) {
        const status = emptyAppUpdateStatus(currentVersion, { checkedAt: now })
        cached = { at: now, status }
        emitEvent({ type: 'app-update', update: status })
        return status
      }
      if (!response.ok) {
        return quietFailure(
          cached,
          currentVersion,
          now,
          `GitHub Releases returned HTTP ${response.status}`,
        )
      }
      if (!json) {
        return quietFailure(cached, currentVersion, now, 'GitHub Releases returned an empty body')
      }
      const status = parseGithubRelease(json, currentVersion, {
        now,
        platform: { platform: process.platform, arch: process.arch },
      })
      cached = { at: now, status }
      emitEvent({ type: 'app-update', update: status })
      return status
    } catch (error) {
      controller.abort()
      return quietFailure(
        cached,
        currentVersion,
        now,
        error instanceof Error ? error.message : 'Could not reach GitHub Releases',
      )
    }
  }

  return {
    check,
    reset() {
      cached = null
    },
    snapshot(): AppUpdateStatus | null {
      return cached?.status ?? null
    },
  }
}

function resolveFeedForCheck(input: CheckAppUpdateOptions): string | null {
  const env = input.env ?? process.env
  if (!String(env[APP_UPDATE_FEED_ENV] ?? '').trim()) return null
  const runtime = input.runtime ?? detectAppUpdateRuntime()
  return resolveUpdateFeedUrl(env, runtime)
}

function statusFromLocalFeed(
  pieces: { version: string; assets: { name: string; url: string; size?: number }[] },
  currentVersion: string,
  now: number,
): AppUpdateStatus {
  const current = normalizeVersion(currentVersion) || currentVersion
  const latest = normalizeVersion(pieces.version)
  const dmgName = latest ? macArm64ArchiveName(latest, 'dmg') : ''
  return {
    currentVersion: current,
    latestVersion: latest || null,
    updateAvailable: latest ? isNewerVersion(latest, current) : false,
    releaseName: latest ? `Font Buttler ${latest}` : null,
    releaseNotes: null,
    htmlUrl: APP_UPDATE_GITHUB_RELEASES_URL,
    publishedAt: null,
    assets: pieces.assets,
    preferredAsset: pieces.assets.find((asset) => asset.name === dmgName) ?? null,
    autoInstall: APP_UPDATE_AUTO_INSTALL,
    checkedAt: now,
  }
}

export const appUpdateChecker = createAppUpdateChecker()

export async function checkAppUpdate(options: CheckAppUpdateOptions = {}): Promise<AppUpdateStatus> {
  return appUpdateChecker.check(options)
}

export function parkedAutoInstallState(): {
  autoInstall: typeof APP_UPDATE_AUTO_INSTALL
  reason: string
} {
  return {
    autoInstall: APP_UPDATE_AUTO_INSTALL,
    reason:
      'Automatic download and install stay off. The Update badge downloads only after a click, then installs in place for a packaged Developer ID build on team A7WWML89LQ or opens a verified DMG otherwise. See docs/releases.md.',
  }
}

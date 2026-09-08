import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitEvent } from './events.ts'
import {
  APP_UPDATE_AUTO_INSTALL,
  APP_UPDATE_CACHE_MS,
  APP_UPDATE_GITHUB_LATEST_API,
  APP_UPDATE_GITHUB_RELEASES_URL,
  emptyAppUpdateStatus,
  parseGithubRelease,
  type AppUpdateStatus,
  type GithubReleaseJson,
} from '../shared/app-update.ts'

export {
  APP_UPDATE_AUTO_INSTALL,
  APP_UPDATE_CACHE_MS,
  APP_UPDATE_GITHUB_LATEST_API,
  APP_UPDATE_GITHUB_OWNER,
  APP_UPDATE_GITHUB_RELEASES_URL,
  APP_UPDATE_GITHUB_REPO,
  PARKED_AUTO_INSTALL_MESSAGE,
  appUpdateRowLabel,
  compareVersions,
  isAllowedAppUpdateUrl,
  isNewerVersion,
  normalizeVersion,
  parseGithubRelease,
  preferredReleaseAsset,
  shouldShowUpdatesTab,
  startParkedAutoInstall,
} from '../shared/app-update.ts'
export type { AppUpdateAsset, AppUpdateStatus, GithubReleaseJson } from '../shared/app-update.ts'

export type AppUpdateFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
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

function githubToken(explicit?: string): string {
  return (
    explicit ||
    process.env.FONT_BUTLER_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
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

function errorStatus(currentVersion: string, now: number, error: string): AppUpdateStatus {
  return emptyAppUpdateStatus(currentVersion, {
    htmlUrl: APP_UPDATE_GITHUB_RELEASES_URL,
    checkedAt: now,
    error,
  })
}

export function createAppUpdateChecker(options: { cacheMs?: number } = {}) {
  const cacheMs = options.cacheMs ?? APP_UPDATE_CACHE_MS
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
    try {
      const response = await fetchImpl(APP_UPDATE_GITHUB_LATEST_API, {
        headers: requestHeaders(currentVersion, githubToken(input.githubToken)),
      })
      if (response.status === 404) {
        const status = emptyAppUpdateStatus(currentVersion, { checkedAt: now })
        cached = { at: now, status }
        emitEvent({ type: 'app-update', update: status })
        return status
      }
      if (!response.ok) {
        const status = errorStatus(
          currentVersion,
          now,
          `GitHub Releases returned HTTP ${response.status}`,
        )
        cached = { at: now, status }
        emitEvent({ type: 'app-update', update: status })
        return status
      }
      const json = (await response.json()) as GithubReleaseJson
      const status = parseGithubRelease(json, currentVersion, {
        now,
        platform: { platform: process.platform, arch: process.arch },
      })
      cached = { at: now, status }
      emitEvent({ type: 'app-update', update: status })
      return status
    } catch (error) {
      const status = errorStatus(
        currentVersion,
        now,
        error instanceof Error ? error.message : 'Could not reach GitHub Releases',
      )
      cached = { at: now, status }
      emitEvent({ type: 'app-update', update: status })
      return status
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
      'After Developer ID signing and notarization, enable electron-updater with the GitHub provider, keep autoDownload and autoInstallOnAppQuit off, then offer an explicit Install action. See docs/releases.md.',
  }
}

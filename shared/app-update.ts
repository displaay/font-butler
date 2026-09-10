export const APP_UPDATE_GITHUB_OWNER = 'displaay'
export const APP_UPDATE_GITHUB_REPO = 'font-butler'
export const APP_UPDATE_GITHUB_RELEASES_URL = `https://github.com/${APP_UPDATE_GITHUB_OWNER}/${APP_UPDATE_GITHUB_REPO}/releases`
export const APP_UPDATE_GITHUB_LATEST_API = `https://api.github.com/repos/${APP_UPDATE_GITHUB_OWNER}/${APP_UPDATE_GITHUB_REPO}/releases/latest`

/** Read-only token for private repos until Releases are public. */
export const APP_UPDATE_GITHUB_TOKEN_ENV = 'FONT_BUTLER_GITHUB_TOKEN'
export const APP_UPDATE_GITHUB_TOKEN_FALLBACK_ENV = 'GITHUB_TOKEN'

/** Auto-download / auto-install stay off until Apple signing and notarization land. */
export const APP_UPDATE_AUTO_INSTALL = 'parked' as const

export const APP_UPDATE_CACHE_MS = 60 * 60 * 1000
export const APP_UPDATE_FETCH_TIMEOUT_MS = 4000
export const APP_UPDATE_NOTES_LIMIT = 32 * 1024

export const PARKED_AUTO_INSTALL_MESSAGE =
  'Auto-install is parked until Apple signing lands. Open the GitHub release to download.'

export const PARKED_AUTO_INSTALL_NOTICE =
  'Auto-install is pending Apple signing. Download the release or open it in your browser.'

export type AppUpdateAsset = {
  name: string
  url: string
  contentType?: string
  size?: number
}

export type AppUpdateStatus = {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseName: string | null
  releaseNotes: string | null
  htmlUrl: string | null
  publishedAt: string | null
  assets: AppUpdateAsset[]
  preferredAsset: AppUpdateAsset | null
  autoInstall: typeof APP_UPDATE_AUTO_INSTALL
  checkedAt: number
  error?: string
}

export type GithubReleaseAssetJson = {
  name?: string
  browser_download_url?: string
  content_type?: string
  size?: number
}

export type GithubReleaseJson = {
  tag_name?: string
  name?: string
  body?: string | null
  html_url?: string
  published_at?: string | null
  draft?: boolean
  prerelease?: boolean
  assets?: GithubReleaseAssetJson[]
}

export type AppUpdatePlatform = {
  platform: string
  arch: string
}

export function normalizeVersion(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/^v/i, '')
}

function numericParts(raw: string): { core: number[]; pre: string } {
  const normalized = normalizeVersion(raw)
  const [main = '0', preWithBuild = ''] = normalized.split('-')
  const pre = preWithBuild.split('+')[0] ?? ''
  const core = main
    .split('.')
    .slice(0, 3)
    .map((part) => {
      const match = part.match(/^\d+/)
      return match ? Number.parseInt(match[0], 10) : 0
    })
  while (core.length < 3) core.push(0)
  return { core, pre }
}

/** Compare two version strings. Returns -1 if a < b, 0 if equal, 1 if a > b. */
export function compareVersions(a: string, b: string): number {
  const left = numericParts(a)
  const right = numericParts(b)
  for (let i = 0; i < 3; i += 1) {
    const delta = (left.core[i] ?? 0) - (right.core[i] ?? 0)
    if (delta < 0) return -1
    if (delta > 0) return 1
  }
  if (!left.pre && !right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  if (left.pre < right.pre) return -1
  if (left.pre > right.pre) return 1
  return 0
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0
}

export function isAllowedAppUpdateUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.hostname !== 'github.com') return false
  const prefix = `/${APP_UPDATE_GITHUB_OWNER}/${APP_UPDATE_GITHUB_REPO}`
  return parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
}

export function sanitizeAppUpdateUrl(url: string | null | undefined): string | null {
  const value = (url ?? '').trim()
  if (!value || !isAllowedAppUpdateUrl(value)) return null
  return value
}

export function currentPlatform(): AppUpdatePlatform {
  return {
    platform: 'darwin',
    arch: 'arm64',
  }
}

function assetScore(asset: AppUpdateAsset, platform: AppUpdatePlatform): number {
  const name = asset.name.toLowerCase()
  let score = 0
  if (name.endsWith('.dmg')) score += 20
  else if (name.endsWith('.zip')) score += 10
  else return 0
  const arch = platform.arch.toLowerCase()
  if (arch === 'arm64' && /arm64|aarch64|apple-silicon/.test(name)) score += 8
  if ((arch === 'x64' || arch === 'ia32') && /x64|amd64|x86_64|intel/.test(name)) score += 8
  if (/universal/.test(name)) score += 4
  if (platform.platform === 'darwin' && /mac|darwin|osx/.test(name)) score += 2
  return score
}

export function preferredReleaseAsset(
  assets: AppUpdateAsset[],
  platform: AppUpdatePlatform = currentPlatform(),
): AppUpdateAsset | null {
  let best: AppUpdateAsset | null = null
  let bestScore = 0
  for (const asset of assets) {
    const score = assetScore(asset, platform)
    if (score > bestScore) {
      best = asset
      bestScore = score
    }
  }
  return best
}

export function parseGithubReleaseAssets(raw: GithubReleaseAssetJson[] | undefined): AppUpdateAsset[] {
  const assets: AppUpdateAsset[] = []
  for (const item of raw ?? []) {
    const name = (item.name ?? '').trim()
    const url = sanitizeAppUpdateUrl(item.browser_download_url)
    if (!name || !url) continue
    assets.push({
      name,
      url,
      contentType: item.content_type,
      size: typeof item.size === 'number' ? item.size : undefined,
    })
  }
  return assets
}

export function emptyAppUpdateStatus(
  currentVersion: string,
  extra: Partial<AppUpdateStatus> = {},
): AppUpdateStatus {
  return {
    currentVersion: normalizeVersion(currentVersion) || currentVersion,
    latestVersion: null,
    updateAvailable: false,
    releaseName: null,
    releaseNotes: null,
    htmlUrl: APP_UPDATE_GITHUB_RELEASES_URL,
    publishedAt: null,
    assets: [],
    preferredAsset: null,
    autoInstall: APP_UPDATE_AUTO_INSTALL,
    checkedAt: extra.checkedAt ?? Date.now(),
    ...extra,
  }
}

export function parseGithubRelease(
  json: GithubReleaseJson,
  currentVersion: string,
  options: { now?: number; platform?: AppUpdatePlatform } = {},
): AppUpdateStatus {
  const current = normalizeVersion(currentVersion) || currentVersion
  if (json.draft || json.prerelease) {
    return emptyAppUpdateStatus(current, {
      checkedAt: options.now,
      htmlUrl: sanitizeAppUpdateUrl(json.html_url) ?? APP_UPDATE_GITHUB_RELEASES_URL,
    })
  }
  const latest = normalizeVersion(json.tag_name || json.name || '')
  const notes = typeof json.body === 'string' ? json.body.trim() : ''
  const assets = parseGithubReleaseAssets(json.assets)
  return {
    currentVersion: current,
    latestVersion: latest || null,
    updateAvailable: latest ? isNewerVersion(latest, current) : false,
    releaseName: (json.name ?? '').trim() || latest || null,
    releaseNotes: notes ? notes.slice(0, APP_UPDATE_NOTES_LIMIT) : null,
    htmlUrl: sanitizeAppUpdateUrl(json.html_url) ?? APP_UPDATE_GITHUB_RELEASES_URL,
    publishedAt: json.published_at ?? null,
    assets,
    preferredAsset: preferredReleaseAsset(assets, options.platform ?? currentPlatform()),
    autoInstall: APP_UPDATE_AUTO_INSTALL,
    checkedAt: options.now ?? Date.now(),
  }
}

export function appUpdateRowLabel(status: Pick<AppUpdateStatus, 'updateAvailable' | 'latestVersion'>): string {
  if (!status.updateAvailable || !status.latestVersion) return ''
  return `Font Buttler ${status.latestVersion}`
}

/**
 * `otherUpdateCount` covers updates that are neither a catalog entry nor the app itself — today the
 * retail collection, where the newer bytes are still on the server and no local file has changed yet.
 */
export function shouldShowUpdatesTab(
  fontUpdateCount: number,
  hasAppUpdate: boolean,
  otherUpdateCount = 0,
): boolean {
  return fontUpdateCount > 0 || hasAppUpdate || otherUpdateCount > 0
}

/** Resolve `work` or reject after `timeoutMs`. A hung fetch must not block boot. */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('GitHub Releases timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Parked until Developer ID signing + notarization. Callers must not download
 * or install GitHub assets. See docs/releases.md.
 */
export function startParkedAutoInstall(): never {
  throw new Error(PARKED_AUTO_INSTALL_MESSAGE)
}

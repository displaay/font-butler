export const APP_UPDATE_FEED_ENV: 'FONT_BUTLER_UPDATE_FEED_URL'

export type AppUpdateRuntimeFacts = {
  packaged?: boolean
  developerId?: boolean
  teamId?: string | null
  signatureUnreadable?: boolean
  adhoc?: boolean
  translocated?: boolean
  readOnly?: boolean
  bundleWritable?: boolean
  appPath?: string | null
  testFeedBuild?: boolean
}

export function resolveUpdateFeedUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  runtime: AppUpdateRuntimeFacts,
): string | null

export function detectAppUpdateRuntime(execPath?: string): AppUpdateRuntimeFacts

export const APP_PRODUCT_BUNDLE: 'Cuttler.app'
export const LEGACY_APP_PRODUCT_BUNDLE: 'Font Buttler.app'
export const TEST_FEED_APP_BUNDLE: 'Font Buttler Test.app'
export const LEGACY_MAC_ARCHIVE_STEM: 'Font-Buttler'
export const MAC_ARCHIVE_STEM: 'Cuttler'

export function isFontButlerAppBundle(appPath: string | null | undefined): boolean
export function macArm64ArchiveName(version: string, ext: string): string
export function macArm64ArchiveNames(version: string, ext: string): string[]
export function resolveUpdateInstallAppPath(
  currentApp: string | null | undefined,
  options?: { testFeedBuild?: boolean },
): string | null
export function findUpdateAppBundle(root: string): string | null
export function buildMacSwapScript(input: {
  pid: number
  currentApp: string
  nextApp: string
  installApp?: string
  tempDir: string
  scriptPath: string
  testFeedBuild?: boolean
}): string

export function loadUpdateFeed(
  feedUrl: string,
  fetchImpl: (
    url: string,
    init?: { headers?: Record<string, string>; redirect?: string; signal?: AbortSignal },
  ) => Promise<{
    ok: boolean
    status: number
    headers?: { get?: (name: string) => string | null }
    text?: () => Promise<string>
    stream?: AsyncIterable<Uint8Array> | null
  }>,
): Promise<{ version: string; assets: { name: string; url: string; size?: number }[] }>

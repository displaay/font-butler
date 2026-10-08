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

export function macArm64ArchiveName(version: string, ext: string): string

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

import type { RetailManifest } from '../shared/retail.ts'

export const RETAIL_FETCH_TIMEOUT_MS = 15_000
export const RETAIL_DOWNLOAD_TIMEOUT_MS = 60_000

export type RetailFetch = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  arrayBuffer: () => Promise<ArrayBuffer>
  headers?: { get: (name: string) => string | null }
}>

export type RetailClientOptions = {
  workerBaseUrl: string
  token: string
  fetch?: RetailFetch
  timeoutMs?: number
}

export class RetailRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetailRequestError'
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new RetailRequestError(`${label} timed out`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Only https, except for a loopback dev worker (`wrangler dev` serves http://localhost:8787). The
 * token is sent as a bearer header, so a plain-http remote host would put it on the wire in clear.
 */
export function isAllowedRetailBaseUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol === 'https:') return true
  if (parsed.protocol !== 'http:') return false
  return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
}

/**
 * R2 keys look like `<glyphsFile>/<revisionId>/<basename>`.
 *
 * Percent-encoding each segment is NOT enough on its own: `encodeURIComponent('..')` returns `'..'`
 * unchanged, and `new URL()` then collapses the dot segment — so a key carrying `..` would walk out of
 * `/font-butler/retail/file/` and hit an unrelated worker route. Reject those keys outright.
 */
export function isSafeRetailKey(key: string): boolean {
  if (typeof key !== 'string' || !key.trim()) return false
  if (key.includes('\0') || key.includes('\\')) return false
  if (key.startsWith('/')) return false
  const segments = key.split('/')
  if (segments.length < 2) return false
  return segments.every((segment) => {
    const trimmed = segment.trim()
    // A blank or all-dots segment is degenerate: it either collapses in a URL or names a directory.
    return Boolean(trimmed) && !/^\.+$/.test(trimmed)
  })
}

export function retailUrl(workerBaseUrl: string, endpoint: string): string {
  const base = workerBaseUrl.trim().replace(/\/+$/, '')
  return `${base}${endpoint}`
}

function assertBaseUrl(workerBaseUrl: string): void {
  if (!isAllowedRetailBaseUrl(workerBaseUrl)) {
    throw new RetailRequestError('The DISPLAAY worker address must be an https URL.')
  }
}

function requestHeaders(token: string): Record<string, string> {
  if (!token) {
    throw new RetailRequestError('Add a DISPLAAY worker token first.')
  }
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' }
}

function resolveFetch(options: RetailClientOptions): RetailFetch {
  return options.fetch ?? (globalThis.fetch as unknown as RetailFetch)
}

/**
 * Never called on the cold-start path — same rule the app-update check follows, so a hung worker
 * cannot stall first paint.
 */
export async function fetchRetailManifest(
  options: RetailClientOptions & { refresh?: boolean },
): Promise<RetailManifest> {
  assertBaseUrl(options.workerBaseUrl)
  const headers = requestHeaders(options.token)
  const url = retailUrl(
    options.workerBaseUrl,
    `/font-butler/retail/manifest${options.refresh ? '?refresh=1' : ''}`,
  )
  const controller = new AbortController()

  try {
    const response = await withTimeout(
      resolveFetch(options)(url, { headers, signal: controller.signal }),
      options.timeoutMs ?? RETAIL_FETCH_TIMEOUT_MS,
      'The DISPLAAY worker',
    )
    if (response.status === 401 || response.status === 403) {
      throw new RetailRequestError('The DISPLAAY worker rejected that token.')
    }
    if (!response.ok) {
      throw new RetailRequestError(`The DISPLAAY worker returned HTTP ${response.status}.`)
    }
    // The body read has to be inside the timeout as well: a worker that returns headers and then
    // stalls the body would otherwise hang the caller forever.
    const parsed = (await withTimeout(
      response.json(),
      options.timeoutMs ?? RETAIL_FETCH_TIMEOUT_MS,
      'The DISPLAAY worker',
    )) as RetailManifest
    if (!parsed || !Array.isArray(parsed.collections)) {
      throw new RetailRequestError('The DISPLAAY worker returned an unexpected manifest.')
    }
    return {
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : new Date().toISOString(),
      collections: parsed.collections,
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
    }
  } catch (error) {
    controller.abort()
    throw error instanceof RetailRequestError
      ? error
      : new RetailRequestError(
          error instanceof Error ? error.message : 'Could not reach the DISPLAAY worker.',
        )
  }
}

export async function fetchRetailFile(
  options: RetailClientOptions & { key: string; expectedSize?: number },
): Promise<Uint8Array> {
  assertBaseUrl(options.workerBaseUrl)
  if (!isSafeRetailKey(options.key)) {
    throw new RetailRequestError(`${options.key}: refused an unsafe key.`)
  }
  const headers = requestHeaders(options.token)
  const url = retailUrl(
    options.workerBaseUrl,
    `/font-butler/retail/file/${options.key.split('/').map(encodeURIComponent).join('/')}`,
  )
  const controller = new AbortController()

  try {
    const response = await withTimeout(
      resolveFetch(options)(url, { headers, signal: controller.signal }),
      options.timeoutMs ?? RETAIL_DOWNLOAD_TIMEOUT_MS,
      'The DISPLAAY worker',
    )
    if (response.status === 401 || response.status === 403) {
      throw new RetailRequestError('The DISPLAAY worker rejected that token.')
    }
    if (!response.ok) {
      throw new RetailRequestError(`${options.key}: HTTP ${response.status}`)
    }
    // Refuse an oversized body before reading it, so a misbehaving worker cannot push arbitrary bytes
    // into memory. `expectedSize` comes from the manifest the caller already validated.
    const declared = Number(response.headers?.get('content-length') ?? '')
    if (
      typeof options.expectedSize === 'number' &&
      Number.isFinite(declared) &&
      declared > options.expectedSize
    ) {
      throw new RetailRequestError(
        `${options.key}: server offered ${declared} bytes, expected ${options.expectedSize}.`,
      )
    }
    return new Uint8Array(
      await withTimeout(
        response.arrayBuffer(),
        options.timeoutMs ?? RETAIL_DOWNLOAD_TIMEOUT_MS,
        'The DISPLAAY worker',
      ),
    )
  } catch (error) {
    controller.abort()
    throw error instanceof RetailRequestError
      ? error
      : new RetailRequestError(
          error instanceof Error ? error.message : `${options.key}: download failed`,
        )
  }
}

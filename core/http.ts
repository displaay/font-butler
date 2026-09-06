import type { Context } from 'hono'
import path from 'node:path'
import { isFullyUnderAnyRoot } from './containment.ts'
import { verifyFontPreviewQuery, type FontAccessQuery } from './font-access.ts'

export const DEV_UI_ORIGINS = [
  'http://127.0.0.1:43181',
  'http://localhost:43181',
  'http://[::1]:43181',
] as const

export function loopbackHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
}

export function allowedOrigins(port: number, extra: string[] = []): string[] {
  const origins = [
    ...DEV_UI_ORIGINS,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
    ...extra,
  ]
  return [...new Set(origins)]
}

function normalizeHost(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function originOf(value: string | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw || raw === 'null') return ''
  try {
    const url = new URL(raw)
    return url.origin
  } catch {
    return raw.replace(/\/$/, '')
  }
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  const value = normalizeHost(host)
  if (!value) return false
  return loopbackHosts(port).some((allowed) => allowed.toLowerCase() === value)
}

export function isAllowedOrigin(origin: string | undefined, port: number, extra: string[] = []): boolean {
  const value = originOf(origin)
  if (!value) return false
  return allowedOrigins(port, extra).some((allowed) => allowed.toLowerCase() === value.toLowerCase())
}

export function requestAuthorityError(
  headers: { host?: string | undefined; origin?: string | undefined },
  port: number,
  extraOrigins: string[] = [],
): string | null {
  if (!isAllowedHost(headers.host, port)) {
    return 'Forbidden host'
  }
  const origin = (headers.origin ?? '').trim()
  if (origin && origin !== 'null' && !isAllowedOrigin(origin, port, extraOrigins)) {
    return 'Forbidden origin'
  }
  return null
}

export function isPublicApiGet(pathname: string): boolean {
  return pathname === '/api/health' || pathname === '/api/bootstrap'
}

export function bearerToken(authorization: string | undefined): string | null {
  const value = authorization ?? ''
  return value.startsWith('Bearer ') ? value.slice(7) : null
}

export function isAuthorizedApiRequest(options: {
  method: string
  pathname: string
  authorization?: string
  token: string
  query?: FontAccessQuery
  now?: number
}): boolean {
  const method = options.method.toUpperCase()
  if ((method === 'GET' || method === 'HEAD') && isPublicApiGet(options.pathname)) {
    return true
  }
  const bearer = bearerToken(options.authorization)
  if (bearer && bearer === options.token) {
    return true
  }
  if (method === 'GET' || method === 'HEAD') {
    return verifyFontPreviewQuery(options.token, options.pathname, options.query ?? {}, options.now)
  }
  return false
}

export function denyRemoteRequest(
  c: Context,
  port: number,
  extraOrigins: string[] = [],
): Response | null {
  const error = requestAuthorityError(
    {
      host: c.req.header('host'),
      origin: c.req.header('origin'),
    },
    port,
    extraOrigins,
  )
  if (!error) return null
  return c.json({ error }, 403)
}

export function decodeRequestPath(urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  try {
    if (decodeURIComponent(decoded) !== decoded) {
      return null
    }
  } catch {
    return null
  }
  return decoded
}

export function resolveStaticAsset(root: string, urlPath: string): string | 'forbidden' | null {
  const decoded = decodeRequestPath(urlPath)
  if (decoded === null) return 'forbidden'
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  if (rel.split(/[/\\]/).some((segment) => segment === '..')) {
    return 'forbidden'
  }
  const candidate = path.resolve(root, rel)
  if (!isFullyUnderAnyRoot(candidate, [root])) {
    return 'forbidden'
  }
  return candidate
}

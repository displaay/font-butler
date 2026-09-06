export const FONT_ACCESS_TTL_MS = 60 * 60 * 1000
export const FONT_ACCESS_CLOCK_SKEW_MS = 60 * 1000

export type FontFileAccess = {
  kind: 'font-file'
  id: string
  which: string
  revision: string
}

export type SystemFontAccess = {
  kind: 'system-font'
  path: string
}

export type FontAccessPayload = FontFileAccess | SystemFontAccess

export type FontAccessQuery = {
  exp?: string
  sig?: string
  which?: string
  revision?: string
  path?: string
}

export function isFontPreviewPath(pathname: string): boolean {
  return pathname === '/api/system-font' || pathname.startsWith('/api/font-file/')
}

export function fontAccessMessage(payload: FontAccessPayload, exp: string): string {
  if (payload.kind === 'font-file') {
    return `v1\nfont-file\n${payload.id}\n${payload.which}\n${payload.revision}\n${exp}`
  }
  return `v1\nsystem-font\n${payload.path}\n${exp}`
}

export function fontAccessPayloadFromRequest(
  pathname: string,
  query: FontAccessQuery = {},
): FontAccessPayload | null {
  if (pathname.startsWith('/api/font-file/')) {
    const id = pathname.slice('/api/font-file/'.length)
    if (!id || id.includes('/')) return null
    return {
      kind: 'font-file',
      id,
      which: query.which?.trim() || 'installed',
      revision: query.revision?.trim() || '',
    }
  }
  if (pathname === '/api/system-font') {
    const filePath = query.path?.trim()
    if (!filePath) return null
    return { kind: 'system-font', path: filePath }
  }
  return null
}

export function withFontAccessQuery(
  url: string,
  access: { exp: string; sig: string },
): string {
  const qIndex = url.indexOf('?')
  const path = qIndex === -1 ? url : url.slice(0, qIndex)
  const query = new URLSearchParams(qIndex === -1 ? '' : url.slice(qIndex + 1))
  query.set('exp', access.exp)
  query.set('sig', access.sig)
  return `${path}?${query.toString()}`
}

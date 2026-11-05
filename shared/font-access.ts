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

/** A font opened in Compare. The path must also be on the server allowlist. */
export type CompareFontAccess = {
  kind: 'compare-font'
  path: string
  /** Face inside a TTC/OTC. Standalone fonts use 0. Bound into the signature. */
  face: number
}

export type FontAccessPayload = FontFileAccess | SystemFontAccess | CompareFontAccess

export type FontAccessQuery = {
  exp?: string
  sig?: string
  which?: string
  revision?: string
  path?: string
  face?: string
}

export function isFontPreviewPath(pathname: string): boolean {
  return (
    pathname === '/api/system-font' ||
    pathname === '/api/compare-font' ||
    pathname.startsWith('/api/font-file/')
  )
}

export function fontAccessMessage(payload: FontAccessPayload, exp: string): string {
  if (payload.kind === 'font-file') {
    return `v1\nfont-file\n${payload.id}\n${payload.which}\n${payload.revision}\n${exp}`
  }
  if (payload.kind === 'compare-font') {
    return `v1\ncompare-font\n${payload.path}\n${payload.face}\n${exp}`
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
  if (pathname === '/api/system-font' || pathname === '/api/compare-font') {
    const filePath = query.path?.trim()
    if (!filePath) return null
    if (pathname === '/api/system-font') return { kind: 'system-font', path: filePath }
    const face = compareFaceIndex(query.face)
    if (face === null) return null
    return { kind: 'compare-font', path: filePath, face }
  }
  return null
}

export function compareFaceIndex(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return 0
  if (!/^\d+$/.test(value.trim())) return null
  const face = Number(value)
  if (!Number.isInteger(face) || face < 0 || face > 1024) return null
  return face
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

import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  FONT_ACCESS_CLOCK_SKEW_MS,
  FONT_ACCESS_TTL_MS,
  fontAccessMessage,
  fontAccessPayloadFromRequest,
  isFontPreviewPath,
  type FontAccessPayload,
  type FontAccessQuery,
} from '../shared/font-access.ts'

export {
  FONT_ACCESS_CLOCK_SKEW_MS,
  FONT_ACCESS_TTL_MS,
  fontAccessPayloadFromRequest,
  isFontPreviewPath,
  withFontAccessQuery,
} from '../shared/font-access.ts'
export type { FontAccessPayload, FontAccessQuery } from '../shared/font-access.ts'

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex')
}

function equalHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return false
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

export function signFontAccess(
  secret: string,
  payload: FontAccessPayload,
  now = Date.now(),
): { exp: string; sig: string } {
  const exp = String(now + FONT_ACCESS_TTL_MS)
  return { exp, sig: hmacHex(secret, fontAccessMessage(payload, exp)) }
}

export function verifyFontAccess(
  secret: string,
  payload: FontAccessPayload,
  query: FontAccessQuery,
  now = Date.now(),
): boolean {
  const exp = query.exp?.trim() ?? ''
  const sig = query.sig?.trim() ?? ''
  if (!exp || !sig) return false
  const expMs = Number(exp)
  if (!Number.isFinite(expMs)) return false
  if (expMs + FONT_ACCESS_CLOCK_SKEW_MS < now) return false
  if (expMs > now + FONT_ACCESS_TTL_MS + FONT_ACCESS_CLOCK_SKEW_MS) return false
  const expected = hmacHex(secret, fontAccessMessage(payload, exp))
  return equalHex(expected, sig)
}

export function verifyFontPreviewQuery(
  secret: string,
  pathname: string,
  query: FontAccessQuery,
  now = Date.now(),
): boolean {
  if (!isFontPreviewPath(pathname)) return false
  const payload = fontAccessPayloadFromRequest(pathname, query)
  if (!payload) return false
  return verifyFontAccess(secret, payload, query, now)
}

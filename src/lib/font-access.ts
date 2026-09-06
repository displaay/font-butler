import {
  FONT_ACCESS_TTL_MS,
  fontAccessMessage,
  type FontAccessPayload,
  withFontAccessQuery,
} from '../../shared/font-access.ts'

export { FONT_ACCESS_TTL_MS, withFontAccessQuery } from '../../shared/font-access.ts'
export type { FontAccessPayload } from '../../shared/font-access.ts'

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function signFontAccess(
  secret: string,
  payload: FontAccessPayload,
  now = Date.now(),
): Promise<{ exp: string; sig: string } > {
  const exp = String(now + FONT_ACCESS_TTL_MS)
  return { exp, sig: await hmacHex(secret, fontAccessMessage(payload, exp)) }
}

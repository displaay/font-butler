import {
  FONT_ACCESS_TTL_MS,
  fontAccessMessage,
  type FontAccessPayload,
} from '../../shared/font-access.ts'

export { FONT_ACCESS_TTL_MS, withFontAccessQuery } from '../../shared/font-access.ts'
export type { FontAccessPayload } from '../../shared/font-access.ts'

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

let cachedSecret: string | undefined
let cachedKey: CryptoKey | undefined

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (cachedSecret === secret && cachedKey) return cachedKey
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  cachedSecret = secret
  cachedKey = key
  return key
}

function bytesToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i]!]
  return out
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret)
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return bytesToHex(buf)
}

export async function signFontAccess(
  secret: string,
  payload: FontAccessPayload,
  now = Date.now(),
): Promise<{ exp: string; sig: string } > {
  const exp = String(now + FONT_ACCESS_TTL_MS)
  return { exp, sig: await hmacHex(secret, fontAccessMessage(payload, exp)) }
}

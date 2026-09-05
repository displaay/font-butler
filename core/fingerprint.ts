import crypto from 'node:crypto'
import fs from 'node:fs'

export function fingerprintBuffer(data: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

export function fingerprintFile(filePath: string): string {
  return fingerprintBuffer(fs.readFileSync(filePath))
}

export function tryFingerprintFile(filePath: string): string | undefined {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return undefined
    }
    return fingerprintFile(filePath)
  } catch {
    return undefined
  }
}

import crypto from 'node:crypto'
import fs from 'node:fs'

export function fingerprintBuffer(data: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

export function fingerprintFile(filePath: string): string {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(64 * 1024)
    let bytesRead = 0
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
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

export function tryFingerprintFileIfChanged(
  filePath: string,
  previous?: { fingerprint?: string; mtimeMs?: number; size?: number },
): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return undefined
    if (
      previous?.fingerprint &&
      previous.mtimeMs === stat.mtimeMs &&
      previous.size === stat.size
    ) {
      return previous.fingerprint
    }
    return fingerprintFile(filePath)
  } catch {
    return undefined
  }
}

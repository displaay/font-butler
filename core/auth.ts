import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const UNSAFE_PATH = /[\x00-\x1f"\\]/

export function assertSafeShellPath(filePath: string): string {
  const resolved = path.resolve(filePath)
  if (!path.isAbsolute(resolved)) {
    throw new Error('Font path must be absolute.')
  }
  if (UNSAFE_PATH.test(resolved)) {
    throw new Error('Font path contains unsupported characters.')
  }
  return resolved
}

export function getOrCreateApiToken(tokenPath: string): string {
  if (fs.existsSync(tokenPath)) {
    const token = fs.readFileSync(tokenPath, 'utf8').trim()
    if (token.length >= 16) {
      return token
    }
  }
  const token = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true })
  fs.writeFileSync(tokenPath, token, { mode: 0o600 })
  return token
}

export function contentDisposition(filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, '_') || 'font.bin'
  const encoded = encodeURIComponent(filename)
  return `inline; filename="${safe}"; filename*=UTF-8''${encoded}`
}

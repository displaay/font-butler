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

export function shouldIncludeBootstrapToken(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FONT_BUTLER_TEST === '1' || env.FONT_BUTLER_DEV_BOOTSTRAP === '1'
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

/**
 * The DISPLAAY worker API token, kept in its own 0600 file rather than in settings.json.
 *
 * AppSettings is broadcast to the renderer on `/api/bootstrap`, on `/api/settings` and on every
 * `settings` event, so a token stored there would leak into the UI payload. Same reasoning and same
 * file mode as the local API token above.
 */
export function readRetailToken(tokenPath: string): string {
  try {
    if (!fs.existsSync(tokenPath)) return ''
    return fs.readFileSync(tokenPath, 'utf8').trim()
  } catch {
    return ''
  }
}

export function writeRetailToken(tokenPath: string, token: string): void {
  const value = token.trim()
  if (!value) {
    try {
      fs.rmSync(tokenPath, { force: true })
    } catch {
      // Nothing to clear.
    }
    return
  }
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true })
  // `mode` applies only when the file is created, and this rewrites on every token update, so an
  // existing file left at 0644 by an earlier build would silently stay world-readable.
  fs.rmSync(tokenPath, { force: true })
  fs.writeFileSync(tokenPath, value, { mode: 0o600 })
}

export function contentDisposition(filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, '_') || 'font.bin'
  const encoded = encodeURIComponent(filename)
  return `inline; filename="${safe}"; filename*=UTF-8''${encoded}`
}

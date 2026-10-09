import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function mainLogPath(home = os.homedir(), platform = process.platform): string {
  const override = process.env.FONT_BUTLER_LOG
  if (override && override.trim()) return path.resolve(override)
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Logs', 'Font Buttler', 'main.log')
  }
  return path.join(home, '.local', 'state', 'Font Buttler', 'logs', 'main.log')
}

/** Append one line to main.log. Failures are ignored so logging cannot break an install. */
export function logMain(source: string, message: string): void {
  if (process.env.FONT_BUTLER_TEST === '1' && !process.env.FONT_BUTLER_LOG) return
  try {
    const filePath = mainLogPath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const ts = new Date().toISOString()
    const tag = source.padEnd(12).slice(0, 12)
    fs.appendFileSync(filePath, `${ts} [${tag}] ${message}\n`, 'utf8')
  } catch {
    // Logging must not fail an install.
  }
}

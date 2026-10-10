import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const APP_LOG_FOLDER = 'Font Buttler'
export const TEST_APP_LOG_FOLDER = 'Font Buttler Test'

/** Folder name for main.log. A test-feed build sets FONT_BUTLER_LOG_NAME. */
export function appLogFolderName(env: NodeJS.ProcessEnv = process.env): string {
  const name = env.FONT_BUTLER_LOG_NAME
  if (typeof name === 'string' && name.trim()) return name.trim()
  return APP_LOG_FOLDER
}

export function mainLogPath(
  home = os.homedir(),
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.FONT_BUTLER_LOG
  if (override && override.trim()) return path.resolve(override)
  const folder = appLogFolderName(env)
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Logs', folder, 'main.log')
  }
  return path.join(home, '.local', 'state', folder, 'logs', 'main.log')
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

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { getPaths, isMac } from './paths.ts'

const execFileAsync = promisify(execFile)

async function runQuiet(command: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(command, args, { timeout: 15_000 })
  } catch {
    // Cache tools are best-effort; missing binaries should not fail install.
  }
}

function emptyDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    return
  }
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    try {
      fs.rmSync(full, { recursive: true, force: true })
    } catch {
      // ignore locked cache files
    }
  }
}

export async function clearFontCaches(): Promise<{ mac: boolean; office: boolean }> {
  const paths = getPaths()
  let office = false
  if (isMac()) {
    await runQuiet('atsutil', ['databases', '-removeUser'])
    await runQuiet('atsutil', ['server', '-shutdown'])
    await runQuiet('atsutil', ['server', '-ping'])
    if (fs.existsSync(paths.atsCacheDir)) {
      emptyDir(paths.atsCacheDir)
    }
    if (fs.existsSync(paths.officeFontCacheDir)) {
      emptyDir(paths.officeFontCacheDir)
      office = true
    }
    return { mac: true, office }
  }
  return { mac: false, office: false }
}

export async function registerFont(filePath: string): Promise<void> {
  if (!isMac()) {
    return
  }
  const posix = filePath.replaceAll("'", "\\'")
  const script = `use framework "CoreText"
use scripting additions
set theURL to current application's NSURL's fileURLWithPath:"${posix}"
current application's CTFontManagerRegisterFontsForURL(theURL, 1, missing value)`
  try {
    await execFileAsync('osascript', ['-l', 'AppleScript', '-e', script], {
      timeout: 10_000,
    })
  } catch {
    // Copying into ~/Library/Fonts is enough for activation on modern macOS.
  }
}

export async function unregisterFont(filePath: string): Promise<void> {
  if (!isMac() || !filePath) {
    return
  }
  const posix = filePath.replaceAll("'", "\\'")
  const script = `use framework "CoreText"
use scripting additions
set theURL to current application's NSURL's fileURLWithPath:"${posix}"
current application's CTFontManagerUnregisterFontsForURL(theURL, 1, missing value)`
  try {
    await execFileAsync('osascript', ['-l', 'AppleScript', '-e', script], {
      timeout: 10_000,
    })
  } catch {
    // File removal still deactivates fonts living in standard folders.
  }
}

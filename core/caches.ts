import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { assertSafeShellPath } from './auth.ts'
import { getPaths, isMac } from './paths.ts'
import type { OfficeFontCacheInfo } from './types.ts'

export function locateOfficeFontCache(home = os.homedir()): OfficeFontCacheInfo {
  const groupContainers = path.join(home, 'Library/Group Containers')
  const known = path.join(groupContainers, 'UBF8T346G9.Office', 'FontCache')
  const candidates = [known]
  try {
    if (fs.existsSync(groupContainers)) {
      for (const entry of fs.readdirSync(groupContainers)) {
        if (!/office/i.test(entry)) continue
        const cache = path.join(groupContainers, entry, 'FontCache')
        if (!candidates.includes(cache)) candidates.push(cache)
      }
    }
  } catch {
    // Missing or unreadable Group Containers is fine; fall back to the known path.
  }
  const found = candidates.find((item) => {
    try {
      return fs.existsSync(item)
    } catch {
      return false
    }
  })
  return { path: found ?? known, exists: Boolean(found) }
}

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

export async function clearUserFontCache(): Promise<{ mac: boolean; cleared: boolean }> {
  if (!isMac()) {
    return { mac: false, cleared: false }
  }
  const paths = getPaths()
  await runQuiet('atsutil', ['databases', '-removeUser'])
  await runQuiet('atsutil', ['server', '-shutdown'])
  await runQuiet('atsutil', ['server', '-ping'])
  if (fs.existsSync(paths.atsCacheDir)) {
    emptyDir(paths.atsCacheDir)
  }
  return { mac: true, cleared: true }
}

export async function clearOfficeFontCache(): Promise<{ mac: boolean; cleared: boolean }> {
  if (!isMac()) {
    return { mac: false, cleared: false }
  }
  const located = locateOfficeFontCache()
  const fallback = getPaths().officeFontCacheDir
  const target = located.exists ? located.path : fallback
  if (fs.existsSync(target)) {
    emptyDir(target)
    return { mac: true, cleared: true }
  }
  return { mac: true, cleared: false }
}

export async function clearFontCaches(
  options: { office?: boolean } = {},
): Promise<{ mac: boolean; office: boolean }> {
  const font = await clearUserFontCache()
  if (options.office === false) {
    return { mac: font.mac, office: false }
  }
  const office = await clearOfficeFontCache()
  return { mac: font.mac, office: office.cleared }
}

export async function registerFont(filePath: string): Promise<void> {
  if (!isMac()) {
    return
  }
  const safePath = assertSafeShellPath(filePath)
  const posix = safePath.replaceAll("'", "\\'")
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
  const safePath = assertSafeShellPath(filePath)
  const posix = safePath.replaceAll("'", "\\'")
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

const FONT_ENABLE_SCRIPT = `ObjC.import('CoreText')
ObjC.import('Foundation')
function descriptorsFor(filePath) {
  const url = $.NSURL.fileURLWithPath(filePath)
  return $.CTFontManagerCreateFontDescriptorsFromURL(url)
}
function isEnabled(filePath) {
  const descs = descriptorsFor(filePath)
  if (!descs || Number(descs.count) === 0) return true
  const key = $.kCTFontEnabledAttribute
  for (let i = 0; i < Number(descs.count); i++) {
    const value = $.CTFontDescriptorCopyAttribute(descs.objectAtIndex(i), key)
    if (value && !ObjC.unwrap(value)) return false
  }
  return true
}
function run(argv) {
  const mode = argv[0]
  if (mode === 'get') {
    const paths = JSON.parse(argv[1] || '[]')
    const out = {}
    for (const filePath of paths) out[filePath] = isEnabled(filePath)
    return JSON.stringify(out)
  }
  if (mode === 'set') {
    const descs = descriptorsFor(argv[1])
    if (descs) $.CTFontManagerEnableFontDescriptors(descs, argv[2] === '1')
    return 'ok'
  }
  return '{}'
}
`

export async function setFontEnabled(filePath: string, enabled: boolean): Promise<void> {
  if (!isMac() || !filePath) {
    return
  }
  const safePath = assertSafeShellPath(filePath)
  try {
    await execFileAsync(
      'osascript',
      ['-l', 'JavaScript', '-e', FONT_ENABLE_SCRIPT, 'set', safePath, enabled ? '1' : '0'],
      { timeout: 10_000 },
    )
  } catch {
    // Catalog status still records deactivate when Core Text cannot be reached.
  }
}

export async function fontActivationStates(filePaths: string[]): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {}
  for (const filePath of filePaths) {
    result[filePath] = true
  }
  if (!isMac() || filePaths.length === 0) {
    return result
  }
  const safe = filePaths.map((filePath) => assertSafeShellPath(filePath))
  const chunkSize = 40
  for (let index = 0; index < safe.length; index += chunkSize) {
    const chunk = safe.slice(index, index + chunkSize)
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-l', 'JavaScript', '-e', FONT_ENABLE_SCRIPT, 'get', JSON.stringify(chunk)],
        { timeout: 20_000 },
      )
      const parsed = JSON.parse(stdout.trim() || '{}') as Record<string, boolean>
      for (const [filePath, enabled] of Object.entries(parsed)) {
        result[filePath] = Boolean(enabled)
      }
    } catch {
      // Assume enabled when the font registry cannot be queried.
    }
  }
  return result
}

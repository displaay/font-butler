import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { assertSafeShellPath } from './auth.ts'
import { getPaths, isMac } from './paths.ts'
import type { AdobeFontCacheInfo, OfficeFontCacheInfo } from './types.ts'

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

const ADOBE_FONT_LIST = /^(AdobeFnt|IllustratorFnt|AcroFnt).*\.lst$/i
const INDESIGN_FONT_CACHE_DIR = /^InDesign Font Cache$/i
const ADOBE_TYPE_CACHE_DIR = /^(Fonts|TypeSpt|TypeSupport)$/i
const ADOBE_SKIP_DIR =
  /^(CoreSync|OOBE|Creative Cloud|Creative Cloud Files|Creative Cloud Libraries|Common|Camera Raw|Media Cache|Media Cache Files|Peak Files|CEP|CRLogs|Logs|AdobeGCClient|caps|SLCache|SLStore)$/i
const ADOBE_WALK_DEPTH = 5

export function adobeFontCacheSearchRoots(home = os.homedir()): string[] {
  return [
    path.join(home, 'Library/Caches/Adobe'),
    path.join(home, 'Library/Caches/Adobe InDesign'),
    path.join(home, 'Library/Application Support/Adobe/TypeSupport'),
  ]
}

function adobeWalkTargets(home: string): Array<{ dir: string; emptyTypeCacheDirs: boolean }> {
  const caches = path.join(home, 'Library/Caches')
  const support = path.join(home, 'Library/Application Support/Adobe')
  const targets: Array<{ dir: string; emptyTypeCacheDirs: boolean }> = [
    { dir: path.join(caches, 'Adobe'), emptyTypeCacheDirs: true },
    { dir: path.join(caches, 'Adobe InDesign'), emptyTypeCacheDirs: false },
    { dir: path.join(caches, 'Adobe Illustrator'), emptyTypeCacheDirs: false },
    { dir: path.join(support, 'TypeSupport'), emptyTypeCacheDirs: false },
    { dir: path.join(support, 'TypeSpt'), emptyTypeCacheDirs: false },
  ]
  const seen = new Set(targets.map((item) => item.dir))
  try {
    if (fs.existsSync(caches)) {
      for (const entry of fs.readdirSync(caches, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !/^Adobe/i.test(entry.name)) continue
        const dir = path.join(caches, entry.name)
        if (seen.has(dir)) continue
        seen.add(dir)
        targets.push({ dir, emptyTypeCacheDirs: entry.name === 'Adobe' })
      }
    }
  } catch {
    // Unreadable Caches is fine; keep the known roots.
  }
  try {
    if (fs.existsSync(support)) {
      for (const entry of fs.readdirSync(support, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        if (!/^Adobe (Illustrator|InDesign|Photoshop)/i.test(entry.name)) continue
        const dir = path.join(support, entry.name)
        if (seen.has(dir)) continue
        seen.add(dir)
        targets.push({ dir, emptyTypeCacheDirs: false })
      }
    }
  } catch {
    // Unreadable Adobe Application Support is fine.
  }
  return targets
}

function collectAdobeFontCacheItems(
  dir: string,
  depth: number,
  emptyTypeCacheDirs: boolean,
  found: string[],
): void {
  if (depth > ADOBE_WALK_DEPTH) {
    return
  }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (ADOBE_SKIP_DIR.test(entry.name)) continue
      if (INDESIGN_FONT_CACHE_DIR.test(entry.name)) {
        found.push(full)
        continue
      }
      if (emptyTypeCacheDirs && depth <= 1 && ADOBE_TYPE_CACHE_DIR.test(entry.name)) {
        found.push(full)
        continue
      }
      collectAdobeFontCacheItems(full, depth + 1, emptyTypeCacheDirs, found)
      continue
    }
    if (entry.isFile() && ADOBE_FONT_LIST.test(entry.name)) {
      found.push(full)
    }
  }
}

export function locateAdobeFontCache(home = os.homedir()): AdobeFontCacheInfo {
  const roots = adobeFontCacheSearchRoots(home)
  const found: string[] = []
  for (const target of adobeWalkTargets(home)) {
    if (!fs.existsSync(target.dir)) continue
    collectAdobeFontCacheItems(target.dir, 0, target.emptyTypeCacheDirs, found)
  }
  const paths = [...new Set(found)].sort((a, b) => a.localeCompare(b))
  return { exists: paths.length > 0, paths, roots }
}

export function applyAdobeFontCacheClear(home: string): boolean {
  const located = locateAdobeFontCache(home)
  if (!located.exists) {
    return false
  }
  for (const item of located.paths) {
    try {
      if (!fs.existsSync(item)) continue
      const stat = fs.lstatSync(item)
      if (stat.isDirectory()) {
        emptyDir(item)
      } else {
        fs.rmSync(item, { force: true })
      }
    } catch {
      // ignore locked cache files
    }
  }
  return true
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

export async function clearAdobeFontCache(home = os.homedir()): Promise<{
  mac: boolean
  cleared: boolean
}> {
  if (!isMac()) {
    return { mac: false, cleared: false }
  }
  return { mac: true, cleared: applyAdobeFontCacheClear(home) }
}

export async function clearFontCaches(
  options: { office?: boolean; adobe?: boolean } = {},
): Promise<{ mac: boolean; office: boolean; adobe: boolean }> {
  const font = await clearUserFontCache()
  const office =
    options.office === false ? { cleared: false } : await clearOfficeFontCache()
  const adobe = options.adobe === false ? { cleared: false } : await clearAdobeFontCache()
  return { mac: font.mac, office: office.cleared, adobe: adobe.cleared }
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

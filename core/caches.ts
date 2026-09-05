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

export function allowRealCacheMutation(): boolean {
  const isolated = Boolean(process.env.FONT_BUTLER_DATA ?? process.env.FONTCASE_DATA)
  if (!isolated) return true
  return process.env.FONT_BUTLER_NATIVE_CACHES === '1'
}

export async function clearUserFontCache(): Promise<{ mac: boolean; cleared: boolean }> {
  if (!isMac()) {
    return { mac: false, cleared: false }
  }
  const paths = getPaths()
  if (allowRealCacheMutation()) {
    await runQuiet('atsutil', ['databases', '-removeUser'])
    await runQuiet('atsutil', ['server', '-shutdown'])
    await runQuiet('atsutil', ['server', '-ping'])
  }
  if (fs.existsSync(paths.atsCacheDir)) {
    emptyDir(paths.atsCacheDir)
  }
  return { mac: true, cleared: true }
}

export async function clearOfficeFontCache(): Promise<{ mac: boolean; cleared: boolean }> {
  if (!isMac()) {
    return { mac: false, cleared: false }
  }
  if (!allowRealCacheMutation()) {
    const fallback = getPaths().officeFontCacheDir
    if (fs.existsSync(fallback)) {
      emptyDir(fallback)
      return { mac: true, cleared: true }
    }
    return { mac: true, cleared: false }
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
  if (!allowRealCacheMutation()) {
    return { mac: true, cleared: false }
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

const FONT_ENABLE_SCRIPT = `ObjC.import('CoreText')
ObjC.import('Foundation')
function descriptorsFor(filePath) {
  const url = $.NSURL.fileURLWithPath(filePath)
  const ref = $.CTFontManagerCreateFontDescriptorsFromURL(url)
  if (!ref) return null
  try {
    return ObjC.castRefToObject(ref)
  } catch (error) {
    return null
  }
}
function availableUrlSet() {
  const urls = $.CTFontManagerCopyAvailableFontURLs()
  const arr = urls ? ObjC.castRefToObject(urls) : null
  const out = {}
  if (!arr) return out
  const n = Number(arr.count)
  for (let i = 0; i < n; i++) {
    addPathKey(out, ObjC.unwrap(arr.objectAtIndex(i).path))
  }
  return out
}
function addPathKey(out, value) {
  if (!value) return
  const s = String(value)
  out[s] = true
  if (s.startsWith('/private/var/') || s.startsWith('/private/tmp/')) {
    out[s.replace(/^\\/private/, '')] = true
  } else if (s.startsWith('/var/') || s.startsWith('/tmp/')) {
    out['/private' + s] = true
  }
}
function isEnabled(filePath, available) {
  const url = $.NSURL.fileURLWithPath(filePath)
  const candidates = [filePath, ObjC.unwrap(url.path)]
  try {
    candidates.push(ObjC.unwrap(url.URLByStandardizingPath.path))
  } catch (error) {}
  try {
    candidates.push(ObjC.unwrap(url.URLByResolvingSymlinksInPath.path))
  } catch (error) {}
  for (const candidate of candidates) {
    if (candidate && available[String(candidate)]) return true
    if (candidate && String(candidate).startsWith('/var/') && available['/private' + String(candidate)]) return true
    if (candidate && String(candidate).startsWith('/tmp/') && available['/private' + String(candidate)]) return true
    if (candidate && String(candidate).startsWith('/private/var/') && available[String(candidate).replace(/^\\/private/, '')]) return true
    if (candidate && String(candidate).startsWith('/private/tmp/') && available[String(candidate).replace(/^\\/private/, '')]) return true
  }
  return false
}
function registerUrl(filePath, register) {
  const url = $.NSURL.fileURLWithPath(filePath)
  const fn = register ? $.CTFontManagerRegisterFontsForURL : $.CTFontManagerUnregisterFontsForURL
  // Prefer the user/session scope so the Electron renderer and other applications
  // can see the registration after this helper returns. macOS rejects that scope
  // for paths outside the user's font domain (including isolated test paths), so
  // fall back to process scope for those locations. The ensure operation verifies
  // the fallback registration before this helper exits.
  if (Boolean(ObjC.unwrap(fn(url, 2, null)))) return true
  return Boolean(ObjC.unwrap(fn(url, 1, null)))
}
function run(argv) {
  const mode = argv[0]
  if (mode === 'get') {
    const paths = JSON.parse(argv[1] || '[]')
    const available = availableUrlSet()
    const out = {}
    for (const filePath of paths) out[filePath] = isEnabled(filePath, available)
    return JSON.stringify(out)
  }
  if (mode === 'set') {
    const descs = descriptorsFor(argv[1])
    if (!descs || Number(descs.count) === 0) return 'fail'
    $.CTFontManagerEnableFontDescriptors(descs, argv[2] === '1')
    return 'ok'
  }
  if (mode === 'ensure') {
    const filePath = argv[1]
    const enabled = argv[2] === '1'
    if (enabled) registerUrl(filePath, true)
    const descs = descriptorsFor(filePath)
    if (!descs || Number(descs.count) === 0) return 'fail'
    $.CTFontManagerEnableFontDescriptors(descs, enabled)
    const on = isEnabled(filePath, availableUrlSet())
    return on === enabled ? 'ok' : 'fail'
  }
  if (mode === 'register') {
    return registerUrl(argv[1], true) ? 'ok' : 'fail'
  }
  if (mode === 'unregister') {
    return registerUrl(argv[1], false) ? 'ok' : 'fail'
  }
  return '{}'
}
`

async function runFontManager(mode: string, filePath: string, extra: string[] = []): Promise<FontEnableResult> {
  const safePath = assertSafeShellPath(filePath)
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-l', 'JavaScript', '-e', FONT_ENABLE_SCRIPT, mode, safePath, ...extra],
      { timeout: 10_000 },
    )
    if (stdout.trim() !== 'ok') {
      return {
        ok: false,
        native: true,
        error:
          mode === 'register'
            ? 'Could not register the font.'
            : mode === 'unregister'
              ? 'Could not unregister the font.'
              : 'Could not change font activation.',
      }
    }
    return { ok: true, native: true }
  } catch (error) {
    return {
      ok: false,
      native: true,
      error:
        error instanceof Error
          ? error.message
          : mode === 'register'
            ? 'Could not register the font.'
            : mode === 'unregister'
              ? 'Could not unregister the font.'
              : 'Could not change font activation.',
    }
  }
}

export async function registerFont(filePath: string): Promise<FontEnableResult> {
  if (!isMac() || !filePath) {
    return { ok: true, native: false }
  }
  return runFontManager('register', filePath)
}

export async function unregisterFont(filePath: string): Promise<FontEnableResult> {
  if (!isMac() || !filePath) {
    return { ok: true, native: false }
  }
  return runFontManager('unregister', filePath)
}

export type FontEnableResult = {
  ok: boolean
  native: boolean
  error?: string
}

export type ActivationQuery = {
  ok: boolean
  native: boolean
  states: Record<string, boolean>
  error?: string
}

export async function ensureFontActivationNative(
  filePath: string,
  enabled: boolean,
): Promise<FontEnableResult> {
  if (!isMac() || !filePath) {
    return { ok: true, native: false }
  }
  return runFontManager('ensure', filePath, [enabled ? '1' : '0'])
}

export async function setFontEnabled(filePath: string, enabled: boolean): Promise<FontEnableResult> {
  if (!isMac() || !filePath) {
    return { ok: true, native: false }
  }
  return runFontManager('set', filePath, [enabled ? '1' : '0'])
}

export async function fontActivationStates(filePaths: string[]): Promise<ActivationQuery> {
  const states: Record<string, boolean> = {}
  if (!isMac() || filePaths.length === 0) {
    for (const filePath of filePaths) {
      states[filePath] = true
    }
    return { ok: true, native: false, states }
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
        states[filePath] = Boolean(enabled)
      }
    } catch (error) {
      return {
        ok: false,
        native: true,
        states: {},
        error: error instanceof Error ? error.message : 'Could not read font activation.',
      }
    }
  }
  return { ok: true, native: true, states }
}

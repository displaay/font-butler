import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { assertSafeShellPath } from './auth.ts'
import { logMain } from './main-log.ts'
import { parseFontFile } from './parse.ts'
import { getPaths, isMac } from './paths.ts'
import { readAcceptablePostScriptNames, readFontName } from './rename.ts'
import type { AdobeFontCacheInfo, OfficeFontCacheInfo } from './types.ts'
import { isMacUserFontFile } from './user-fonts.ts'

/** Session, then persistent user. Process scope (1) dies with this process and is never used. */
export const REGISTRATION_SCOPES = [3, 2] as const
/** kCTFontManagerErrorAlreadyRegistered */
export const ALREADY_REGISTERED_CODE = 105

export function registrationSucceeded(attempts: Array<{ ok: boolean; code: number }>): boolean {
  return attempts.some((attempt) => attempt.ok || attempt.code === ALREADY_REGISTERED_CODE)
}

/**
 * `atsutil` arguments for a confirmed manual font-cache clear.
 * These delete the user font registry and stop fontd, so user fonts do not
 * activate again until logout. No other caller may receive them.
 */
export const ATSUTIL_CLEAR_COMMANDS: readonly (readonly string[])[] = [
  ['databases', '-removeUser'],
  ['server', '-shutdown'],
  ['server', '-ping'],
]

/** AppleScript that asks macOS to log out. System Events still shows its own confirm. */
export const MAC_LOGOUT_APPLESCRIPT = 'tell application "System Events" to log out'

/** Shown when Font Buttler cannot send the logout Apple event (for example -1743). */
export const LOGOUT_FALLBACK = 'Use Apple menu > Log Out'

/** Shown when the user dismisses the System Events logout confirm (-128). */
export const LOGOUT_CANCELLED = 'Log out was cancelled.'

export const FONT_NOT_VISIBLE_WARNING = 'Not visible to other apps yet'

const VERIFY_BUDGET_MS = 10_000
const VERIFY_INTERVAL_MS = 400

/** A failed fresh-process check that must keep the new file instead of rolling it back. */
export class InstalledFontKept extends Error {
  readonly keepFile = true
  constructor(message: string) {
    super(message)
    this.name = 'InstalledFontKept'
  }
}

export function isKeptInstall(error: unknown): boolean {
  return (
    error instanceof InstalledFontKept ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { keepFile?: boolean }).keepFile === true)
  )
}

export function atsutilCommands(options: { confirm?: boolean } = {}): string[][] {
  if (options.confirm !== true) return []
  return ATSUTIL_CLEAR_COMMANDS.map((args) => [...args])
}

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

export async function clearUserFontCache(
  options: { confirm?: boolean } = {},
): Promise<{ mac: boolean; cleared: boolean }> {
  if (options.confirm !== true) {
    return { mac: isMac(), cleared: false }
  }
  if (!isMac()) {
    return { mac: false, cleared: false }
  }
  const paths = getPaths()
  const commands = atsutilCommands({ confirm: true })
  logMain('install', `atsutil ${commands.map((args) => args.join(' ')).join('; ')}`)
  if (allowRealCacheMutation()) {
    for (const args of commands) {
      await runQuiet('atsutil', args)
    }
  }
  if (fs.existsSync(paths.atsCacheDir)) {
    emptyDir(paths.atsCacheDir)
  }
  return { mac: true, cleared: true }
}

export function logoutResultFromExecError(error: unknown): {
  requested: false
  message: string
  error: string
} {
  const err = error as { message?: string; stderr?: string | Buffer; stdout?: string | Buffer }
  const detail =
    [err?.stderr, err?.stdout, err?.message]
      .map((part) => (Buffer.isBuffer(part) ? part.toString('utf8') : part))
      .filter((part) => typeof part === 'string' && part.trim())
      .join('\n') || String(error)
  logMain('install', `logout failed ${detail}`)
  if (/\(-128\)/.test(detail)) {
    return { requested: false, message: LOGOUT_CANCELLED, error: detail }
  }
  return { requested: false, message: LOGOUT_FALLBACK, error: detail }
}

export async function requestMacLogout(): Promise<{
  requested: boolean
  message?: string
  error?: string
}> {
  if (!isMac()) return { requested: false, message: LOGOUT_FALLBACK }
  if (process.env.FONT_BUTLER_TEST === '1' && process.env.FONT_BUTLER_NATIVE !== '1') {
    return { requested: false, message: LOGOUT_FALLBACK }
  }
  try {
    await execFileAsync('osascript', ['-e', MAC_LOGOUT_APPLESCRIPT], { timeout: 15_000 })
    return { requested: true }
  } catch (error) {
    return logoutResultFromExecError(error)
  }
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
  const office =
    options.office === false ? { cleared: false } : await clearOfficeFontCache()
  const adobe = options.adobe === false ? { cleared: false } : await clearAdobeFontCache()
  return { mac: false, office: office.cleared, adobe: adobe.cleared }
}

export const FONT_ENABLE_SCRIPT = `ObjC.import('CoreText')
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
function pathExists(filePath) {
  return Boolean(ObjC.unwrap($.NSFileManager.defaultManager.fileExistsAtPath(String(filePath))))
}
function isUserFontsDomainPath(filePath) {
  const s = String(filePath)
  if (s.indexOf('/System/Library/Fonts/') >= 0) return false
  if (/\\/Users\\/[^\\/]+\\/Library\\/Fonts\\//.test(s)) return true
  if (/\\/Library\\/Application Support\\/(Font Buttler|Font Butler)\\/user-fonts\\//.test(s)) return true
  // FONT_BUTLER_DATA isolated installs (temp dirs) use .../user-fonts/ as the macOS destination.
  if (s.indexOf('/user-fonts/') >= 0 && s.indexOf('/System/') < 0) return true
  return false
}
function canRenderUserFont(filePath) {
  const descs = descriptorsFor(filePath)
  if (!descs || Number(descs.count) === 0) return false
  const font = $.CTFontCreateWithFontDescriptor(descs.objectAtIndex(0), 12.0, null)
  return font != null
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
  // macOS loads ~/Library/Fonts without listing every file in CTFontManagerCopyAvailableFontURLs.
  // Font Book still treats them as installed; fc-list and CTFontCreate see them. Treat absence from
  // the URL set as inconclusive, not disabled, when the file renders.
  if (isUserFontsDomainPath(filePath) && pathExists(filePath) && canRenderUserFont(filePath)) {
    return true
  }
  return false
}
function isMacUserLibraryFontPath(filePath) {
  const s = String(filePath)
  if (s.indexOf('/System/Library/Fonts/') >= 0) return false
  return /\\/Users\\/[^\\/]+\\/Library\\/Fonts\\//.test(s)
}
function registerAtScopes(filePath, register) {
  if (isMacUserLibraryFontPath(filePath)) return 'skip'
  const url = $.NSURL.fileURLWithPath(filePath)
  const fn = register ? $.CTFontManagerRegisterFontsForURL : $.CTFontManagerUnregisterFontsForURL
  const scopes = ${JSON.stringify([...REGISTRATION_SCOPES])}
  const alreadyRegistered = ${ALREADY_REGISTERED_CODE}
  let lastCode = 0
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i]
    const error = Ref()
    let ok = false
    let code = 0
    try {
      const result = fn(url, scope, error)
      if (result === true || result === 1) ok = true
      else if (result === false || result === 0 || result == null) ok = false
      else {
        try { ok = Boolean(ObjC.unwrap(result)) } catch (unwrapError) { ok = Boolean(result) }
      }
    } catch (callError) {
      ok = false
    }
    try {
      const err = error[0]
      if (err) {
        let nsError = err
        try { nsError = ObjC.castRefToObject(err) } catch (castError) { nsError = err }
        const raw = nsError.code
        code = Number(raw && raw.js ? ObjC.unwrap(raw) : raw)
        if (!isFinite(code)) code = 0
      }
    } catch (readError) {
      code = 0
    }
    if (ok) return 'ok:0:' + scope
    if (register && code === alreadyRegistered) return 'ok:' + alreadyRegistered + ':' + scope
    lastCode = code
  }
  return 'fail:' + lastCode
}
function run(argv) {
  const mode = argv[0]
  if (mode === 'available') {
    return JSON.stringify(availableUrlSet())
  }
  if (mode === 'get') {
    const paths = JSON.parse(argv[1] || '[]')
    const available = availableUrlSet()
    const out = {}
    for (const filePath of paths) out[filePath] = isEnabled(filePath, available)
    return JSON.stringify(out)
  }
  if (mode === 'get-with') {
    const paths = JSON.parse(argv[1] || '[]')
    const available = JSON.parse(argv[2] || '{}')
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
    if (isMacUserLibraryFontPath(filePath)) return 'skip'
    if (enabled) {
      const registered = registerAtScopes(filePath, true)
      if (String(registered).indexOf('fail') === 0) return registered
    } else {
      registerAtScopes(filePath, false)
    }
    const descs = descriptorsFor(filePath)
    if (!descs || Number(descs.count) === 0) return 'fail'
    $.CTFontManagerEnableFontDescriptors(descs, enabled)
    if (isUserFontsDomainPath(filePath)) {
      if (!enabled) return 'ok'
      if (pathExists(filePath) && canRenderUserFont(filePath)) return 'ok'
    }
    const on = isEnabled(filePath, availableUrlSet())
    return on === enabled ? 'ok' : 'fail'
  }
  if (mode === 'register') {
    return registerAtScopes(argv[1], true)
  }
  if (mode === 'unregister') {
    return registerAtScopes(argv[1], false)
  }
  return '{}'
}
`

export function fontManagerSucceeded(stdout: string): boolean {
  const text = stdout.trim()
  if (text === 'ok' || text === 'skip' || text.startsWith('ok:')) return true
  const fail = /^fail:(-?\d+)/.exec(text)
  if (fail && registrationSucceeded([{ ok: false, code: Number(fail[1]) }])) return true
  return false
}

function fontManagerError(mode: string, detail: string): string {
  if (detail.startsWith('fail')) {
    if (mode === 'register') return `Could not register the font (${detail}).`
    if (mode === 'unregister') return `Could not unregister the font (${detail}).`
    return `Could not change font activation (${detail}).`
  }
  if (mode === 'register') return 'Could not register the font.'
  if (mode === 'unregister') return 'Could not unregister the font.'
  return 'Could not change font activation.'
}

async function runFontManager(mode: string, filePath: string, extra: string[] = []): Promise<FontEnableResult> {
  const safePath = assertSafeShellPath(filePath)
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-l', 'JavaScript', '-e', FONT_ENABLE_SCRIPT, mode, safePath, ...extra],
      { timeout: 10_000 },
    )
    const detail = stdout.trim()
    logMain('register', `${mode} ${safePath} ${detail}`)
    if (!fontManagerSucceeded(detail)) {
      return { ok: false, native: true, error: fontManagerError(mode, detail) }
    }
    return { ok: true, native: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : fontManagerError(mode, '')
    logMain('register', `${mode} ${safePath} error ${message}`)
    return { ok: false, native: true, error: message }
  }
}

export async function registerFont(filePath: string): Promise<FontEnableResult> {
  if (!isMac() || !filePath) {
    return { ok: true, native: false }
  }
  if (isMacUserFontFile(filePath)) {
    logMain('register', `skip register ${filePath}`)
    return { ok: true, native: false }
  }
  return runFontManager('register', filePath)
}

export async function unregisterFont(filePath: string): Promise<FontEnableResult> {
  if (!isMac() || !filePath) {
    return { ok: true, native: false }
  }
  if (isMacUserFontFile(filePath)) {
    logMain('register', `skip unregister ${filePath}`)
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
  let availableKeys: Record<string, true>
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-l', 'JavaScript', '-e', FONT_ENABLE_SCRIPT, 'available'],
      { timeout: 60_000 },
    )
    availableKeys = JSON.parse(stdout.trim() || '{}') as Record<string, true>
  } catch (error) {
    return {
      ok: false,
      native: true,
      states: {},
      error: error instanceof Error ? error.message : 'Could not read font activation.',
    }
  }
  const chunkSize = 200
  const availableJson = JSON.stringify(availableKeys)
  for (let index = 0; index < safe.length; index += chunkSize) {
    const chunk = safe.slice(index, index + chunkSize)
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-l', 'JavaScript', '-e', FONT_ENABLE_SCRIPT, 'get-with', JSON.stringify(chunk), availableJson],
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

export type ActivatedFontLookup = {
  ok: boolean
  postscript: string
  family: string
  version: string
  path: string
  listed: boolean
  error?: string
}

export const FONT_LOOKUP_SCRIPT = `ObjC.import('CoreText')
ObjC.import('Foundation')
ObjC.import('AppKit')
function objcString(value) {
  if (value == null) return ''
  try { return String(ObjC.unwrap(ObjC.castRefToObject(value)) || '') }
  catch (error) {
    try { return String(ObjC.unwrap(value) || '') } catch (fallback) { throw error }
  }
}
function miss(reason, extra) {
  const body = extra || {}
  body.ok = false
  body.reason = String(reason)
  if (!body.postscript) body.postscript = ''
  if (!body.family) body.family = ''
  if (!body.version) body.version = ''
  if (!body.path) body.path = ''
  if (body.listed !== true) body.listed = false
  return JSON.stringify(body)
}
function run(argv) {
  const psName = String(argv[0] || '')
  let font = null
  try {
    font = $.CTFontCreateWithName($(psName), 12, null)
  } catch (error) {
    return miss(error)
  }
  if (!font) return miss('missing')
  let actual = ''
  let family = ''
  try {
    actual = objcString($.CTFontCopyPostScriptName(font))
    family = objcString($.CTFontCopyFamilyName(font))
  } catch (error) {
    return miss(error)
  }
  let version = ''
  try {
    version = objcString($.CTFontCopyName(font, $.kCTFontVersionNameKey))
  } catch (error) {
    return miss(error, { postscript: actual, family: family })
  }
  const found = { postscript: actual, family: family, version: version }
  let filePath = ''
  try {
    const nsFont = $.NSFont.fontWithNameSize($(psName), 12)
    if (!nsFont) return miss('NSFont could not open ' + psName, found)
    const url = nsFont.fontDescriptor.objectForKey('NSCTFontFileURLAttribute')
    if (!url || url.path == null) return miss('NSFont has no file URL for ' + psName, found)
    filePath = String(ObjC.unwrap(url.path) || '')
    if (!filePath) return miss('NSFont file URL for ' + psName + ' was empty', found)
  } catch (error) {
    return miss(error, found)
  }
  let listed = false
  try {
    const families = $.CTFontManagerCopyAvailableFontFamilyNames()
    const arr = families ? ObjC.castRefToObject(families) : null
    if (arr) {
      const n = Number(arr.count)
      for (let i = 0; i < n; i++) {
        if (String(ObjC.unwrap(arr.objectAtIndex(i))) === family) {
          listed = true
          break
        }
      }
    }
  } catch (error) {
    return miss(error, { postscript: actual, family: family, version: version, path: filePath })
  }
  return JSON.stringify({
    ok: true,
    postscript: actual,
    family: family,
    version: version,
    path: filePath,
    listed: listed
  })
}
`

export function fontPathsMatch(left: string, right: string): boolean {
  const normalize = (value: string) => {
    if (!value) return ''
    let resolved = path.resolve(value)
    try {
      resolved = fs.realpathSync(resolved)
    } catch {
      // Keep the path we were given when the file is already gone.
    }
    if (resolved.startsWith('/private/var/') || resolved.startsWith('/private/tmp/')) {
      return resolved.slice('/private'.length)
    }
    return resolved
  }
  const a = normalize(left)
  const b = normalize(right)
  return Boolean(a) && a === b
}

export function nativeFontVerificationEnabled(): boolean {
  if (!isMac()) return false
  if (process.env.FONT_BUTLER_TEST === '1' && process.env.FONT_BUTLER_NATIVE !== '1') return false
  return true
}

export function versionsMatch(reported: string, expected: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ')
  const actual = normalize(reported)
  const wanted = normalize(expected)
  if (!actual || !wanted) return true
  if (actual.toLowerCase() === wanted.toLowerCase()) return true
  const strip = (value: string) => value.replace(/^version\s+/i, '').trim()
  return strip(actual).toLowerCase() === strip(wanted).toLowerCase()
}

export async function lookupActivatedFont(postscriptName: string): Promise<ActivatedFontLookup> {
  const empty: ActivatedFontLookup = {
    ok: false,
    postscript: '',
    family: '',
    version: '',
    path: '',
    listed: false,
  }
  if (!postscriptName.trim()) {
    return { ...empty, error: 'The font has no PostScript name.' }
  }
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-l', 'JavaScript', '-e', FONT_LOOKUP_SCRIPT, postscriptName],
      { timeout: 20_000 },
    )
    const parsed = JSON.parse(stdout.trim() || '{}') as Partial<ActivatedFontLookup> & { reason?: string }
    const reason = parsed.reason ? String(parsed.reason) : ''
    return {
      ok: Boolean(parsed.ok),
      postscript: String(parsed.postscript || ''),
      family: String(parsed.family || ''),
      version: String(parsed.version || ''),
      path: String(parsed.path || ''),
      listed: Boolean(parsed.listed),
      error: parsed.ok ? undefined : reason || 'Could not look up the font.',
    }
  } catch (error) {
    const err = error as { message?: string; stderr?: string | Buffer; stdout?: string | Buffer }
    const detail =
      [err?.stderr, err?.stdout, err?.message]
        .map((part) => (Buffer.isBuffer(part) ? part.toString('utf8') : part))
        .filter((part) => typeof part === 'string' && part.trim())
        .join('\n') || 'Could not look up the font.'
    return {
      ...empty,
      error: detail,
    }
  }
}

function waitForFont(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Ask a fresh process which file Core Text serves for this PostScript name.
 * Retries so fontd can notice a renamed file in ~/Library/Fonts.
 */
export async function awaitActivatedFont(
  postscriptName: string,
  filePath: string,
  options: { version?: string; attempts?: number } = {},
): Promise<ActivatedFontLookup> {
  const attempts = options.attempts ?? 20
  let last: ActivatedFontLookup = {
    ok: false,
    postscript: '',
    family: '',
    version: '',
    path: '',
    listed: false,
    error: 'Could not look up the font.',
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await lookupActivatedFont(postscriptName)
    const versionOk = !options.version || versionsMatch(last.version, options.version)
    if (
      last.ok &&
      last.postscript === postscriptName &&
      last.listed &&
      fontPathsMatch(last.path, filePath) &&
      versionOk
    ) {
      return last
    }
    if (attempt + 1 < attempts) await waitForFont(400)
  }
  return last
}

function keptVerificationError(filePath: string, message: string, keep: boolean): Error {
  const userFont = isMacUserFontFile(filePath)
  if (!(keep || userFont)) return new Error(message)
  const anotherCopy = /already served/.test(message)
  const text =
    userFont && !anotherCopy && !/not visible to other apps yet/i.test(message)
      ? `${message} The font is ${FONT_NOT_VISIBLE_WARNING.toLowerCase()}.`
      : message
  return new InstalledFontKept(text)
}

/**
 * Faces that have a PostScript name, keyed by their original collection index.
 * Filtering first would renumber a later face and read the wrong name table.
 */
export function verificationFaceChecks(
  filePath: string,
  faces: Array<{ postscriptName: string }>,
): Array<{ index: number; ps: string; acceptable: Set<string>; version: string }> {
  return faces.flatMap((face, index) => {
    const ps = face.postscriptName.trim()
    if (!ps) return []
    return [
      {
        index,
        ps,
        acceptable: new Set([ps, ...readAcceptablePostScriptNames(filePath, index)]),
        version: readFontName(filePath, 5, index),
      },
    ]
  })
}

export async function verifyInstalledFont(filePath: string): Promise<void> {
  if (!nativeFontVerificationEnabled()) {
    logMain('verify', `skip ${filePath}`)
    return
  }
  // Stay on the catalog queue. The check is capped at VERIFY_BUDGET_MS, and
  // releasing the queue here lets another task save over this one.
  await verifyInstalledFontNow(filePath)
}

async function verifyInstalledFontNow(filePath: string): Promise<void> {
  const parsed = parseFontFile(filePath)
  const checks = verificationFaceChecks(filePath, parsed.faces)
  if (checks.length === 0) {
    const message = 'Could not read a PostScript name from the installed font.'
    logMain('verify', `fail ${filePath} ${message}`)
    throw keptVerificationError(filePath, message, false)
  }
  const userFont = isMacUserFontFile(filePath)
  const deadline = Date.now() + VERIFY_BUDGET_MS
  let lastError = 'Core Text did not activate the installed font.'
  let lastKeep = userFont
  while (true) {
    let failed = ''
    let keep = userFont
    for (const check of checks) {
      const lookup = await lookupActivatedFont(check.ps)
      logMain(
        'verify',
        `${check.ps} -> ps=${lookup.postscript || '?'} path=${lookup.path || '?'} version=${lookup.version || '?'} listed=${lookup.listed} file=${filePath}`,
      )
      if (!lookup.ok) {
        failed = lookup.error || `Core Text did not resolve ${check.ps}.`
        keep = userFont
        break
      }
      if (!check.acceptable.has(lookup.postscript)) {
        const fallback = /helvetica/i.test(lookup.postscript) || /helvetica/i.test(lookup.path)
        failed = fallback
          ? `Core Text resolved ${check.ps} to a fallback font (${lookup.postscript || lookup.path}).`
          : `Core Text resolved ${check.ps} to ${lookup.postscript || 'another font'} instead of the installed file.`
        keep = userFont
        break
      }
      if (!fontPathsMatch(lookup.path, filePath)) {
        failed = `${check.ps} is already served from ${lookup.path || 'another file'}. The installed file was kept.`
        keep = true
        break
      }
      if (check.version && lookup.version && !versionsMatch(lookup.version, check.version)) {
        failed = `Core Text is serving ${lookup.version} for ${check.ps}, not ${check.version}.`
        keep = userFont
        break
      }
    }
    if (!failed) {
      logMain('verify', `ok ${filePath}`)
      return
    }
    lastError = failed
    lastKeep = keep
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await waitForFont(Math.min(VERIFY_INTERVAL_MS, remaining))
  }
  logMain('verify', `fail ${filePath} ${lastError}`)
  throw keptVerificationError(filePath, lastError, lastKeep)
}

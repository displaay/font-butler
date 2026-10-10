import { AsyncLocalStorage } from 'node:async_hooks'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { assertSafeShellPath } from './auth.ts'
import { loadBuildIdentity } from './build-identity.ts'
import { logMain } from './main-log.ts'
import { parseFontFile } from './parse.ts'
import { getPaths, isMac } from './paths.ts'
import { readAcceptablePostScriptNames, readFilePostScriptNames, readFontName } from './rename.ts'
import type { AdobeFontCacheInfo, OfficeFontCacheInfo } from './types.ts'
import { isMacUserFontFile, macUserFontsRoot } from './user-fonts.ts'
import {
  LOGOUT_CANCELLED,
  LOGOUT_FAILED_MESSAGE,
  LOGOUT_FAILED_TITLE,
  LOGOUT_FALLBACK,
  LOGOUT_PROBE_WOULD_START_NOTICE,
  LOGOUT_STILL_WAITING_MESSAGE,
} from '../shared/logout.ts'

export {
  LOGOUT_CANCELLED,
  LOGOUT_FAILED_MESSAGE,
  LOGOUT_FAILED_TITLE,
  LOGOUT_FALLBACK,
  LOGOUT_PROBE_WOULD_START_NOTICE,
  LOGOUT_STILL_WAITING_MESSAGE,
}

/** Session, then persistent user. Process scope (1) dies with this process and is never used. */
export const REGISTRATION_SCOPES = [3, 2] as const
/** kCTFontManagerErrorAlreadyRegistered */
export const ALREADY_REGISTERED_CODE = 105
/** kCTFontManagerErrorNotRegistered. After logout the session registration is already gone. */
export const NOT_REGISTERED_CODE = 201

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

/**
 * Harmless System Events event for the test-build logout probe.
 * `count processes` is a real Apple event, so macOS shows the Automation prompt.
 * It returns -1743 on Don't Allow. It never logs the user out.
 */
export const MAC_LOGOUT_PROBE_APPLESCRIPT = 'tell application "System Events" to count processes'

/**
 * How long to wait for an immediate Apple-event failure before treating an
 * open logout confirm as accepted. The confirm itself is left running.
 */
export const LOGOUT_ACCEPT_MS = 1_000

/**
 * How long osascript may sit unanswered before we say we are still waiting.
 * This does not kill the process: the user may still click Allow.
 */
export const LOGOUT_STILL_WAITING_MS = 30_000

export const FONT_NOT_VISIBLE_WARNING = 'Not visible to other apps yet'

const VERIFY_BUDGET_MS = 10_000
const VERIFY_INTERVAL_MS = 400
/** One lookup must not outlive the verification budget while the catalog queue is held. */
export const LOOKUP_ATTEMPT_MS = 3_000
const LOOKUP_DIRECT_TIMEOUT_MS = 20_000

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

type CacheToolExec = (
  file: string,
  args: readonly string[],
  options: { timeout?: number },
  callback: (error: Error | null) => void,
) => unknown

let cacheToolExec: CacheToolExec = (file, args, options, callback) => {
  execFile(file, [...args], options, callback)
}

/** Tests replace the process spawn used for atsutil. Production uses `execFile`. */
export function setCacheToolExecForTests(exec: CacheToolExec | null): void {
  cacheToolExec = exec ?? ((file, args, options, callback) => execFile(file, [...args], options, callback))
}

async function runQuiet(command: string, args: string[]): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      cacheToolExec(command, args, { timeout: 15_000 }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
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

function cacheDataIsIsolated(): boolean {
  return Boolean(process.env.FONT_BUTLER_DATA ?? process.env.FONTCASE_DATA)
}

/**
 * Live cache tools stay off for a stamped test build.
 * `FONT_BUTLER_NATIVE_CACHES=1` cannot turn them back on, and a missing
 * `FONT_BUTLER_DATA` cannot either. Callers still pass their own testBuild flag.
 */
export function allowRealCacheMutation(): boolean {
  if (loadBuildIdentity().testBuild === true) return false
  if (!cacheDataIsIsolated()) return true
  return process.env.FONT_BUTLER_NATIVE_CACHES === '1'
}

export const ATSUTIL_SKIPPED_LOG = 'atsutil skipped; font caches were not cleared'

export function userFontCacheClearOutcome(input: {
  mac: boolean
  confirmed: boolean
  allowMutation: boolean
  testBuild?: boolean
}): { mac: boolean; cleared: boolean; simulated?: boolean; runAtsutil: boolean } {
  if (!input.confirmed) return { mac: input.mac, cleared: false, runAtsutil: false }
  if (!input.mac) return { mac: false, cleared: false, runAtsutil: false }
  // Caller-level defense. allowRealCacheMutation() also refuses a stamped test build.
  if (input.testBuild === true || !input.allowMutation) {
    return { mac: true, cleared: false, simulated: true, runAtsutil: false }
  }
  return { mac: true, cleared: true, runAtsutil: true }
}

let userFontCacheHostMac: boolean | null = null

/** Tests pretend the host is macOS so a missing testBuild guard would call atsutil. */
export function setUserFontCacheHostMacForTests(mac: boolean | null): void {
  userFontCacheHostMac = mac
}

export async function clearUserFontCache(
  options: { confirm?: boolean } = {},
): Promise<{ mac: boolean; cleared: boolean; simulated?: boolean }> {
  const outcome = userFontCacheClearOutcome({
    mac: userFontCacheHostMac ?? isMac(),
    confirmed: options.confirm === true,
    allowMutation: allowRealCacheMutation(),
    testBuild: loadBuildIdentity().testBuild === true,
  })
  if (!outcome.runAtsutil) {
    if (outcome.simulated) logMain('install', ATSUTIL_SKIPPED_LOG)
    return { mac: outcome.mac, cleared: outcome.cleared, simulated: outcome.simulated }
  }
  const paths = getPaths()
  const commands = atsutilCommands({ confirm: true })
  logMain('install', `atsutil ${commands.map((args) => args.join(' ')).join('; ')}`)
  for (const args of commands) {
    await runQuiet('atsutil', args)
  }
  if (fs.existsSync(paths.atsCacheDir)) {
    emptyDir(paths.atsCacheDir)
  }
  return { mac: true, cleared: true }
}

export function logoutResultFromExecError(error: unknown): {
  requested: false
  cancelled?: boolean
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
    return { requested: false, cancelled: true, message: LOGOUT_CANCELLED, error: detail }
  }
  return { requested: false, message: LOGOUT_FAILED_MESSAGE, error: detail }
}

export type MacLogoutResult = {
  requested: boolean
  /** True only for the System Events confirm dismissal (-128). */
  cancelled?: boolean
  message?: string
  error?: string
  /** Allow on the test-build probe. Logout was not started. */
  probeAllowed?: boolean
}

type LogoutExec = (
  file: string,
  args: readonly string[],
  callback: (error: unknown) => void,
) => { unref?: () => void }

let macLogoutExec: LogoutExec = execFile

/** Tests replace osascript. Production uses `execFile`. */
export function setMacLogoutExecForTests(exec: LogoutExec | null): void {
  macLogoutExec = exec ?? execFile
}

/**
 * Start osascript with no kill timer. A long Automation prompt must stay alive
 * so a later Allow click can still log out.
 */
export function startMacLogoutProcess(exec: LogoutExec, report: (result: MacLogoutResult) => void): void {
  const child = exec('osascript', ['-e', MAC_LOGOUT_APPLESCRIPT], (error) => {
    if (error) report(logoutResultFromExecError(error))
    else report({ requested: true })
  })
  child?.unref?.()
}

/**
 * Start the logout Apple event without waiting for the confirm dialog.
 * An immediate failure (-128, -1743) is reported. If the dialog is still
 * open after the accept window, the request was accepted. A later wait
 * notice does not mean logout failed, and it does not stop osascript.
 */
export function awaitMacLogoutRequest(
  start: (report: (result: MacLogoutResult) => void) => void,
  acceptAfterMs = LOGOUT_ACCEPT_MS,
  onLateFailure?: (result: MacLogoutResult) => void,
  options?: {
    stillWaitingAfterMs?: number
    onStillWaiting?: (message: string) => void
    onLateSuccess?: (result: MacLogoutResult) => void
  },
): Promise<MacLogoutResult> {
  const stillWaitingAfterMs = options?.stillWaitingAfterMs ?? LOGOUT_STILL_WAITING_MS
  const onStillWaiting = options?.onStillWaiting
  const onLateSuccess = options?.onLateSuccess
  return new Promise((resolve) => {
    let settled = false
    let execFinished = false
    let failureDelivered = false
    const deliverExec = (result: MacLogoutResult) => {
      if (execFinished) return
      execFinished = true
      clearTimeout(waitTimer)
      if (settled) {
        logMain('install', `logout settled after accept ${result.message || ''} ${result.error || ''}`.trim())
        if (result.requested === false && result.cancelled !== true && !failureDelivered) {
          failureDelivered = true
          onLateFailure?.(result)
        } else if (result.requested === true) {
          onLateSuccess?.(result)
        }
        return
      }
      settled = true
      clearTimeout(acceptTimer)
      logMain(
        'install',
        `logout result requested=${result.requested}${result.cancelled ? ' cancelled' : ''}${result.message ? ` ${result.message}` : ''}${result.error ? ` ${result.error}` : ''}`.trim(),
      )
      resolve(result)
    }
    const acceptTimer = setTimeout(() => {
      if (settled) return
      settled = true
      logMain('install', 'logout result requested=true')
      resolve({ requested: true })
    }, acceptAfterMs)
    const waitTimer = setTimeout(() => {
      if (execFinished) return
      logMain('install', `logout still waiting ${LOGOUT_STILL_WAITING_MESSAGE}`)
      onStillWaiting?.(LOGOUT_STILL_WAITING_MESSAGE)
    }, stillWaitingAfterMs)
    if (typeof acceptTimer.unref === 'function') acceptTimer.unref()
    if (typeof waitTimer.unref === 'function') waitTimer.unref()
    start(deliverExec)
  })
}

type LogoutFlight = {
  accepted: Promise<MacLogoutResult>
  finished: Promise<void>
}

let logoutFlight: LogoutFlight | null = null

export function resetSharedMacLogout(): void {
  logoutFlight = null
}

/**
 * One osascript at a time. A second request joins the in-flight promise until
 * that process reports, including after the accept window has already resolved.
 */
export function shareMacLogout(
  start: (report: (result: MacLogoutResult) => void) => void,
  onLateFailure?: (result: MacLogoutResult) => void,
  onStillWaiting?: (message: string) => void,
  acceptAfterMs = LOGOUT_ACCEPT_MS,
): Promise<MacLogoutResult> {
  if (logoutFlight) return logoutFlight.accepted
  let markFinished = () => {}
  const finished = new Promise<void>((resolve) => {
    markFinished = resolve
  })
  const accepted = awaitMacLogoutRequest(
    (report) => {
      start((result) => {
        report(result)
        markFinished()
      })
    },
    acceptAfterMs,
    onLateFailure,
    { onStillWaiting },
  )
  const flight: LogoutFlight = { accepted, finished }
  logoutFlight = flight
  void finished.finally(() => {
    if (logoutFlight === flight) logoutFlight = null
  })
  return accepted
}

export async function requestMacLogout(
  onLateFailure?: (result: MacLogoutResult) => void,
  onStillWaiting?: (message: string) => void,
  onSimulated?: (message: string) => void,
): Promise<MacLogoutResult> {
  const identity = loadBuildIdentity()
  // Lowest logout gate. Every caller, including a future one, runs the probe.
  if (identity.testBuild === true) {
    return requestLogoutProbe(identity, {
      exec: macLogoutExec,
      onLateFailure,
      onStillWaiting,
      onSimulated,
    })
  }
  if (!isMac()) return { requested: false, message: LOGOUT_FAILED_MESSAGE }
  if (process.env.FONT_BUTLER_TEST === '1' && process.env.FONT_BUTLER_NATIVE !== '1') {
    return { requested: false, message: LOGOUT_FAILED_MESSAGE }
  }
  logMain('install', 'logout request')
  return shareMacLogout(
    (report) => startMacLogoutProcess(macLogoutExec, report),
    onLateFailure,
    onStillWaiting,
  )
}

export type LogoutProbeResult = MacLogoutResult & { ignored?: boolean }

type LogoutProbeHooks = {
  exec?: LogoutExec
  onLateFailure?: (result: MacLogoutResult) => void
  onStillWaiting?: (message: string) => void
  onSimulated?: (message: string) => void
  acceptAfterMs?: number
  stillWaitingAfterMs?: number
}

let probeFlight: LogoutFlight | null = null

export function resetLogoutProbe(): void {
  probeFlight = null
}

/**
 * Test-build stand-in for logout. `testBuild: true` in build-identity.json is
 * the only switch. The Apple event is `count processes`, and its result goes through
 * the same accept window, still-waiting notice, and late-failure path as
 * requestMacLogout. Allow shows that logout would start, without starting it.
 */
export function requestLogoutProbe(
  identity: { testBuild?: boolean } | null | undefined,
  hooks: LogoutProbeHooks = {},
): Promise<LogoutProbeResult> {
  if (identity?.testBuild !== true) {
    return Promise.resolve({ requested: false, ignored: true })
  }
  if (probeFlight) return probeFlight.accepted
  const exec = hooks.exec ?? macLogoutExec
  let noted = false
  const noteAllowed = () => {
    if (noted) return
    noted = true
    hooks.onSimulated?.(LOGOUT_PROBE_WOULD_START_NOTICE)
  }
  let markFinished = () => {}
  const finished = new Promise<void>((resolve) => {
    markFinished = resolve
  })
  logMain('install', 'logout probe request')
  const accepted = awaitMacLogoutRequest(
    (report) => {
      try {
        const child = exec('osascript', ['-e', MAC_LOGOUT_PROBE_APPLESCRIPT], (error) => {
          if (error) report(logoutResultFromExecError(error))
          else {
            report({
              requested: true,
              probeAllowed: true,
              message: LOGOUT_PROBE_WOULD_START_NOTICE,
            })
          }
          markFinished()
        })
        child?.unref?.()
      } catch (error) {
        report(logoutResultFromExecError(error))
        markFinished()
      }
    },
    hooks.acceptAfterMs ?? LOGOUT_ACCEPT_MS,
    hooks.onLateFailure,
    {
      stillWaitingAfterMs: hooks.stillWaitingAfterMs ?? LOGOUT_STILL_WAITING_MS,
      onStillWaiting: hooks.onStillWaiting,
      onLateSuccess: () => noteAllowed(),
    },
  )
  const flight: LogoutFlight = { accepted, finished }
  probeFlight = flight
  void finished.finally(() => {
    if (probeFlight === flight) probeFlight = null
  })
  return accepted
}

export async function clearOfficeFontCache(): Promise<{ mac: boolean; cleared: boolean }> {
  if (!isMac()) {
    return { mac: false, cleared: false }
  }
  if (!allowRealCacheMutation()) {
    // The fallback path is the live Office Group Container unless data is isolated.
    if (!cacheDataIsIsolated()) return { mac: true, cleared: false }
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
    if (!enabled) return registerAtScopes(filePath, false)
    const registered = registerAtScopes(filePath, true)
    if (String(registered).indexOf('fail') === 0) return registered
    const descs = descriptorsFor(filePath)
    if (!descs || Number(descs.count) === 0) return 'fail'
    $.CTFontManagerEnableFontDescriptors(descs, true)
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

/** Unregister may report 105 or 201 when this process no longer holds the registration. */
export function unregisterSucceeded(stdout: string): boolean {
  if (fontManagerSucceeded(stdout)) return true
  const fail = /^fail:(-?\d+)/.exec(stdout.trim())
  if (!fail) return false
  const code = Number(fail[1])
  return code === NOT_REGISTERED_CODE || code === ALREADY_REGISTERED_CODE
}

export function unregisterErrorIsAlreadyGone(error: string | undefined): boolean {
  return new RegExp(`fail:(?:${NOT_REGISTERED_CODE}|${ALREADY_REGISTERED_CODE})\\b`).test(error || '')
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
    const succeeded = mode === 'unregister' ? unregisterSucceeded(detail) : fontManagerSucceeded(detail)
    if (!succeeded) {
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
  timedOut?: boolean
}

export const FONT_LOOKUP_SCRIPT = `ObjC.import('CoreText')
ObjC.import('Foundation')
ObjC.import('AppKit')
function fail(error) {
  let message = 'Font lookup failed.'
  try {
    if (typeof error === 'string' && error.trim()) message = error.trim()
    else if (error && error.message) message = String(error.message)
    else if (error != null) message = String(error)
  } catch (stringifyError) {
    message = 'Font lookup failed.'
  }
  message = String(message).replace(/\\s+/g, ' ').trim() || 'Font lookup failed.'
  return 'fail:' + message
}
function objcString(value) {
  if (value == null) return ''
  return String(ObjC.unwrap(ObjC.castRefToObject(value)) || '')
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
function lookupFont(psName) {
  const font = $.CTFontCreateWithName($(psName), 12, null)
  if (!font) return miss('missing')
  const actual = objcString($.CTFontCopyPostScriptName(font))
  const family = objcString($.CTFontCopyFamilyName(font))
  const version = objcString($.CTFontCopyName(font, $.kCTFontVersionNameKey))
  const found = { postscript: actual, family: family, version: version }
  const nsFont = $.NSFont.fontWithNameSize($(psName), 12)
  if (!nsFont || nsFont.isNil()) return miss('NSFont could not open ' + psName, found)
  const url = nsFont.fontDescriptor.objectForKey('NSCTFontFileURLAttribute')
  if (!url || url.isNil() || url.path == null) return miss('NSFont has no file URL for ' + psName, found)
  const filePath = String(ObjC.unwrap(url.path) || '')
  if (!filePath) return miss('NSFont file URL for ' + psName + ' was empty', found)
  let listed = false
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
  return JSON.stringify({
    ok: true,
    postscript: actual,
    family: family,
    version: version,
    path: filePath,
    listed: listed
  })
}
function run(argv) {
  try {
    return lookupFont(String(argv[0] || ''))
  } catch (error) {
    return fail(error)
  }
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

const emptyLookup = (): ActivatedFontLookup => ({
  ok: false,
  postscript: '',
  family: '',
  version: '',
  path: '',
  listed: false,
})

/** A script or bridge failure. This is not a "font not visible yet" result. */
export function brokenLookupMessage(detail: string): string {
  const line = detail
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean) || 'Font lookup failed.'
  return line.startsWith('fail:') ? line : `fail:${line}`
}

export function parseActivatedFontLookup(stdout: string, postscriptName = ''): ActivatedFontLookup {
  const text = stdout.trim()
  if (!text || text.startsWith('fail:') || !text.startsWith('{')) {
    const message = brokenLookupMessage(text || 'Font lookup returned nothing.')
    logMain('verify', `lookup ${postscriptName} ${message}`)
    return { ...emptyLookup(), error: message }
  }
  try {
    const parsed = JSON.parse(text) as Partial<ActivatedFontLookup> & { reason?: string }
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
    const message = brokenLookupMessage(error instanceof Error ? error.message : 'Could not read the font lookup.')
    logMain('verify', `lookup ${postscriptName} ${message}`)
    return { ...emptyLookup(), error: message }
  }
}

function execTimedOut(error: unknown): boolean {
  const err = error as { killed?: boolean; code?: string; message?: string }
  return err?.killed === true || err?.code === 'ETIMEDOUT' || /timed out/i.test(err?.message || '')
}

export async function lookupActivatedFont(
  postscriptName: string,
  options: { timeoutMs?: number } = {},
): Promise<ActivatedFontLookup> {
  if (!postscriptName.trim()) {
    return { ...emptyLookup(), error: 'The font has no PostScript name.' }
  }
  const timeout = options.timeoutMs ?? LOOKUP_DIRECT_TIMEOUT_MS
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-l', 'JavaScript', '-e', FONT_LOOKUP_SCRIPT, postscriptName],
      { timeout },
    )
    return parseActivatedFontLookup(stdout, postscriptName)
  } catch (error) {
    const err = error as { message?: string; stderr?: string | Buffer; stdout?: string | Buffer }
    const stdout = Buffer.isBuffer(err?.stdout) ? err.stdout.toString('utf8') : err?.stdout
    if (typeof stdout === 'string' && stdout.trim().startsWith('fail:')) {
      return parseActivatedFontLookup(stdout, postscriptName)
    }
    if (execTimedOut(error)) {
      const message = 'fail:Font lookup timed out.'
      logMain('verify', `lookup ${postscriptName} ${message}`)
      return { ...emptyLookup(), error: message, timedOut: true }
    }
    const detail =
      [err?.stderr, err?.stdout, err?.message]
        .map((part) => (Buffer.isBuffer(part) ? part.toString('utf8') : part))
        .filter((part) => typeof part === 'string' && part.trim())
        .join('\n') || 'Could not look up the font.'
    const message = brokenLookupMessage(detail)
    logMain('verify', `lookup ${postscriptName} ${message}`)
    return { ...emptyLookup(), error: message }
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

export function installedFontCheckError(filePath: string, message: string, keep: boolean): Error {
  if (message.startsWith('fail:')) {
    if (isMacUserFontFile(filePath)) {
      const text = /not visible to other apps yet/i.test(message)
        ? message
        : `${message} The font is ${FONT_NOT_VISIBLE_WARNING.toLowerCase()}.`
      logMain('verify', `kept ${filePath} ${text}`)
      return new InstalledFontKept(text)
    }
    logMain('verify', `fail ${filePath} ${message}`)
    return new Error(message)
  }
  return keptVerificationError(filePath, message, keep)
}

function keptVerificationError(filePath: string, message: string, keep: boolean): Error {
  const userFont = isMacUserFontFile(filePath)
  if (!(keep || userFont)) return new Error(message)
  const anotherCopy = isDuplicateCopyWarning(message)
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

const USER_FONT_COPY_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc'])

type VerificationBatch = {
  deadline: number
  now: () => number
  /** Set after one walk, including a walk that stopped at the deadline. */
  scanned: boolean
  /** PostScript name to every file that produced it during this batch's walk. */
  byName: Map<string, string[]>
}

const verificationBatch = new AsyncLocalStorage<VerificationBatch>()
const userFontNameCache = new Map<string, string[]>()
let userFontNameReads = 0

export function resetUserFontCopyCache(): void {
  userFontNameCache.clear()
  userFontNameReads = 0
}

export function userFontCopyReadCount(): number {
  return userFontNameReads
}

/** One deadline for every activation check inside `run`, including not-found retries. */
export function withVerificationBatch<T>(
  run: () => Promise<T>,
  options: { now?: () => number; budgetMs?: number } = {},
): Promise<T> {
  if (verificationBatch.getStore()) return run()
  const now = options.now ?? Date.now
  return verificationBatch.run(
    {
      deadline: now() + (options.budgetMs ?? VERIFY_BUDGET_MS),
      now,
      scanned: false,
      byName: new Map(),
    },
    run,
  )
}

export function duplicateCopyWarning(name: string, otherPath: string): string {
  return `Both copies of ${name} are installed. The other file is ${otherPath}.`
}

export function isDuplicateCopyWarning(message: string): boolean {
  return /Both copies of .+ are installed\./.test(message) || /already served/.test(message)
}

export function assignActivationWarning(
  entry: { activationWarning?: string },
  warning: string | undefined,
): void {
  if (warning && isDuplicateCopyWarning(warning)) entry.activationWarning = warning
  else delete entry.activationWarning
}

/**
 * Walk font files under `root`. `now()` is checked before each directory, so a
 * spent budget never opens the next folder. `visit` returning false stops the
 * walk immediately, including directories that have not been opened yet.
 */
export function visitUserFontFiles(
  root: string,
  visit: (filePath: string) => boolean | void,
  now: () => number = () => 0,
  deadline = Number.POSITIVE_INFINITY,
): void {
  const seen = new Set<string>()
  const pending = [root]
  while (pending.length > 0) {
    if (now() >= deadline) return
    const dir = pending.pop()
    if (!dir) continue
    let resolved = dir
    try {
      resolved = fs.realpathSync(dir)
    } catch {
      continue
    }
    if (seen.has(resolved)) continue
    seen.add(resolved)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(resolved, { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    const subdirs: string[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(resolved, entry.name)
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        subdirs.push(full)
        continue
      }
      if (!USER_FONT_COPY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      if (visit(full) === false) return
    }
    for (const sub of subdirs) pending.push(sub)
  }
}

export function listUserFontFiles(
  root: string,
  now: () => number = () => 0,
  deadline = Number.POSITIVE_INFINITY,
): string[] {
  const files: string[] = []
  visitUserFontFiles(
    root,
    (full) => {
      files.push(full)
    },
    now,
    deadline,
  )
  files.sort()
  return files
}

/** `budget` means the deadline passed before this cache-miss read. */
function cachedPostScriptNames(
  filePath: string,
  now: () => number,
  deadline: number,
): string[] | 'budget' {
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return []
  }
  const key = `${path.resolve(filePath)}\0${stat.mtimeMs}\0${stat.size}`
  const hit = userFontNameCache.get(key)
  if (hit) return hit
  if (now() >= deadline) return 'budget'
  userFontNameReads += 1
  const names = readFilePostScriptNames(filePath)
  userFontNameCache.set(key, names)
  return names
}

function otherCopyFromMap(
  byName: Map<string, string[]>,
  wanted: Set<string>,
  installedPath: string,
): string | undefined {
  for (const name of wanted) {
    const paths = byName.get(name)
    if (!paths) continue
    const other = paths.find((candidate) => !fontPathsMatch(candidate, installedPath))
    if (other) return other
  }
  return undefined
}

/**
 * Another file under ~/Library/Fonts (or the test override) with one of these
 * PostScript names. Name tables only, cached by path, mtime, and size. One
 * walk per verification batch, and each uncached read counts against `deadline`.
 */
export function findOtherUserFontCopy(
  installedPath: string,
  names: Iterable<string>,
  options: { now?: () => number; deadline?: number } = {},
): string | undefined {
  const wanted = new Set([...names].map((name) => name.trim()).filter(Boolean))
  const batch = verificationBatch.getStore()
  const now = options.now ?? batch?.now ?? Date.now
  const deadline = options.deadline ?? batch?.deadline ?? now() + VERIFY_BUDGET_MS
  if (wanted.size === 0) return undefined
  if (batch?.scanned) return otherCopyFromMap(batch.byName, wanted, installedPath)
  const root = macUserFontsRoot()
  if (!root || !fs.existsSync(root)) {
    if (batch) batch.scanned = true
    return undefined
  }
  if (now() >= deadline) {
    if (batch) batch.scanned = true
    return undefined
  }
  const byName = batch?.byName ?? new Map<string, string[]>()
  let match: string | undefined
  visitUserFontFiles(
    root,
    (full) => {
      const psNames = cachedPostScriptNames(full, now, deadline)
      if (psNames === 'budget') return false
      for (const name of psNames) {
        const paths = byName.get(name)
        if (paths) {
          if (!paths.some((candidate) => fontPathsMatch(candidate, full))) paths.push(full)
        } else {
          byName.set(name, [full])
        }
        if (!match && wanted.has(name) && !fontPathsMatch(full, installedPath)) match = full
      }
      return true
    },
    now,
    deadline,
  )
  if (batch) batch.scanned = true
  return match ?? otherCopyFromMap(byName, wanted, installedPath)
}

type FontLookup = (
  postscriptName: string,
  options: { timeoutMs: number },
) => Promise<ActivatedFontLookup>

export async function verifyInstalledFont(filePath: string): Promise<void> {
  if (!nativeFontVerificationEnabled()) {
    logMain('verify', `skip ${filePath}`)
    return
  }
  // Stay on the catalog queue. The check is capped at VERIFY_BUDGET_MS, and
  // releasing the queue here lets another task save over this one.
  await runInstalledFontVerification(filePath)
}

export async function runInstalledFontVerification(
  filePath: string,
  options: {
    lookup?: FontLookup
    now?: () => number
    budgetMs?: number
  } = {},
): Promise<void> {
  const lookup = options.lookup ?? ((postscriptName, lookupOptions) => lookupActivatedFont(postscriptName, lookupOptions))
  const batch = verificationBatch.getStore()
  const now = options.now ?? batch?.now ?? Date.now
  const deadline = batch ? batch.deadline : now() + (options.budgetMs ?? VERIFY_BUDGET_MS)
  const parsed = parseFontFile(filePath)
  const checks = verificationFaceChecks(filePath, parsed.faces)
  if (checks.length === 0) {
    const message = 'Could not read a PostScript name from the installed font.'
    logMain('verify', `fail ${filePath} ${message}`)
    throw installedFontCheckError(filePath, message, false)
  }
  const userFont = isMacUserFontFile(filePath)
  const watched = new Set<string>()
  for (const check of checks) {
    watched.add(check.ps)
    for (const name of check.acceptable) watched.add(name)
  }
  const otherCopy = findOtherUserFontCopy(filePath, watched, { now, deadline })
  if (otherCopy) {
    const message = duplicateCopyWarning(checks[0]?.ps ?? 'the font', otherCopy)
    logMain('verify', `kept ${filePath} ${message}`)
    throw installedFontCheckError(filePath, message, true)
  }
  let lastError = 'Core Text did not activate the installed font.'
  let lastKeep = userFont
  while (true) {
    let failed = ''
    let keep = userFont
    let stop = false
    for (const check of checks) {
      const remaining = deadline - now()
      if (remaining <= 0) {
        failed = lastError
        stop = true
        break
      }
      const timeoutMs = Math.min(LOOKUP_ATTEMPT_MS, remaining)
      const result = await lookup(check.ps, { timeoutMs })
      logMain(
        'verify',
        `${check.ps} -> ps=${result.postscript || '?'} path=${result.path || '?'} version=${result.version || '?'} listed=${result.listed} file=${filePath}`,
      )
      if (result.timedOut || result.error?.startsWith('fail:')) {
        failed = result.error || 'fail:Font lookup timed out.'
        keep = userFont
        stop = true
        break
      }
      if (!result.ok) {
        failed = result.error || `Core Text did not resolve ${check.ps}.`
        keep = userFont
        break
      }
      if (!check.acceptable.has(result.postscript)) {
        const fallback = /helvetica/i.test(result.postscript) || /helvetica/i.test(result.path)
        failed = fallback
          ? `Core Text resolved ${check.ps} to a fallback font (${result.postscript || result.path}).`
          : `Core Text resolved ${check.ps} to ${result.postscript || 'another font'} instead of the installed file.`
        keep = userFont
        break
      }
      if (!fontPathsMatch(result.path, filePath)) {
        failed = duplicateCopyWarning(check.ps, result.path || 'another file')
        keep = true
        break
      }
      if (check.version && result.version && !versionsMatch(result.version, check.version)) {
        failed = `Core Text is serving ${result.version} for ${check.ps}, not ${check.version}.`
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
    if (stop || now() >= deadline) break
    const remaining = deadline - now()
    await waitForFont(Math.min(VERIFY_INTERVAL_MS, remaining))
    if (now() >= deadline) break
  }
  logMain('verify', `fail ${filePath} ${lastError}`)
  throw installedFontCheckError(filePath, lastError, lastKeep)
}

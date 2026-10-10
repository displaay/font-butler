import { closeSync, constants as fsConstants, fstatSync, openSync, readSync } from 'node:fs'
import path from 'node:path'
import { FINDER_INSTALL_AS, isClaimedFontPath } from './finder-install.mjs'
import { TEST_FEED_USER_DATA_DIR } from './test-feed-data.mjs'

export const FINDER_SYNC_BUNDLE_ID = 'app.fontbutler.desktop.FinderSync'
export const FINDER_SYNC_TEST_BUNDLE_ID = 'app.fontbutler.desktop.FinderSync.Test'
export const FINDER_SYNC_PARENT_BUNDLE_ID = 'app.fontbutler.desktop'
export const FINDER_SYNC_AGENT_BUNDLE_ID = 'app.fontbutler.desktop.FinderSyncAgent'
export const FINDER_SYNC_AGENT_TEST_BUNDLE_ID = 'app.fontbutler.desktop.FinderSyncAgent.Test'
export const FINDER_SYNC_AGENT_EXECUTABLE = 'FontButtlerFinderSyncAgent'
export const FINDER_SYNC_AGENT_APP_NAME = 'FontButtlerFinderSyncAgent.app'
export const FINDER_SYNC_SOCKET_NAME = 'fontbutler-finder-sync.sock'
export const FINDER_SYNC_TEST_SOCKET_NAME = 'fontbutler-finder-sync-test.sock'
/** Private directory under the per-user temp dir. Short so the socket path fits in sun_path. */
export const FINDER_SYNC_SOCKET_DIR = 'fontbutler-fs'
export const FINDER_SYNC_PRINCIPAL_CLASS = 'FontButtlerFinderSync'
export const FINDER_SYNC_EXTENSION_POINT = 'com.apple.FinderSync'
export const FINDER_SYNC_APPEX_NAME = 'Font Buttler Finder Sync.appex'
export const FINDER_SYNC_EXECUTABLE = 'FontButtlerFinderSync'
export const FINDER_SYNC_ENTITLEMENT = 'com.apple.security.app-sandbox'
export const FINDER_SYNC_APP_GROUP_ENTITLEMENT = 'com.apple.security.application-groups'
export const FINDER_SYNC_TEAM_ID = 'A7WWML89LQ'
export const FINDER_SYNC_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'
export const FINDER_SYNC_SHARED_ROOT = '/Users/Shared'
export const FINDER_SYNC_VOLUMES_ROOT = '/Volumes'
export const FINDER_SYNC_SYSTEM_FONTS_ROOT = '/Library/Fonts'
export const FINDER_SYNC_MAX_FILES = 500
export const FINDER_SYNC_MAX_BYTES = 2 * 1024 * 1024 * 1024
export const FINDER_SYNC_TOO_MANY_FILES = 'That selection has more than 500 files.'
export const FINDER_SYNC_TOO_LARGE = 'That selection is larger than 2 GB.'
export const FINDER_SYNC_CHANGED_BEFORE_INSTALL = 'The file changed before it could be installed.'
export const FINDER_SYNC_TREE_DEPTH = 10
export const FINDER_SYNC_TREE_TOO_DEEP = 'That folder is nested more than 10 levels deep.'
export const FINDER_SYNC_MISSING_APP =
  "Font Buttler couldn't be found. Open it once from its new location."
export const FINDER_SYNC_AGENT_DISABLED =
  'Turn on Font Buttler in Login Items. Until then, use Services (right-click > Services > Install).'
export const FINDER_SYNC_REQUEST_TTL_MS = 2 * 60 * 1000
export const FINDER_SYNC_REQUEST_CAP = 256
export const FINDER_SYNC_PENDING_ERROR_FILE = 'finder-sync-pending-error.json'
export const FINDER_SYNC_PENDING_ERROR_MAX_BYTES = 8 * 1024
export const FINDER_SYNC_PENDING_ERROR_MAX_ENTRIES = 5
/** Suppress a repeat of the same Finder Sync error only for this long. */
export const FINDER_SYNC_ERROR_SHOWN_TTL_MS = 30 * 1000
export const FINDER_SYNC_NOT_RUNNING = 'Font Buttler is not running.'
export const FINDER_SYNC_UNKNOWN_ACTION = 'Unknown Finder Sync action.'
export const FINDER_SYNC_ERROR_MISSING_APP = 'missing-app'
export const FINDER_SYNC_ERROR_NOT_RUNNING = 'not-running'
export const FINDER_SYNC_ERROR_LOGIN_ITEMS = 'login-items'
export const FINDER_SYNC_ERROR_UNKNOWN_ACTION = 'unknown-action'
/** Release userData folder. The test feed uses TEST_FEED_USER_DATA_DIR. */
export const FINDER_SYNC_USER_DATA_DIR = 'Font Buttler'
export const FINDER_SYNC_TEST_USER_DATA_DIR = TEST_FEED_USER_DATA_DIR
const FINDER_SYNC_ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal']

const MAX_PATH_LENGTH = 4096

export function finderSyncBundleId(testFeed) {
  return testFeed ? FINDER_SYNC_TEST_BUNDLE_ID : FINDER_SYNC_BUNDLE_ID
}

export function finderSyncMenuTitle(action, testFeed) {
  const base = action === FINDER_INSTALL_AS ? 'Install as…' : 'Install'
  return testFeed ? `${base} (Test)` : base
}

/**
 * App-group id and Mach service. The test build has its own group.
 * The id is team-prefixed (`A7WWML89LQ.group.…`). macOS 15 asks to
 * "access data from other apps" when the group is not in that form.
 * The app entitlements and the appex entitlements list this exact string.
 * It is Font Buttler's group, not another app's container.
 */
export function finderSyncAppGroup(testFeed) {
  return `${FINDER_SYNC_TEAM_ID}.group.${finderSyncBundleId(testFeed)}`
}

export function finderSyncAppGroupIsTeamPrefixed(group) {
  return typeof group === 'string' && group.startsWith(`${FINDER_SYNC_TEAM_ID}.group.`) && group.length > `${FINDER_SYNC_TEAM_ID}.group.`.length
}

export function finderSyncMachService(testFeed) {
  return finderSyncAppGroup(testFeed)
}

/**
 * One code-signing requirement per flavour. The listener accepts that
 * identifier and no other.
 */
export function finderSyncCodeSigningRequirement(testFeed) {
  const identifier = finderSyncBundleId(Boolean(testFeed))
  return `anchor apple generic and certificate leaf[subject.OU] = "${FINDER_SYNC_TEAM_ID}" and identifier "${identifier}"`
}

export function finderSyncAgentBundleId(testFeed) {
  return testFeed ? FINDER_SYNC_AGENT_TEST_BUNDLE_ID : FINDER_SYNC_AGENT_BUNDLE_ID
}

/** LaunchAgent label. One label per flavour, and it is the helper's bundle id. */
export function finderSyncAgentLabel(testFeed) {
  return finderSyncAgentBundleId(testFeed)
}

export function finderSyncAgentPlistName(testFeed) {
  return `${finderSyncAgentLabel(testFeed)}.plist`
}

/**
 * Path of the helper executable relative to the .app root. `BundleProgram`
 * is this path. The helper is a nested app so codesign takes the identifier
 * from its Info.plist when it re-signs the bundle.
 */
export function finderSyncAgentBundleProgram() {
  return `Contents/Helpers/${FINDER_SYNC_AGENT_APP_NAME}/Contents/MacOS/${FINDER_SYNC_AGENT_EXECUTABLE}`
}

/**
 * The main app checks the socket peer against this. It is the helper, not
 * the appex. One identifier per flavour.
 */
export function finderSyncAgentCodeSigningRequirement(testFeed) {
  const identifier = finderSyncAgentBundleId(Boolean(testFeed))
  return `anchor apple generic and certificate leaf[subject.OU] = "${FINDER_SYNC_TEAM_ID}" and identifier "${identifier}"`
}

/**
 * The helper checks the app side of the socket against the parent bundle id.
 * Both flavours use that id. The socket file name separates them.
 */
export function finderSyncParentCodeSigningRequirement() {
  return `anchor apple generic and certificate leaf[subject.OU] = "${FINDER_SYNC_TEAM_ID}" and identifier "${FINDER_SYNC_PARENT_BUNDLE_ID}"`
}

export function finderSyncSocketName(testFeed) {
  return testFeed ? FINDER_SYNC_TEST_SOCKET_NAME : FINDER_SYNC_SOCKET_NAME
}

/** Directory name both the app and the helper append under the per-user temp dir. */
export function finderSyncSocketDirectoryName() {
  return FINDER_SYNC_SOCKET_DIR
}

/**
 * clang `-arch` slices for the helper and the receiver. A universal pack
 * builds both slices; `lipo` joins them. `arch` is an electron-builder Arch
 * number or a name (`arm64`, `x64`, `universal`).
 */
export function finderSyncClangArchArgs(arch = process.arch) {
  const name = typeof arch === 'number' ? FINDER_SYNC_ARCH_NAMES[arch] : arch
  if (name === 'arm64') return [['-arch', 'arm64']]
  if (name === 'x64' || name === 'x86_64') return [['-arch', 'x86_64']]
  if (name === 'universal') return [['-arch', 'arm64'], ['-arch', 'x86_64']]
  return []
}

/**
 * A crash can leave the unix socket behind. Replace it only when the path
 * is a socket owned by this user. A regular file, a symlink, or another
 * user's socket stays in place and the bind is refused.
 */
export function prepareFinderSyncSocket(filePath, io) {
  if (!filePath || typeof io?.lstatSync !== 'function' || typeof io?.unlinkSync !== 'function') {
    return { ok: false, unlinked: false, reason: 'unavailable' }
  }
  const uid = typeof io.getuid === 'function' ? io.getuid() : null
  let stat
  try {
    stat = io.lstatSync(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, unlinked: false, reason: 'absent' }
    return { ok: false, unlinked: false, reason: 'stat-failed' }
  }
  if (stat?.isSymbolicLink?.()) return { ok: false, unlinked: false, reason: 'symlink' }
  if (!stat?.isSocket?.() || uid == null || stat.uid !== uid) {
    return { ok: false, unlinked: false, reason: 'not-owned-socket' }
  }
  io.unlinkSync(filePath)
  return { ok: true, unlinked: true, reason: 'replaced' }
}

function absoluteBundlePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.startsWith('/')) return ''
  return filePath.replace(/\/+$/, '')
}

/**
 * What this launch should do with this flavour's LaunchAgent only.
 * A test build never names the release label or plist. The recorded app
 * bundle path is the one this app wrote after a successful register.
 * A different bundle path means unregister, then register. Opt-out only
 * unregisters. An enabled or approved agent at the same path stays as it is.
 */
export function planFinderSyncAgentRegistration({
  testFeed = false,
  currentBundle,
  recordedBundle,
  recordedProgram,
  currentHelper,
  status,
  optedOut = false,
} = {}) {
  const label = finderSyncAgentLabel(testFeed)
  const plist = finderSyncAgentPlistName(testFeed)
  const plan = { action: 'keep', label, plist, testFeed: Boolean(testFeed), reason: 'current' }
  if (optedOut) return { ...plan, action: 'unregister', reason: 'opt-out' }
  if (status === 'unsupported') return { ...plan, action: 'keep', reason: 'unsupported' }
  const current = absoluteBundlePath(currentBundle)
  const recorded = absoluteBundlePath(recordedBundle)
  const helper = absoluteBundlePath(currentHelper)
  const previousProgram = typeof recordedProgram === 'string' ? recordedProgram.trim() : ''
  if (recorded && current && recorded !== current) {
    return { ...plan, action: 'reregister', reason: 'moved' }
  }
  // An old file stored only `program`. Compare it once. Saving the new
  // record drops `program`, so the next launch takes the path above.
  if (!recorded && previousProgram) {
    const previousHelper = absoluteBundlePath(previousProgram)
    if (helper && previousHelper && previousHelper !== helper) {
      return { ...plan, action: 'reregister', reason: 'legacy-program' }
    }
    if (status === 'enabled' || status === 'requires-approval') {
      return { ...plan, action: 'keep', reason: 'legacy-program' }
    }
    return { ...plan, action: 'register', reason: 'legacy-program' }
  }
  if (status === 'enabled' || status === 'requires-approval') {
    return { ...plan, action: 'keep', reason: status }
  }
  return { ...plan, action: 'register', reason: status || 'not-registered' }
}

export function readFinderSyncAgentRecord(text) {
  const empty = { enabled: true, appBundlePath: '', helperPath: '', version: '', program: '' }
  if (!text) return empty
  try {
    const parsed = JSON.parse(text)
    return {
      enabled: parsed?.enabled !== false,
      appBundlePath: typeof parsed?.appBundlePath === 'string' ? parsed.appBundlePath : '',
      helperPath: typeof parsed?.helperPath === 'string' ? parsed.helperPath : '',
      version: typeof parsed?.version === 'string' ? parsed.version : '',
      program: typeof parsed?.program === 'string' ? parsed.program : '',
    }
  } catch {
    return empty
  }
}

/**
 * Apply one registration plan. `unregister` and `register` run only for
 * that plan. A second call with the same bundle path and an enabled or
 * approved status runs neither. The record is the one to persist after a
 * successful register (enabled or requires-approval).
 */
export function commitFinderSyncAgentRegistration({
  testFeed = false,
  currentBundle = '',
  helperPath = '',
  version = '',
  record,
  status,
  optedOut = false,
  unregister = () => {},
  register = () => status,
} = {}) {
  const stored = readFinderSyncAgentRecord(JSON.stringify(record ?? {}))
  const plan = planFinderSyncAgentRegistration({
    testFeed,
    currentBundle,
    recordedBundle: stored.appBundlePath,
    recordedProgram: stored.program,
    currentHelper: helperPath,
    status,
    optedOut,
  })
  if (plan.label !== finderSyncAgentLabel(testFeed) || plan.plist !== finderSyncAgentPlistName(testFeed)) {
    return { plan, status: status || '', record: stored, saved: false, refused: true }
  }
  let resultStatus = status || ''
  if (plan.action === 'unregister' || plan.action === 'reregister') unregister()
  if (plan.action === 'register' || plan.action === 'reregister') {
    const registered = register()
    if (typeof registered === 'string' && registered) resultStatus = registered
  }
  const approved = resultStatus === 'enabled' || resultStatus === 'requires-approval'
  const bundle = absoluteBundlePath(currentBundle)
  if (!approved || !bundle || optedOut || plan.action === 'unregister') {
    return { plan, status: resultStatus, record: stored, saved: false, refused: false }
  }
  const next = {
    enabled: true,
    appBundlePath: bundle,
    helperPath: absoluteBundlePath(helperPath),
    version: typeof version === 'string' ? version : '',
  }
  return { plan, status: resultStatus, record: next, saved: true, refused: false }
}

const FINDER_SYNC_ERROR_MESSAGES = {
  [FINDER_SYNC_ERROR_MISSING_APP]: FINDER_SYNC_MISSING_APP,
  [FINDER_SYNC_ERROR_NOT_RUNNING]: FINDER_SYNC_NOT_RUNNING,
  [FINDER_SYNC_ERROR_LOGIN_ITEMS]: FINDER_SYNC_AGENT_DISABLED,
  [FINDER_SYNC_ERROR_UNKNOWN_ACTION]: FINDER_SYNC_UNKNOWN_ACTION,
}

/** Fixed copy for a known Finder Sync error code. Anything else is empty. */
export function finderSyncErrorMessage(code) {
  return Object.hasOwn(FINDER_SYNC_ERROR_MESSAGES, code) ? FINDER_SYNC_ERROR_MESSAGES[code] : ''
}

function pendingErrorByteLength(text) {
  return Buffer.byteLength(typeof text === 'string' ? text : '', 'utf8')
}

/**
 * Known codes from a pending-error record. Unknown codes, free-form
 * messages, and a record over the size cap are ignored. At most
 * FINDER_SYNC_PENDING_ERROR_MAX_ENTRIES codes are kept.
 */
export function readFinderSyncPendingErrors(text) {
  if (!text || pendingErrorByteLength(text) > FINDER_SYNC_PENDING_ERROR_MAX_BYTES) return []
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const list = Array.isArray(parsed?.errors) ? parsed.errors : []
  const seen = new Set()
  const errors = []
  for (const item of list) {
    if (errors.length >= FINDER_SYNC_PENDING_ERROR_MAX_ENTRIES) break
    const code = typeof item?.code === 'string' ? item.code : ''
    const message = finderSyncErrorMessage(code)
    if (!message || seen.has(code)) continue
    seen.add(code)
    errors.push({ code, message, at: typeof item?.at === 'number' ? item.at : 0 })
  }
  return errors
}

export function addFinderSyncPendingError(text, code, now = Date.now()) {
  const message = finderSyncErrorMessage(code)
  const prior = pendingErrorByteLength(text) > FINDER_SYNC_PENDING_ERROR_MAX_BYTES ? '' : text
  const errors = readFinderSyncPendingErrors(prior).map((item) => ({ code: item.code, at: item.at }))
  if (!message || errors.some((item) => item.code === code)) {
    return { errors, added: false, text: JSON.stringify({ errors }) }
  }
  const next = [...errors, { code, at: now }]
  if (next.length > FINDER_SYNC_PENDING_ERROR_MAX_ENTRIES) next.shift()
  return { errors: next, added: true, text: JSON.stringify({ errors: next }) }
}

/**
 * Read the pending-error file without following a symlink. A regular file
 * is returned for deletion even when its contents are ignored.
 */
export function readFinderSyncPendingErrorFile(filePath, io = { openSync, fstatSync, readSync, closeSync }) {
  if (!filePath || typeof io?.openSync !== 'function' || typeof io?.fstatSync !== 'function' || typeof io?.readSync !== 'function' || typeof io?.closeSync !== 'function') {
    return { errors: [], discard: false, reason: 'unavailable' }
  }
  let fd
  try {
    fd = io.openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  } catch (error) {
    if (error?.code === 'ENOENT') return { errors: [], discard: false, reason: 'absent' }
    if (error?.code === 'ELOOP' || error?.code === 'EMLINK' || error?.code === 'EPERM') {
      return { errors: [], discard: false, reason: 'symlink' }
    }
    return { errors: [], discard: false, reason: 'unreadable' }
  }
  try {
    const stat = io.fstatSync(fd)
    if (typeof stat?.isFile !== 'function' || !stat.isFile()) {
      return { errors: [], discard: false, reason: 'not-file' }
    }
    if (typeof stat.size !== 'number' || stat.size < 0 || stat.size > FINDER_SYNC_PENDING_ERROR_MAX_BYTES) {
      return { errors: [], discard: true, reason: 'oversize' }
    }
    const buffer = Buffer.alloc(stat.size)
    let got = 0
    while (got < stat.size) {
      const count = io.readSync(fd, buffer, got, stat.size - got, null)
      if (count <= 0) break
      got += count
    }
    return { errors: readFinderSyncPendingErrors(buffer.subarray(0, got).toString('utf8')), discard: true, reason: 'ok' }
  } catch {
    return { errors: [], discard: true, reason: 'unreadable' }
  } finally {
    try {
      io.closeSync(fd)
    } catch {
      // The descriptor is already closed.
    }
  }
}

function pruneFinderSyncErrorsShown(alreadyShown, now, ttl) {
  if (!alreadyShown || typeof alreadyShown.entries !== 'function' || typeof alreadyShown.delete !== 'function') return
  for (const [code, seenAt] of alreadyShown) {
    if (typeof seenAt !== 'number' || now - seenAt >= ttl) alreadyShown.delete(code)
  }
}

/**
 * How the main app tells the user about one Finder Sync error code.
 * Notifications use the app's existing permission. Off or denied falls
 * back to an in-app dialog. The same code is skipped until the short
 * window expires. An unknown code is not shown.
 */
export function routeFinderSyncError({
  code,
  notificationsEnabled = false,
  permission = 'denied',
  alreadyShown,
  now = Date.now(),
  ttl = FINDER_SYNC_ERROR_SHOWN_TTL_MS,
} = {}) {
  const message = finderSyncErrorMessage(code)
  if (!message) return { shown: false, channel: 'none', message: '', code: '' }
  pruneFinderSyncErrorsShown(alreadyShown, now, ttl)
  if (alreadyShown?.has?.(code)) return { shown: false, channel: 'duplicate', message, code }
  const notify = notificationsEnabled === true && permission === 'granted'
  return { shown: true, channel: notify ? 'notification' : 'dialog', message, code }
}

function pruneFinderSyncRequests(seen, now, ttl) {
  const cutoff = now - ttl
  for (const [id, seenAt] of seen) {
    if (seenAt < cutoff) seen.delete(id)
  }
}

/**
 * True when this request id was already accepted. Does not record the id.
 * An empty id is never a duplicate.
 */
export function finderSyncRequestSeen(seen, requestId, now = Date.now(), ttl = FINDER_SYNC_REQUEST_TTL_MS) {
  if (!seen || typeof seen.delete !== 'function' || typeof seen.has !== 'function') return false
  pruneFinderSyncRequests(seen, now, ttl)
  if (!requestId) return false
  return seen.has(requestId)
}

/**
 * Record a request id after the install was queued. At most
 * FINDER_SYNC_REQUEST_CAP ids are kept; the oldest timestamp is dropped.
 */
export function noteFinderSyncRequest(seen, requestId, now = Date.now(), cap = FINDER_SYNC_REQUEST_CAP) {
  if (!seen || typeof seen.set !== 'function' || !requestId) return
  if (seen.has(requestId)) seen.delete(requestId)
  seen.set(requestId, now)
  while (seen.size > cap) {
    let oldestId = null
    let oldestAt = Infinity
    for (const [id, seenAt] of seen) {
      if (seenAt < oldestAt) {
        oldestAt = seenAt
        oldestId = id
      }
    }
    if (oldestId == null) break
    seen.delete(oldestId)
  }
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * SMAppService agent plist. Launchd vends one Mach service, the app-group
 * name. RunAtLoad stays false so launchd starts the helper on lookup.
 */
export function finderSyncAgentLaunchAgentPlist(testFeed) {
  const label = finderSyncAgentLabel(testFeed)
  const service = finderSyncMachService(testFeed)
  const program = finderSyncAgentBundleProgram()
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xmlEscape(label)}</string>
    <key>BundleProgram</key>
    <string>${xmlEscape(program)}</string>
    <key>AssociatedBundleIdentifiers</key>
    <array>
      <string>${FINDER_SYNC_PARENT_BUNDLE_ID}</string>
    </array>
    <key>MachServices</key>
    <dict>
      <key>${xmlEscape(service)}</key>
      <true/>
    </dict>
    <key>RunAtLoad</key>
    <false/>
  </dict>
</plist>
`
}

export function finderSyncAgentInfoPlist({ testFeed = false, version = '1.0' } = {}) {
  const bundleId = finderSyncAgentBundleId(testFeed)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>${FINDER_SYNC_AGENT_EXECUTABLE}</string>
    <key>CFBundleIdentifier</key>
    <string>${xmlEscape(bundleId)}</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Font Buttler Finder Sync Agent</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${xmlEscape(version)}</string>
    <key>CFBundleVersion</key>
    <string>${xmlEscape(version)}</string>
    <key>LSBackgroundOnly</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
  </dict>
</plist>
`
}

export function finderSyncAgentMachServiceKeys(plist) {
  const body = String(plist ?? '').match(/<key>MachServices<\/key>\s*<dict>([\s\S]*?)<\/dict>/)
  if (!body) return []
  return [...body[1].matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1])
}

export function finderSyncWireAction(action) {
  if (action === 'installAs' || action === FINDER_INSTALL_AS) return FINDER_INSTALL_AS
  if (action === 'install') return 'install'
  return null
}

export function finderSyncAppexBundlePath(appPath) {
  return path.join(appPath, 'Contents', 'PlugIns', FINDER_SYNC_APPEX_NAME)
}

/**
 * Home, `/Users/Shared`, and `/Volumes`. `/` and `/Library/Fonts` are not
 * monitored. File Provider folders are not added. `home` is ignored when it
 * is not a safe absolute path.
 */
export function finderSyncMonitorDirectories(home) {
  const directories = []
  if (typeof home === 'string' && home !== '/' && home !== FINDER_SYNC_SYSTEM_FONTS_ROOT && isSafeFinderSyncPath(home)) {
    directories.push(home)
  }
  for (const root of [FINDER_SYNC_SHARED_ROOT, FINDER_SYNC_VOLUMES_ROOT]) {
    if (!directories.includes(root)) directories.push(root)
  }
  return directories
}

/**
 * Decide whether launch should point pluginkit at the appex inside this app.
 * A disabled extension stays disabled. A matching path is left alone.
 * An enabled extension whose path is some other copy is re-registered so a
 * moved app does not keep a stale menu.
 */
export function parsePluginkitFinderSync(output, bundleId) {
  const lines = String(output ?? '').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([+\-!])\s+(\S+)/)
    if (!match) continue
    const identifier = match[2].split('(')[0]
    if (identifier !== bundleId) continue
    let pluginPath = ''
    for (let next = index + 1; next < lines.length; next += 1) {
      if (/^[+\-!]/.test(lines[next])) break
      const pathMatch = lines[next].match(/^\s*Path\s*=\s*(.+)$/)
      if (pathMatch) pluginPath = pathMatch[1].trim()
    }
    return { matched: true, flag: match[1], enabled: match[1] === '+', path: pluginPath }
  }
  return { matched: false, flag: '', enabled: false, path: '' }
}

export function planFinderSyncRegistration({ currentAppex, record } = {}) {
  if (!currentAppex) return { action: 'none', reason: 'missing-appex' }
  if (!record?.matched) return { action: 'none', reason: 'not-registered' }
  if (record.flag === '-') return { action: 'none', reason: 'disabled' }
  if (!record.path || record.path === currentAppex) return { action: 'none', reason: 'current' }
  if (record.flag === '+' || record.flag === '!') {
    return { action: 'reregister', appex: currentAppex, reason: 'moved' }
  }
  return { action: 'none', reason: 'disabled' }
}

export function refreshFinderSyncRegistration({
  platform = process.platform,
  packaged = false,
  appPath,
  testFeed = false,
  spawnSync,
} = {}) {
  if (platform !== 'darwin' || packaged !== true || !appPath || typeof spawnSync !== 'function') {
    return { action: 'none', reason: 'skipped' }
  }
  const bundleId = finderSyncBundleId(testFeed)
  const appex = finderSyncAppexBundlePath(appPath)
  let output = ''
  try {
    const listed = spawnSync('pluginkit', ['-m', '-A', '-v', '-i', bundleId], { encoding: 'utf8' })
    output = `${listed?.stdout ?? ''}\n${listed?.stderr ?? ''}`
  } catch {
    return { action: 'none', reason: 'pluginkit-failed' }
  }
  const plan = planFinderSyncRegistration({
    currentAppex: appex,
    record: parsePluginkitFinderSync(output, bundleId),
  })
  if (plan.action !== 'reregister') return plan
  try {
    const added = spawnSync('pluginkit', ['-a', plan.appex], { encoding: 'utf8' })
    if ((added?.status ?? 1) !== 0) return { ...plan, ok: false, reason: 'reregister-failed' }
  } catch {
    return { ...plan, ok: false, reason: 'reregister-failed' }
  }
  return { ...plan, ok: true }
}

export function isSafeFinderSyncPath(filePath) {
  if (typeof filePath !== 'string') return false
  if (!filePath.startsWith('/')) return false
  if (filePath.includes('\0')) return false
  if (filePath.length > MAX_PATH_LENGTH) return false
  const parts = filePath.split('/')
  if (parts.slice(1).some((part) => part === '' || part === '.' || part === '..')) return false
  return true
}

export function fontMagicKind(header) {
  if (!header || header.length < 4) return null
  const bytes = [header[0], header[1], header[2], header[3]]
  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return 'sfnt'
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (tag === 'OTTO' || tag === 'true' || tag === 'typ1') return 'sfnt'
  if (tag === 'ttcf') return 'collection'
  if (tag === 'wOFF') return 'woff'
  if (tag === 'wOF2') return 'woff2'
  return null
}

function fontExtension(filePath) {
  const base = filePath.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

function magicMatchesExtension(ext, kind) {
  if (ext === 'woff') return kind === 'woff'
  if (ext === 'woff2') return kind === 'woff2'
  if (ext === 'ttc' || ext === 'otc') return kind === 'collection'
  if (ext === 'ttf' || ext === 'otf') return kind === 'sfnt'
  return false
}

function resolveTrustedLink(linkPath, io) {
  if (linkPath !== '/tmp' && linkPath !== '/var') return null
  let target
  try {
    target = io.readlinkSync(linkPath)
  } catch {
    return null
  }
  if (typeof target !== 'string' || !target || target.includes('\0')) return null
  const parent = linkPath.slice(0, linkPath.lastIndexOf('/')) || '/'
  const resolved = target.startsWith('/')
    ? target.replace(/\/+$/, '') || '/'
    : `${parent === '/' ? '' : parent}/${target}`.replace(/\/\.\//g, '/')
  const normalized = []
  for (const part of resolved.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') return null
    normalized.push(part)
  }
  const absolute = `/${normalized.join('/')}`
  const expected = linkPath === '/tmp' ? '/private/tmp' : '/private/var'
  if (absolute !== expected) return null
  try {
    const stat = io.lstatSync(absolute)
    if (stat?.isSymbolicLink?.() || !stat?.isDirectory?.()) return null
  } catch {
    return null
  }
  return absolute
}

/**
 * Walk the path. `/tmp` and `/var` may be the standard symlinks to
 * `/private/tmp` and `/private/var`. Every other symlink is refused.
 * The returned path is the one later opened with O_NOFOLLOW.
 */
function resolveFinderSyncPath(filePath, io) {
  const parts = filePath.split('/').filter(Boolean)
  let current = ''
  let last = null
  for (const part of parts) {
    current = `${current}/${part}`
    let stat
    try {
      stat = io.lstatSync(current)
    } catch {
      return { error: 'File not found.' }
    }
    if (stat?.isSymbolicLink?.()) {
      const redirected = resolveTrustedLink(current, io)
      if (!redirected) return { error: 'Symlink paths are not installed.' }
      current = redirected
      try {
        last = io.lstatSync(current)
      } catch {
        return { error: 'File not found.' }
      }
      continue
    }
    last = stat
  }
  return { path: current || '/', stat: last }
}

function headerFromIo(filePath, io, fd) {
  try {
    if (fd != null && typeof io.readAt === 'function') return io.readAt(fd, 4)
    return io.readPrefix(filePath, 4)
  } catch (error) {
    if (error?.code === 'ELOOP') return { error: 'Symlink paths are not installed.' }
    return { error: 'Not a font file.' }
  }
}

function closeHandle(io, handle) {
  if (handle?.fd == null || typeof io.closeSync !== 'function') return
  try {
    io.closeSync(handle.fd)
  } catch {
    // The descriptor is already unusable.
  }
}

function openChecked(filePath, io, directory) {
  if (typeof io.openSync !== 'function') return { fd: null, stat: null }
  let fd
  try {
    fd = io.openSync(filePath, directory)
  } catch (error) {
    if (error?.code === 'ELOOP') return { error: 'Symlink paths are not installed.' }
    return { error: directory ? 'File not found.' : 'Not a font file.' }
  }
  if (fd == null) return { fd: null, stat: null }
  if (typeof io.fstatSync !== 'function') return { fd, stat: null }
  try {
    const stat = io.fstatSync(fd)
    return { fd, stat }
  } catch {
    closeHandle(io, { fd })
    return { error: 'File not found.' }
  }
}

function inspectFontFile(filePath, io) {
  const resolved = resolveFinderSyncPath(filePath, io)
  if (resolved.error) return { error: resolved.error }
  const pathToUse = resolved.path
  const last = resolved.stat
  if (last?.isDirectory?.()) {
    const opened = openChecked(pathToUse, io, true)
    if (opened.error) return { error: opened.error }
    const stat = opened.stat ?? last
    if (opened.fd != null && !stat?.isDirectory?.()) {
      closeHandle(io, { fd: opened.fd })
      return { error: 'Not a regular file.' }
    }
    return {
      path: pathToUse,
      kind: 'dir',
      handle:
        opened.fd == null
          ? null
          : { path: pathToUse, fd: opened.fd, dev: stat.dev, ino: stat.ino, kind: 'dir' },
    }
  }
  if (!last?.isFile?.()) return { error: 'Not a regular file.' }
  if (!isClaimedFontPath(pathToUse)) return { error: 'Not a font file.' }
  const opened = openChecked(pathToUse, io, false)
  if (opened.error) return { error: opened.error }
  const fd = opened.fd
  const header = headerFromIo(pathToUse, io, fd)
  if (header?.error) {
    closeHandle(io, { fd })
    return { error: header.error }
  }
  if (!magicMatchesExtension(fontExtension(pathToUse), fontMagicKind(header))) {
    closeHandle(io, { fd })
    return { error: 'Not a font file.' }
  }
  const stat = opened.stat ?? last
  if (fd != null && !stat?.isFile?.()) {
    closeHandle(io, { fd })
    return { error: 'Not a regular file.' }
  }
  return {
    path: pathToUse,
    kind: 'file',
    handle:
      fd == null
        ? null
        : { path: pathToUse, fd, dev: stat.dev, ino: stat.ino, kind: 'file', size: Number(stat.size) || 0 },
    size: Number(stat?.size) || 0,
  }
}

function emptySelection(rejected = [], limitError = null) {
  return {
    paths: [],
    rejected,
    handles: [],
    limitError,
    close() {},
  }
}

function closeHandles(io, handles) {
  for (const handle of handles) closeHandle(io, handle)
}

/**
 * Count regular files under a folder without following symlinks.
 * A symlink entry counts as one file so a directory of links cannot skip the cap.
 */
function measureTree(dirPath, io, state, depth) {
  if (state.limit || state.error) return
  if (depth > FINDER_SYNC_TREE_DEPTH) {
    state.error = FINDER_SYNC_TREE_TOO_DEEP
    return
  }
  if (typeof io.readdirSync !== 'function') return
  let names
  try {
    names = io.readdirSync(dirPath) ?? []
  } catch {
    state.error = 'File not found.'
    return
  }
  for (const name of names) {
    if (state.limit || state.error) return
    if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\0') || name === '.' || name === '..') {
      continue
    }
    const child = `${dirPath}/${name}`
    let stat
    try {
      stat = io.lstatSync(child)
    } catch {
      continue
    }
    if (stat?.isSymbolicLink?.()) {
      state.files += 1
    } else if (stat?.isDirectory?.()) {
      measureTree(child, io, state, depth + 1)
      continue
    } else if (stat?.isFile?.()) {
      state.files += 1
      state.bytes += Number(stat.size) || 0
    } else {
      continue
    }
    if (state.files > FINDER_SYNC_MAX_FILES) state.limit = 'files'
    else if (state.bytes > FINDER_SYNC_MAX_BYTES) state.limit = 'bytes'
  }
}

function limitMessage(limit) {
  return limit === 'bytes' ? FINDER_SYNC_TOO_LARGE : FINDER_SYNC_TOO_MANY_FILES
}

/**
 * Re-check a Finder Sync selection before the existing install flow.
 * Font files must be regular files with font magic. Folders are accepted and
 * measured so a directory cannot skip the file and byte caps. Symlinks are
 * refused except the standard `/tmp` and `/var` links. An open descriptor is
 * held so the install can confirm the same inode.
 */
export function validateFinderSyncSelection(filePaths, io) {
  const selection = []
  const seen = new Set()
  const rejected = []

  for (const raw of filePaths ?? []) {
    if (typeof raw !== 'string') continue
    const filePath = raw
    if (!filePath || seen.has(filePath)) continue
    seen.add(filePath)
    if (!isSafeFinderSyncPath(filePath)) {
      rejected.push({ path: filePath, reason: 'Not an absolute font file.' })
      continue
    }
    selection.push(filePath)
  }

  if (selection.length > FINDER_SYNC_MAX_FILES) {
    return emptySelection(rejected, FINDER_SYNC_TOO_MANY_FILES)
  }

  const paths = []
  const handles = []
  const state = { files: 0, bytes: 0, limit: null, error: null }

  for (const filePath of selection) {
    const inspected = inspectFontFile(filePath, io)
    if (inspected.error) {
      rejected.push({ path: filePath, reason: inspected.error })
      continue
    }
    if (inspected.kind === 'dir') {
      measureTree(inspected.path, io, state, 1)
      if (state.error) {
        closeHandle(io, inspected.handle)
        closeHandles(io, handles)
        rejected.push({ path: filePath, reason: state.error })
        return emptySelection(rejected)
      }
      if (state.limit) {
        closeHandle(io, inspected.handle)
        closeHandles(io, handles)
        return emptySelection(rejected, limitMessage(state.limit))
      }
      paths.push(inspected.path)
      if (inspected.handle) handles.push(inspected.handle)
      continue
    }
    state.files += 1
    state.bytes += Number(inspected.size) || 0
    if (state.files > FINDER_SYNC_MAX_FILES || state.bytes > FINDER_SYNC_MAX_BYTES) {
      closeHandle(io, inspected.handle)
      closeHandles(io, handles)
      const limit = state.bytes > FINDER_SYNC_MAX_BYTES && state.files <= FINDER_SYNC_MAX_FILES ? 'bytes' : 'files'
      return emptySelection(rejected, limitMessage(limit))
    }
    paths.push(inspected.path)
    if (inspected.handle) handles.push(inspected.handle)
  }

  return {
    paths,
    rejected,
    handles,
    limitError: null,
    close() {
      closeHandles(io, handles)
    },
  }
}

/**
 * Confirm each held descriptor still names the same file, then reopen that
 * path with O_NOFOLLOW and compare inodes. A swap between the check and the
 * install is refused.
 */
export function revalidateFinderSyncHandles(handles, io) {
  for (const handle of handles ?? []) {
    if (!handle || handle.fd == null || typeof io.fstatSync !== 'function' || typeof io.openSync !== 'function') {
      return { ok: false, reason: FINDER_SYNC_CHANGED_BEFORE_INSTALL }
    }
    let current
    try {
      current = io.fstatSync(handle.fd)
    } catch {
      return { ok: false, reason: FINDER_SYNC_CHANGED_BEFORE_INSTALL }
    }
    const directory = handle.kind === 'dir'
    if (directory ? !current?.isDirectory?.() : !current?.isFile?.()) {
      return { ok: false, reason: FINDER_SYNC_CHANGED_BEFORE_INSTALL }
    }
    if (current.dev !== handle.dev || current.ino !== handle.ino) {
      return { ok: false, reason: FINDER_SYNC_CHANGED_BEFORE_INSTALL }
    }
    let reopened
    try {
      reopened = io.openSync(handle.path, directory)
    } catch {
      return { ok: false, reason: FINDER_SYNC_CHANGED_BEFORE_INSTALL }
    }
    try {
      const again = io.fstatSync(reopened)
      if (!again || again.dev !== handle.dev || again.ino !== handle.ino) {
        return { ok: false, reason: FINDER_SYNC_CHANGED_BEFORE_INSTALL }
      }
      if (!directory) {
        const header = headerFromIo(handle.path, io, reopened)
        if (header?.error || !magicMatchesExtension(fontExtension(handle.path), fontMagicKind(header))) {
          return { ok: false, reason: FINDER_SYNC_CHANGED_BEFORE_INSTALL }
        }
      }
    } finally {
      closeHandle(io, { fd: reopened })
    }
  }
  return { ok: true }
}

export function formatFinderSyncRejections(rejected) {
  return (rejected ?? [])
    .map((item) => {
      const reason = String(item?.reason ?? '').trim()
      const filePath = String(item?.path ?? '').trim()
      if (filePath && reason) return `${filePath}: ${reason}`
      return reason || filePath
    })
    .filter(Boolean)
    .join('\n')
}

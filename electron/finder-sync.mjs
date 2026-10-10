import path from 'node:path'
import { FINDER_INSTALL_AS, isClaimedFontPath } from './finder-install.mjs'

export const FINDER_SYNC_BUNDLE_ID = 'app.fontbutler.desktop.FinderSync'
export const FINDER_SYNC_TEST_BUNDLE_ID = 'app.fontbutler.desktop.FinderSync.Test'
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
const FINDER_SYNC_TREE_DEPTH = 10

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
  if (depth > FINDER_SYNC_TREE_DEPTH) return
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
    const filePath = raw.trim()
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

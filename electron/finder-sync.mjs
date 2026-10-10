import path from 'node:path'
import {
  FINDER_INSTALL_AS,
  FINDER_PROTOCOL,
  FINDER_TEST_PROTOCOL,
  isClaimedFontPath,
  isFinderInstallAction,
  parseFinderInstallUrl,
} from './finder-install.mjs'

export const FINDER_SYNC_BUNDLE_ID = 'app.fontbutler.desktop.FinderSync'
export const FINDER_SYNC_TEST_BUNDLE_ID = 'app.fontbutler.desktop.FinderSync.Test'
export const FINDER_SYNC_PRINCIPAL_CLASS = 'FontButtlerFinderSync'
export const FINDER_SYNC_EXTENSION_POINT = 'com.apple.FinderSync'
export const FINDER_SYNC_APPEX_NAME = 'Font Buttler Finder Sync.appex'
export const FINDER_SYNC_EXECUTABLE = 'FontButtlerFinderSync'
export const FINDER_SYNC_ENTITLEMENT = 'com.apple.security.app-sandbox'
export const FINDER_SYNC_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'
export const FINDER_SYNC_MONITORED_ROOT = '/'
export const FINDER_SYNC_CLOUD_STORAGE_DIR = 'Library/CloudStorage'
export const FINDER_SYNC_MOBILE_DOCUMENTS_DIR = 'Library/Mobile Documents'
export const FINDER_SYNC_ICLOUD_DRIVE_DIR = 'Library/Mobile Documents/com~apple~CloudDocs'

const MAX_PATH_LENGTH = 4096

export function finderSyncBundleId(testFeed) {
  return testFeed ? FINDER_SYNC_TEST_BUNDLE_ID : FINDER_SYNC_BUNDLE_ID
}

export function finderSyncProtocol(testFeed) {
  return testFeed ? FINDER_TEST_PROTOCOL : FINDER_PROTOCOL
}

export function finderSyncMenuTitle(action, testFeed) {
  const base = action === FINDER_INSTALL_AS ? 'Install as…' : 'Install'
  return testFeed ? `${base} (Test)` : base
}

export function finderSyncUrlTypes(testFeed) {
  return [
    {
      CFBundleURLName: testFeed ? 'Font Buttler Test Finder Install' : 'Font Buttler Finder Install',
      CFBundleURLSchemes: [finderSyncProtocol(testFeed)],
    },
  ]
}

export function finderSyncAppexBundlePath(appPath) {
  return path.join(appPath, 'Contents', 'PlugIns', FINDER_SYNC_APPEX_NAME)
}

/**
 * Parse the URL the Finder Sync extension opens.
 * Install and Install as… only. Link to … stays on the Services channel.
 * A test build accepts only font-butler-test, so it cannot take a release handoff.
 * The returned paths are the selection and nothing else.
 */
export function parseFinderSyncChannel(rawUrl, { testFeed = false } = {}) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith(`${finderSyncProtocol(testFeed)}:`)) return null
  const parsed = parseFinderInstallUrl(rawUrl)
  if (!parsed || !isFinderInstallAction(parsed.action)) return null
  return { action: parsed.action, paths: [...parsed.paths] }
}

/**
 * Folders the extension should monitor.
 * `/` covers local disks. File Provider domains (Dropbox, iCloud Drive) are
 * not always treated as descendants of `/`, so the home directory, each
 * `~/Library/CloudStorage` child, `~/Library/Mobile Documents`, and iCloud
 * Drive are listed too. Missing paths are omitted. This does not walk fonts.
 */
export function finderSyncMonitorDirectories({ home, cloudChildren = [], exists } = {}) {
  const homePath = typeof home === 'string' ? home.replace(/\/+$/, '') : ''
  const homeParts = homePath.split('/').slice(1)
  const safeHome =
    homePath.startsWith('/') &&
    homePath !== '/' &&
    homeParts.length > 0 &&
    !homeParts.some((part) => part === '' || part === '.' || part === '..')
  const candidates = [FINDER_SYNC_MONITORED_ROOT]
  if (safeHome) {
    candidates.push(homePath)
    candidates.push(`${homePath}/${FINDER_SYNC_CLOUD_STORAGE_DIR}`)
    candidates.push(`${homePath}/${FINDER_SYNC_MOBILE_DOCUMENTS_DIR}`)
    candidates.push(`${homePath}/${FINDER_SYNC_ICLOUD_DRIVE_DIR}`)
    for (const child of cloudChildren) {
      if (typeof child !== 'string') continue
      const name = child.trim()
      if (!name || name.includes('/') || name.includes('\0') || name === '.' || name === '..') continue
      candidates.push(`${homePath}/${FINDER_SYNC_CLOUD_STORAGE_DIR}/${name}`)
    }
  }
  const seen = new Set()
  const directories = []
  for (const directory of candidates) {
    if (seen.has(directory)) continue
    seen.add(directory)
    if (typeof exists === 'function' && directory !== FINDER_SYNC_MONITORED_ROOT && !exists(directory)) continue
    directories.push(directory)
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

function inspectFontFile(filePath, io) {
  const parts = filePath.split('/').filter(Boolean)
  let current = ''
  let last = null
  for (const part of parts) {
    current = `${current}/${part}`
    let stat
    try {
      stat = io.lstatSync(current)
    } catch {
      return 'File not found.'
    }
    if (stat?.isSymbolicLink?.()) return 'Symlink paths are not installed.'
    last = stat
  }
  if (last?.isDirectory?.()) return null
  if (!last?.isFile?.()) return 'Not a regular file.'
  if (!isClaimedFontPath(filePath)) return 'Not a font file.'
  let header
  try {
    header = io.readPrefix(filePath, 4)
  } catch (error) {
    if (error?.code === 'ELOOP') return 'Symlink paths are not installed.'
    return 'Not a font file.'
  }
  if (!magicMatchesExtension(fontExtension(filePath), fontMagicKind(header))) return 'Not a font file.'
  return null
}

/**
 * Re-check a Finder Sync selection before the existing install flow.
 * Font files must be regular files with font magic. Folders are accepted as
 * folders and are not walked here; the Services install path imports them.
 * Symlinks are refused so a link cannot escape to a different file.
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

  const accepted = []
  for (const filePath of selection) {
    const reason = inspectFontFile(filePath, io)
    if (reason) rejected.push({ path: filePath, reason })
    else accepted.push(filePath)
  }

  const selectionSet = new Set(selection)
  const paths = accepted.filter((filePath) => selectionSet.has(filePath))
  if (paths.length > selection.length) {
    return {
      paths: [],
      rejected: [{ path: '', reason: 'The request included more files than the selection.' }],
    }
  }
  return { paths, rejected }
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

import { isClaimedFontPath, isFinderInstallAction, parseFinderInstallUrl } from './finder-install.mjs'

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

const MAX_PATH_LENGTH = 4096

export function finderSyncBundleId(testFeed) {
  return testFeed ? FINDER_SYNC_TEST_BUNDLE_ID : FINDER_SYNC_BUNDLE_ID
}

/**
 * Parse the URL the Finder Sync extension opens.
 * Install and Install as… only. Link to … stays on the Services channel.
 * The returned paths are the selection and nothing else.
 */
export function parseFinderSyncChannel(rawUrl) {
  const parsed = parseFinderInstallUrl(rawUrl)
  if (!parsed || !isFinderInstallAction(parsed.action)) return null
  return { action: parsed.action, paths: [...parsed.paths] }
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
  if (!last?.isFile?.()) return 'Not a regular file.'
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
 * Accepts only regular font files from that selection. Symlinks are refused
 * so a link cannot escape to a different file. Directories are not walked.
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
    if (!isSafeFinderSyncPath(filePath) || !isClaimedFontPath(filePath)) {
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

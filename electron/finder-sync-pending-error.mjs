import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'

export const FINDER_SYNC_PENDING_ERROR_FILE = 'finder-sync-pending-error.json'
export const FINDER_SYNC_PENDING_ERROR_MAX_BYTES = 8 * 1024
export const FINDER_SYNC_PENDING_ERROR_MAX_ENTRIES = 5
/** Codes the helper queues and the app shows. Anything else is ignored. */
export const FINDER_SYNC_PENDING_ERROR_CODES = ['missing-app', 'not-running', 'login-items', 'unknown-action']
/**
 * Application Support folder the release helper uses once no legacy library
 * remains. Fresh installs and a finished move both read this folder.
 */
export const FINDER_SYNC_RELEASE_SUPPORT_DIR = 'Cuttler'
/**
 * Libraries that still hold the app's data. Font Buttler (0.4.0) wins over
 * Font Butler (one t). The helper writes there so a stalled launch, a
 * not-yet-moved library, and a still-running 0.4.0 all read the same file.
 * A record written into a fresh Cuttler folder is deleted when that folder
 * is moved aside for the real library.
 */
export const FINDER_SYNC_LEGACY_SUPPORT_DIRS = ['Font Buttler', 'Font Butler']
/** Test-feed userData. Kept off the real Cuttler and Font Buttler folders. */
export const FINDER_SYNC_TEST_SUPPORT_DIR = 'Font Buttler Test'
/** Same files isFreshDataRoot uses. A symlink does not count. */
export const FINDER_SYNC_PENDING_ERROR_LIBRARY_FILES = ['catalog.json', 'settings.json']

const defaultReadIo = { openSync, fstatSync, readSync, closeSync }

function pendingErrorByteLength(text) {
  return Buffer.byteLength(typeof text === 'string' ? text : '', 'utf8')
}

/**
 * Known codes from a pending-error record. Unknown codes, free-form
 * messages, and a record over the size cap are ignored. At most
 * FINDER_SYNC_PENDING_ERROR_MAX_ENTRIES codes are kept.
 */
export function parseFinderSyncPendingErrorEntries(text) {
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
    if (!FINDER_SYNC_PENDING_ERROR_CODES.includes(code) || seen.has(code)) continue
    seen.add(code)
    errors.push({ code, at: typeof item?.at === 'number' ? item.at : 0 })
  }
  return errors
}

/**
 * Read the pending-error file without following a symlink. A regular file
 * is returned for deletion even when its contents are ignored.
 */
export function readFinderSyncPendingErrorRecord(filePath, io = defaultReadIo) {
  if (
    !filePath ||
    typeof io?.openSync !== 'function' ||
    typeof io?.fstatSync !== 'function' ||
    typeof io?.readSync !== 'function' ||
    typeof io?.closeSync !== 'function'
  ) {
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
    return {
      errors: parseFinderSyncPendingErrorEntries(buffer.subarray(0, got).toString('utf8')),
      discard: true,
      reason: 'ok',
    }
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

/**
 * Release folder for finder-sync-pending-error.json.
 * Test feed always uses its own directory.
 * An established legacy library wins, Font Buttler before Font Butler.
 * Otherwise Cuttler.
 */
export function finderSyncPendingErrorFolderName({ testFeed = false, established = [] } = {}) {
  if (testFeed === true) return FINDER_SYNC_TEST_SUPPORT_DIR
  const have = new Set(established)
  for (const name of FINDER_SYNC_LEGACY_SUPPORT_DIRS) {
    if (have.has(name)) return name
  }
  return FINDER_SYNC_RELEASE_SUPPORT_DIR
}

/** True when dir is a real directory containing a regular catalog or settings file. */
export function finderSyncSupportDirHasLibrary(dir) {
  if (!dir) return false
  let dirStat
  try {
    dirStat = lstatSync(dir)
  } catch {
    return false
  }
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return false
  for (const name of FINDER_SYNC_PENDING_ERROR_LIBRARY_FILES) {
    try {
      const fileStat = lstatSync(path.join(dir, name))
      if (fileStat.isFile() && !fileStat.isSymbolicLink()) return true
    } catch {
      // This marker is absent.
    }
  }
  return false
}

/** Directory the helper writes. Does not create it. */
export function finderSyncPendingErrorWriteDirectory(appSupportDir, { testFeed = false } = {}) {
  if (testFeed === true) return path.join(appSupportDir, FINDER_SYNC_TEST_SUPPORT_DIR)
  const established = []
  for (const name of FINDER_SYNC_LEGACY_SUPPORT_DIRS) {
    if (finderSyncSupportDirHasLibrary(path.join(appSupportDir, name))) established.push(name)
  }
  return path.join(appSupportDir, finderSyncPendingErrorFolderName({ established }))
}

/**
 * App-group container the sandboxed appex can write. The helper's
 * Application Support file is outside that sandbox, so a lookup that never
 * reaches the helper is recorded here instead.
 */
export function finderSyncGroupContainerDirectory(homeDir, group) {
  if (typeof homeDir !== 'string' || !homeDir.startsWith('/')) return ''
  if (typeof group !== 'string' || !group || group.includes('/') || group.includes('\0')) return ''
  return path.join(homeDir, 'Library/Group Containers', group)
}

/**
 * Files the app reads once, then deletes.
 * userData is first, then the app-group container. The other Application
 * Support folders are added only for a real Mac library. A test feed and a
 * FONT_BUTLER_DATA / FONTCASE_DATA launch pass includeOtherSupportDirs false
 * so they do not read or delete the installed app's record.
 */
export function finderSyncPendingErrorConsumePaths({
  userDataDir,
  appSupportDir,
  includeOtherSupportDirs = false,
  groupContainerDir = '',
} = {}) {
  const files = []
  const add = (dir) => {
    if (!dir) return
    const file = path.join(dir, FINDER_SYNC_PENDING_ERROR_FILE)
    const key = path.normalize(file)
    if (files.some((item) => path.normalize(item) === key)) return
    files.push(file)
  }
  add(userDataDir)
  add(groupContainerDir)
  if (includeOtherSupportDirs === true && appSupportDir) {
    add(path.join(appSupportDir, FINDER_SYNC_RELEASE_SUPPORT_DIR))
    for (const name of FINDER_SYNC_LEGACY_SUPPORT_DIRS) add(path.join(appSupportDir, name))
  }
  return files
}

function mergePendingErrorEntries(primary, extra) {
  const seen = new Set()
  const next = []
  for (const item of [...primary, ...extra]) {
    const code = typeof item?.code === 'string' ? item.code : ''
    if (!code || seen.has(code)) continue
    if (next.length >= FINDER_SYNC_PENDING_ERROR_MAX_ENTRIES) break
    seen.add(code)
    next.push({ code, at: typeof item?.at === 'number' ? item.at : 0 })
  }
  return next
}

function samePendingErrorEntries(left, right) {
  if (left.length !== right.length) return false
  return left.every((item, index) => item.code === right[index].code && item.at === right[index].at)
}

function writeAll(fd, buffer) {
  let sent = 0
  while (sent < buffer.length) {
    const count = writeSync(fd, buffer, sent, buffer.length - sent)
    if (count <= 0) return false
    sent += count
  }
  return true
}

/**
 * Replace filePath with a 0600 regular file. A symlink is left in place.
 * The temp file is created with O_NOFOLLOW | O_EXCL, then renamed over the record.
 */
function writeFinderSyncPendingErrorEntries(filePath, entries) {
  const payload = Buffer.from(JSON.stringify({ errors: entries }))
  if (payload.length === 0 || payload.length > FINDER_SYNC_PENDING_ERROR_MAX_BYTES) return false
  try {
    const current = lstatSync(filePath)
    if (!current.isFile()) return false
  } catch (error) {
    if (error?.code !== 'ENOENT') return false
  }
  const tmp = `${filePath}.${process.pid}.${process.hrtime.bigint()}.tmp`
  let fd
  try {
    fd = openSync(tmp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW | fsConstants.O_WRONLY, 0o600)
  } catch {
    return false
  }
  let ok = false
  try {
    fchmodSync(fd, 0o600)
    ok = writeAll(fd, payload)
    if (ok) fsyncSync(fd)
  } catch {
    ok = false
  } finally {
    try {
      closeSync(fd)
    } catch {
      ok = false
    }
  }
  if (!ok) {
    try {
      unlinkSync(tmp)
    } catch {
      // The temp file is already gone.
    }
    return false
  }
  try {
    renameSync(tmp, filePath)
  } catch {
    try {
      unlinkSync(tmp)
    } catch {
      // The temp file is already gone.
    }
    return false
  }
  return true
}

/**
 * Copy a queued Finder Sync error out of a fresh destination before the
 * library is renamed over it. moveDirectoryAtomic deletes that fresh folder.
 * Unknown codes are dropped. The source copy is 0600 and is not written
 * through a symlink. Failures return false and do not throw.
 */
export function carryFinderSyncPendingError(sourceDir, destDir) {
  if (!sourceDir || !destDir) return false
  let incoming
  try {
    incoming = readFinderSyncPendingErrorRecord(path.join(destDir, FINDER_SYNC_PENDING_ERROR_FILE))
  } catch {
    return false
  }
  if (!incoming.errors.length) return false
  const sourceFile = path.join(sourceDir, FINDER_SYNC_PENDING_ERROR_FILE)
  let existing = []
  try {
    existing = readFinderSyncPendingErrorRecord(sourceFile).errors
  } catch {
    return false
  }
  const merged = mergePendingErrorEntries(existing, incoming.errors)
  if (samePendingErrorEntries(existing, merged)) return false
  try {
    return writeFinderSyncPendingErrorEntries(sourceFile, merged)
  } catch {
    return false
  }
}

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { faceIdentityKey, loadCatalog, saveCatalog, writeCatalogBackup } from './catalog.ts'
import { fingerprintBuffer, fingerprintFile, entryKnownFingerprints, tryFingerprintFile } from './fingerprint.ts'
import { folderForPath } from './folders.ts'
import { inspectSfntTables, parseFontFile } from './parse.ts'
import type { AppPaths } from './paths.ts'
import { projectsPath } from './paths.ts'
import { loadProjects, saveProjects } from './projects.ts'
import { loadSettings, saveSettings } from './settings.ts'
import { normalizeSavedFilters } from './saved-filters.ts'
import { ensureSeedTags, normalizeFamilyTagAssignments } from '../shared/family-tags.ts'
import type { AppSettings, CatalogEntry, CatalogFile, ProjectSet } from './types.ts'

export const BACKUP_FORMAT_VERSION = 1
export const BACKUP_FORMAT = 'cuttlerbackup'
export const REDACTED = '[redacted]'

export const BACKUP_LICENSE_WARNING =
  'This backup contains your font files as well as your library organisation. It can be as large as your whole font library, and it may contain licensed fonts — keep the file private and only restore it on machines your licences cover.'

export const BACKUP_RESTORE_WARNING =
  'This backup may contain licensed fonts — only restore it on machines your licences cover.'

const SENSITIVE_KEY = /token|secret|password|passwd|api[_-]?key|authorization|credential|private[_-]?key/i

export function restoredFontsDir(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'Restored')
}

/* ------------------------------------------------------------------ */
/* Secret redaction                                                    */
/* ------------------------------------------------------------------ */

export function redactSecrets(value: unknown, basePath = ''): { redacted: unknown; keys: string[] } {
  const keys: string[] = []
  const walk = (input: unknown, trail: string): unknown => {
    if (Array.isArray(input)) return input.map((item, i) => walk(item, `${trail}[${i}]`))
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
        const here = trail ? `${trail}.${key}` : key
        if (SENSITIVE_KEY.test(key)) {
          keys.push(here)
          out[key] = REDACTED
        } else {
          out[key] = walk(item, here)
        }
      }
      return out
    }
    return input
  }
  return { redacted: walk(value, basePath), keys }
}

function collectRedactedKeys(value: unknown, trail = ''): string[] {
  const keys: string[] = []
  if (Array.isArray(value)) {
    value.forEach((item, i) => keys.push(...collectRedactedKeys(item, `${trail}[${i}]`)))
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const here = trail ? `${trail}.${key}` : key
      if (item === REDACTED) keys.push(here)
      else keys.push(...collectRedactedKeys(item, here))
    }
  }
  return keys
}

/* ------------------------------------------------------------------ */
/* Minimal ZIP writer / reader (stdlib only, no new dependency)      */
/* ------------------------------------------------------------------ */

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

export function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export type ZipEntryInput = { name: string; data: Buffer }

function safeZipName(name: string): string {
  const normalized = name.replace(/\\/g, '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error(`Unsafe path in backup archive: ${name}`)
  }
  return normalized
}

/** Write a ZIP archive (deflate) to `destinationPath`. Refuses to overwrite an existing file. */
export function writeZipFile(destinationPath: string, entries: ZipEntryInput[]): void {
  if (fs.existsSync(destinationPath)) throw new Error(`A file already exists at ${destinationPath}`)
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  const tmp = `${destinationPath}.${process.pid}.${Date.now()}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    const central: Buffer[] = []
    let offset = 0
    for (const entry of entries) {
      const name = safeZipName(entry.name)
      const nameBuf = Buffer.from(name, 'utf8')
      const compressed = zlib.deflateSync(entry.data, { level: 6 })
      const crc = crc32(entry.data)
      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(0x0800, 6) // UTF-8 names
      local.writeUInt16LE(8, 8) // deflate
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(compressed.length, 18)
      local.writeUInt32LE(entry.data.length, 22)
      local.writeUInt16LE(nameBuf.length, 26)
      fs.writeSync(fd, local)
      fs.writeSync(fd, nameBuf)
      fs.writeSync(fd, compressed)

      const cen = Buffer.alloc(46)
      cen.writeUInt32LE(0x02014b50, 0)
      cen.writeUInt16LE(20, 4)
      cen.writeUInt16LE(20, 6)
      cen.writeUInt16LE(0x0800, 8)
      cen.writeUInt16LE(8, 10)
      cen.writeUInt32LE(crc, 16)
      cen.writeUInt32LE(compressed.length, 20)
      cen.writeUInt32LE(entry.data.length, 24)
      cen.writeUInt16LE(nameBuf.length, 28)
      cen.writeUInt32LE(offset, 42)
      central.push(cen, nameBuf)
      offset += 30 + nameBuf.length + compressed.length
    }
    const centralStart = offset
    for (const buf of central) {
      fs.writeSync(fd, buf)
      offset += buf.length
    }
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    const count = entries.length
    eocd.writeUInt16LE(count, 8)
    eocd.writeUInt16LE(count, 10)
    eocd.writeUInt32LE(offset - centralStart, 12)
    eocd.writeUInt32LE(centralStart, 16)
    fs.writeSync(fd, eocd)
    fs.closeSync(fd)
    fs.renameSync(tmp, destinationPath)
  } catch (error) {
    try { fs.closeSync(fd) } catch { /* already closed */ }
    try { fs.rmSync(tmp, { force: true }) } catch { /* best effort */ }
    throw error
  }
}

type CentralEntry = {
  name: string
  method: number
  crc: number
  compressedSize: number
  size: number
  localOffset: number
}

function readCentralDirectory(fd: number, fileSize: number): CentralEntry[] {
  const tailSize = Math.min(fileSize, 22 + 65535)
  const tail = Buffer.alloc(tailSize)
  fs.readSync(fd, tail, 0, tailSize, fileSize - tailSize)
  let eocd = -1
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd === -1) throw new Error('This file is not a valid .cuttlerbackup archive (no zip directory).')
  const count = tail.readUInt16LE(eocd + 10)
  const centralSize = tail.readUInt32LE(eocd + 12)
  const centralOffset = tail.readUInt32LE(eocd + 16)
  if (centralOffset + centralSize > fileSize) throw new Error('This backup archive is damaged (zip directory out of bounds).')
  const central = Buffer.alloc(centralSize)
  fs.readSync(fd, central, 0, centralSize, centralOffset)
  const entries: CentralEntry[] = []
  let pos = 0
  for (let i = 0; i < count; i++) {
    if (pos + 46 > central.length || central.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error('This backup archive is damaged (zip directory is unreadable).')
    }
    const nameLen = central.readUInt16LE(pos + 28)
    const extraLen = central.readUInt16LE(pos + 30)
    const commentLen = central.readUInt16LE(pos + 32)
    const name = central.subarray(pos + 46, pos + 46 + nameLen).toString('utf8')
    entries.push({
      name: safeZipName(name),
      method: central.readUInt16LE(pos + 10),
      crc: central.readUInt32LE(pos + 16),
      compressedSize: central.readUInt32LE(pos + 20),
      size: central.readUInt32LE(pos + 24),
      localOffset: central.readUInt32LE(pos + 42),
    })
    pos += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function extractEntry(fd: number, entry: CentralEntry): Buffer {
  const header = Buffer.alloc(30)
  fs.readSync(fd, header, 0, 30, entry.localOffset)
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`This backup archive is damaged (bad entry ${entry.name}).`)
  const nameLen = header.readUInt16LE(26)
  const extraLen = header.readUInt16LE(28)
  const dataStart = entry.localOffset + 30 + nameLen + extraLen
  const compressed = Buffer.alloc(entry.compressedSize)
  fs.readSync(fd, compressed, 0, entry.compressedSize, dataStart)
  let data: Buffer
  if (entry.method === 0) data = compressed
  else if (entry.method === 8) data = zlib.inflateSync(compressed)
  else throw new Error(`This backup archive uses an unsupported compression method for ${entry.name}.`)
  if (data.length !== entry.size) throw new Error(`This backup archive is damaged (size mismatch for ${entry.name}).`)
  if (crc32(data) !== entry.crc) throw new Error(`This backup archive is damaged (checksum mismatch for ${entry.name}).`)
  return data
}

/** Read every entry of a zip archive into memory. Intended for JSON entries and tests. */
export function readZipFile(archivePath: string): Map<string, Buffer> {
  const fd = fs.openSync(archivePath, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const out = new Map<string, Buffer>()
    for (const entry of readCentralDirectory(fd, size)) {
      if (out.has(entry.name)) throw new Error(`This backup archive contains a duplicate entry: ${entry.name}`)
      out.set(entry.name, extractEntry(fd, entry))
    }
    return out
  } finally {
    fs.closeSync(fd)
  }
}

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

export type BackupActivation = 'on' | 'off' | 'temporary'

export type BackupEntryRef = {
  entryId: string
  sourcePath: string
  installedPath?: string
  disabledPath?: string
  installations?: Array<{ path: string; parkedPath?: string }>
  ownerWatchFolderRoot?: string
  /** Whether this entry was on in the backed-up library. Temporary/session stays off. */
  activation?: BackupActivation
}

/** Was-on state recorded in the archive. Temporary/session activations never come back on. */
export function backupActivationFor(entry: CatalogEntry): BackupActivation {
  if (entry.temporaryActivation) return 'temporary'
  return entry.status === 'installed' || entry.status === 'outdated' ? 'on' : 'off'
}

const PROTECTED_PREFIXES = ['/System/', '/Library/Application Support/Apple/', '/usr/', '/private/']

/**
 * Cicero's `ActivationEngine.isProtected` inventory skip, exactly: a prefix of
 * `/System/`, `/Library/Application Support/Apple/`, `/usr/`, or `/private/`;
 * any path inside a `.app` bundle; or any Adobe Fonts (CoreSync) path.
 * `/Library/Fonts` and the Adobe shared fonts folder are NOT protected and
 * are archived like any other font location.
 */
export function isProtectedFontPath(filePath: string, _paths?: AppPaths): boolean {
  void _paths
  const resolved = path.resolve(filePath)
  if (PROTECTED_PREFIXES.some((prefix) => resolved.startsWith(prefix))) return true
  if (resolved.includes('.app/')) return true
  if (resolved.includes('/Adobe/CoreSync/')) return true
  return false
}

export type BackupFileEntry = {
  fingerprint: string
  archivePath: string
  fileName: string
  size: number
  faceIdentityKey: string | null
  format: string
  entries: BackupEntryRef[]
}

export type BackupMissingFile = { entryId: string; path: string; reason: string }

export type BackupManifest = {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  appVersion: string
  createdAt: string
  /** False for a metadata-only backup (Cicero's `includeFonts: false`). */
  includesFonts: boolean
  counts: { catalogEntries: number; fontFiles: number; projects: number; familyTags: number; savedFilters: number }
  files: BackupFileEntry[]
  missingFiles: BackupMissingFile[]
  /** Protected system / app / Adobe Fonts paths deliberately left out of the archive. */
  skippedProtected: BackupMissingFile[]
  redactedSettingsKeys: string[]
  /** SHA-256 of each JSON sidecar, so a re-packed archive with edited organisation data is refused. */
  sidecarSha256?: Record<string, string>
}

export type BackupPreview = {
  includesFonts: boolean
  catalogEntries: number
  fontFiles: number
  projects: number
  familyTags: number
  savedFilters: number
  uncompressedSize: number
  missingFiles: BackupMissingFile[]
  skippedProtected: BackupMissingFile[]
  redactedSettingsKeys: string[]
  warning: string
}

type Collected = {
  manifest: BackupManifest
  catalog: CatalogFile
  projects: ProjectSet[]
  settings: AppSettings
  fontData: Map<string, Buffer>
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[\\/:*?"<>|]/g, '_').trim()
  return base || 'font'
}

function appVersionFromPackage(): string {
  try {
    const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'package.json')
    const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function collectLibrary(paths: AppPaths, appVersion: string, includeFonts = true): Collected {
  const catalog = loadCatalog(paths)
  const projects = loadProjects(paths)
  const settings = loadSettings(paths)
  const { redacted, keys } = redactSecrets(settings)
  const redactedSettings = redacted as AppSettings

  const byFingerprint = new Map<string, BackupFileEntry & { data?: Buffer }>()
  const missingFiles: BackupMissingFile[] = []
  const skippedProtected: BackupMissingFile[] = []
  const fontData = new Map<string, Buffer>()

  for (const entry of catalog.entries) {
    const candidates: Array<{ filePath: string }> = [
      { filePath: entry.sourcePath },
      ...(entry.installedPath ? [{ filePath: entry.installedPath }] : []),
      ...(entry.disabledPath ? [{ filePath: entry.disabledPath }] : []),
      ...(entry.installations ?? []).flatMap((copy) => [
        { filePath: copy.path },
        ...(copy.parkedPath ? [{ filePath: copy.parkedPath }] : []),
      ]),
    ]
    const seenPaths = new Set<string>()
    let anyPresent = false
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate.filePath)
      if (seenPaths.has(resolved)) continue
      seenPaths.add(resolved)
      if (isProtectedFontPath(resolved, paths)) {
        skippedProtected.push({ entryId: entry.id, path: candidate.filePath, reason: 'Protected system, app, or Adobe Fonts path — not archived.' })
        continue
      }
      if (!includeFonts) continue
      if (!fs.existsSync(resolved)) {
        missingFiles.push({ entryId: entry.id, path: candidate.filePath, reason: 'File was not present when the backup was made.' })
        continue
      }
      let fingerprint: string
      try {
        fingerprint = fingerprintFile(resolved)
      } catch {
        missingFiles.push({ entryId: entry.id, path: candidate.filePath, reason: 'File could not be read when the backup was made.' })
        continue
      }
      anyPresent = true
      const owner = folderForPath(settings.folders, entry.sourcePath)
      const ref: BackupEntryRef = {
        entryId: entry.id,
        sourcePath: entry.sourcePath,
        ...(entry.installedPath ? { installedPath: entry.installedPath } : {}),
        ...(entry.disabledPath ? { disabledPath: entry.disabledPath } : {}),
        ...(entry.installations?.length
          ? { installations: entry.installations.map((c) => ({ path: c.path, ...(c.parkedPath ? { parkedPath: c.parkedPath } : {}) })) }
          : {}),
        ...(owner ? { ownerWatchFolderRoot: owner.root } : {}),
        activation: backupActivationFor(entry),
      }
      const existing = byFingerprint.get(fingerprint)
      if (existing) {
        if (!existing.entries.some((r) => r.entryId === entry.id)) existing.entries.push(ref)
        continue
      }
      const fileName = sanitizeFileName(candidate.filePath)
      const data = fs.readFileSync(resolved)
      // Guard against the file changing between fingerprint and read.
      if (fingerprintBuffer(data) !== fingerprint) {
        missingFiles.push({ entryId: entry.id, path: candidate.filePath, reason: 'File changed while the backup was being made.' })
        continue
      }
      fontData.set(fingerprint, data)
      byFingerprint.set(fingerprint, {
        fingerprint,
        archivePath: `fonts/${fingerprint}/${fileName}`,
        fileName,
        size: data.length,
        faceIdentityKey: faceIdentityKey(entry.faces, entry.format),
        format: entry.format,
        entries: [ref],
      })
    }
    if (!anyPresent && candidates.length > 0) {
      // Already recorded per-path above; entry will be unrestorable and named on restore.
    }
  }

  const files: BackupFileEntry[] = [...byFingerprint.values()].map(({ ...rest }) => rest)
  const tags = catalog.tags ?? []
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion,
    createdAt: new Date().toISOString(),
    counts: {
      catalogEntries: catalog.entries.length,
      fontFiles: files.length,
      projects: projects.length,
      familyTags: tags.length,
      savedFilters: (redactedSettings.savedFilters ?? []).length,
    },
    includesFonts: includeFonts,
    files,
    missingFiles,
    skippedProtected,
    redactedSettingsKeys: keys,
  }
  return { manifest, catalog, projects, settings: redactedSettings, fontData }
}

function toPreview(manifest: BackupManifest, fontData: Map<string, Buffer>): BackupPreview {
  let uncompressedSize = 0
  for (const data of fontData.values()) uncompressedSize += data.length
  return {
    includesFonts: manifest.includesFonts !== false,
    catalogEntries: manifest.counts.catalogEntries,
    fontFiles: manifest.counts.fontFiles,
    projects: manifest.counts.projects,
    familyTags: manifest.counts.familyTags,
    savedFilters: manifest.counts.savedFilters,
    uncompressedSize,
    missingFiles: manifest.missingFiles,
    skippedProtected: manifest.skippedProtected ?? [],
    redactedSettingsKeys: manifest.redactedSettingsKeys,
    warning: BACKUP_LICENSE_WARNING,
  }
}

export function previewBackup(paths: AppPaths, options: { includeFonts?: boolean } = {}): BackupPreview {
  const { manifest, fontData } = collectLibrary(paths, appVersionFromPackage(), options.includeFonts !== false)
  return toPreview(manifest, fontData)
}

export function createBackup(
  paths: AppPaths,
  options: { destinationPath: string; appVersion?: string; includeFonts?: boolean },
): { destinationPath: string; manifest: BackupManifest; size: number; preview: BackupPreview } {
  const destinationPath = path.resolve(options.destinationPath)
  if (!destinationPath.endsWith('.cuttlerbackup')) {
    throw new Error('Backup files use the .cuttlerbackup extension.')
  }
  if (fs.existsSync(destinationPath)) throw new Error(`A file already exists at ${destinationPath}`)
  const collected = collectLibrary(paths, options.appVersion ?? appVersionFromPackage(), options.includeFonts !== false)
  const { manifest, catalog, projects, settings, fontData } = collected
  const familyTagsPayload = { tags: catalog.tags ?? [], familyTags: catalog.familyTags ?? [] }
  const sidecars: ZipEntryInput[] = [
    { name: 'catalog.json', data: Buffer.from(JSON.stringify(catalog, null, 2)) },
    { name: 'projects.json', data: Buffer.from(JSON.stringify({ version: 2, projects }, null, 2)) },
    { name: 'family-tags.json', data: Buffer.from(JSON.stringify(familyTagsPayload, null, 2)) },
    { name: 'settings.json', data: Buffer.from(JSON.stringify(settings, null, 2)) },
    { name: 'saved-filters.json', data: Buffer.from(JSON.stringify(settings.savedFilters ?? [], null, 2)) },
  ]
  manifest.sidecarSha256 = Object.fromEntries(sidecars.map((s) => [s.name, fingerprintBuffer(s.data)]))
  const entries: ZipEntryInput[] = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    ...sidecars,
  ]
  for (const file of manifest.files) {
    const data = fontData.get(file.fingerprint)
    if (!data) throw new Error(`A font file disappeared while the backup was being made: ${file.fileName}`)
    entries.push({ name: file.archivePath, data })
  }
  writeZipFile(destinationPath, entries)
  return {
    destinationPath,
    manifest,
    size: fs.statSync(destinationPath).size,
    preview: toPreview(manifest, fontData),
  }
}

/* ------------------------------------------------------------------ */
/* Restore                                                             */
/* ------------------------------------------------------------------ */

export type RestoreFailure = {
  entryId?: string
  fileName: string
  fingerprint?: string
  reason: 'hash-mismatch' | 'parse-failed' | 'missing-in-archive' | 'unrestorable'
  message: string
}

export type RestoreOptions = {
  /** Restore font files and catalog font entries. Default true. */
  restoreFonts?: boolean
  /** Replace projects, smart projects, tags, and settings (after a snapshot). Default true. */
  restoreOrganization?: boolean
}

export type RestoreReport = {
  includesFonts: boolean
  restoreFonts: boolean
  restoreOrganization: boolean
  restored: Array<{ entryId: string; newEntryId: string; fingerprint: string; fileName: string; restoredPath: string; faceIdentityKey: string | null; reactivated: boolean }>
  /** Files already on disk at the recorded path, left exactly as they were (no fingerprint check). */
  leftAsIs: Array<{ entryId: string; newEntryId: string; fileName: string; recordedPath: string }>
  reactivated: Array<{ entryId: string; newEntryId: string; fileName: string }>
  skippedIdentical: Array<{ entryId: string; existingEntryId: string; fingerprint: string; fileName: string }>
  parkedAsExtra: Array<{ entryId: string; newEntryId: string; fingerprint: string; fileName: string; conflictingEntryId: string; faceIdentityKey: string | null }>
  failed: RestoreFailure[]
  watchFoldersRestoredPaused: Array<{ root: string }>
  watchFoldersNotRestored: Array<{ root: string; reason: string }>
  settingsKeysSkipped: string[]
  settingsRestoredKeys: string[]
  /** Projects now present from the backup (organization replace). */
  projectsRestored: number
  projectsMerged: number
  projectsSkipped: number
  projectMembersUnresolved: Array<{ projectName: string; assetId: string }>
  familyTagsRestored: number
  savedFiltersRestored: number
  catalogBackupPath: string | null
  /** Directory holding the pre-restore snapshot of the current library data, when organization was replaced. */
  snapshotPath: string | null
  warning: string
}

type VerifiedArchive = {
  manifest: BackupManifest
  catalog: CatalogFile
  projects: ProjectSet[]
  familyTagsPayload: { tags: CatalogFile['tags']; familyTags: CatalogFile['familyTags'] }
  settings: Partial<AppSettings> & Record<string, unknown>
  savedFilters: unknown
  verified: Map<string, { stagedPath: string; file: BackupFileEntry }>
  failed: RestoreFailure[]
  stagingDir: string
}

function parseJsonEntry<T>(entries: Map<string, Buffer>, name: string, required: boolean): T | undefined {
  const raw = entries.get(name)
  if (!raw) {
    if (required) throw new Error(`This backup is missing ${name} and cannot be restored.`)
    return undefined
  }
  try {
    return JSON.parse(raw.toString('utf8')) as T
  } catch {
    throw new Error(`This backup contains unreadable ${name} and cannot be restored.`)
  }
}

/**
 * Unpack fonts to a staging dir and verify every file: SHA-256 against the
 * manifest, then an sfnt/parse check. Files that fail are never staged as
 * verified and are named in `failed`.
 */
function verifyArchive(archivePath: string): VerifiedArchive {
  if (!fs.existsSync(archivePath)) throw new Error('That backup file could not be found.')
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuttler-restore-'))
  try {
    const fd = fs.openSync(archivePath, 'r')
    let central: CentralEntry[]
    try {
      central = readCentralDirectory(fd, fs.fstatSync(fd).size)
    } finally {
      // extractEntry needs the fd; reopen pattern below keeps it open instead.
    }
    // Re-open for extraction (readCentralDirectory does not close).
    const entries = new Map<string, Buffer>()
    const fontEntries = new Map<string, Buffer>()
    try {
      for (const entry of central) {
        // JSON sidecars are small; fonts are extracted one at a time below via the same reader.
        const data = extractEntry(fd, entry)
        if (entry.name.startsWith('fonts/')) fontEntries.set(entry.name, data)
        else entries.set(entry.name, data)
      }
    } finally {
      fs.closeSync(fd)
    }

    const manifest = parseJsonEntry<BackupManifest>(entries, 'manifest.json', true)!
    if (!manifest || manifest.format !== BACKUP_FORMAT) {
      throw new Error('This file is not a Cuttler backup.')
    }
    if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new Error(
        `This backup uses format version ${String(manifest.formatVersion)}, but this version of Cuttler can only restore format version ${BACKUP_FORMAT_VERSION}. Update Cuttler and try again.`,
      )
    }
    if (!Array.isArray(manifest.files)) throw new Error('This backup manifest is damaged (no font list).')

    // A re-packed archive with edited organisation data is refused outright:
    // nothing — fonts or organisation — is applied from a tampered file.
    if (manifest.sidecarSha256) {
      for (const [name, expected] of Object.entries(manifest.sidecarSha256)) {
        const data = entries.get(name)
        if (!data || fingerprintBuffer(data) !== expected) {
          throw new Error(`This backup has been changed since it was made (${name} does not match its fingerprint). Restore was refused and nothing was changed.`)
        }
      }
    }

    const catalog = parseJsonEntry<CatalogFile>(entries, 'catalog.json', true)!
    if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.entries)) {
      throw new Error('This backup contains an unreadable catalog and cannot be restored.')
    }
    const projectsFile = parseJsonEntry<{ projects?: ProjectSet[] }>(entries, 'projects.json', false)
    const projects = Array.isArray(projectsFile?.projects) ? projectsFile!.projects : []
    const familyTagsPayload = parseJsonEntry<{ tags: CatalogFile['tags']; familyTags: CatalogFile['familyTags'] }>(
      entries, 'family-tags.json', false,
    ) ?? { tags: catalog.tags, familyTags: catalog.familyTags }
    const settings = parseJsonEntry<Partial<AppSettings> & Record<string, unknown>>(entries, 'settings.json', false) ?? {}
    const savedFilters = parseJsonEntry<unknown>(entries, 'saved-filters.json', false)

    const failed: RestoreFailure[] = []
    const verified = new Map<string, { stagedPath: string; file: BackupFileEntry }>()
    const entryFileNames = new Map<string, string>()
    for (const file of manifest.files as BackupFileEntry[]) {
      for (const ref of file.entries ?? []) entryFileNames.set(ref.entryId, file.fileName)
    }

    for (const file of manifest.files as BackupFileEntry[]) {
      const label = file.fileName || file.archivePath || file.fingerprint
      if (!/^[a-f0-9]{64}$/.test(file.fingerprint ?? '')) {
        failed.push({ fileName: label, fingerprint: file.fingerprint, reason: 'hash-mismatch', message: `${label}: the manifest fingerprint is not a SHA-256 hash.` })
        continue
      }
      const expectedPrefix = `fonts/${file.fingerprint}/`
      if (!file.archivePath?.startsWith(expectedPrefix)) {
        failed.push({ fileName: label, fingerprint: file.fingerprint, reason: 'hash-mismatch', message: `${label}: the archive path does not match its fingerprint.` })
        continue
      }
      const data = fontEntries.get(file.archivePath)
      if (!data) {
        for (const ref of file.entries ?? []) {
          failed.push({ entryId: ref.entryId, fileName: label, fingerprint: file.fingerprint, reason: 'missing-in-archive', message: `${label} is missing from the backup archive.` })
        }
        if (!file.entries?.length) failed.push({ fileName: label, fingerprint: file.fingerprint, reason: 'missing-in-archive', message: `${label} is missing from the backup archive.` })
        continue
      }
      if (data.length !== file.size || fingerprintBuffer(data) !== file.fingerprint) {
        for (const ref of file.entries ?? []) {
          failed.push({ entryId: ref.entryId, fileName: label, fingerprint: file.fingerprint, reason: 'hash-mismatch', message: `${label} does not match its SHA-256 fingerprint and was not restored.` })
        }
        if (!file.entries?.length) failed.push({ fileName: label, fingerprint: file.fingerprint, reason: 'hash-mismatch', message: `${label} does not match its SHA-256 fingerprint and was not restored.` })
        continue
      }
      const stagedPath = path.join(stagingDir, file.fingerprint, sanitizeFileName(file.fileName))
      fs.mkdirSync(path.dirname(stagedPath), { recursive: true })
      fs.writeFileSync(stagedPath, data)
      const sfnt = inspectSfntTables(stagedPath)
      let parseFailed = !sfnt.ok
      if (!parseFailed) {
        // Web fonts pass inspectSfntTables by design; a full parse is the second gate where fontkit supports it.
        try {
          const parsed = parseFontFile(stagedPath)
          if (!parsed.faces?.length) parseFailed = true
        } catch {
          parseFailed = true
        }
      }
      if (parseFailed) {
        try { fs.rmSync(stagedPath, { force: true }) } catch { /* best effort */ }
        const reason = sfnt.ok === false ? sfnt.reason : 'The font could not be parsed.'
        for (const ref of file.entries ?? []) {
          failed.push({ entryId: ref.entryId, fileName: label, fingerprint: file.fingerprint, reason: 'parse-failed', message: `${label} failed verification (${reason}) and was not restored.` })
        }
        if (!file.entries?.length) failed.push({ fileName: label, fingerprint: file.fingerprint, reason: 'parse-failed', message: `${label} failed verification (${reason}) and was not restored.` })
        continue
      }
      verified.set(file.fingerprint, { stagedPath, file })
    }

    // Fonts referenced by the catalog but absent from verified set are named via manifest refs.
    void entryFileNames
    // A font that fails its hash (or is missing from the archive) means the
    // archive contents were changed after it was made. Refuse the whole
    // restore — no fonts, no organisation — rather than partially applying
    // a tampered backup. Parse failures keep the per-font report path: a
    // hash-matching file that cannot be parsed is named and skipped.
    const tampered = failed.find((f) => f.reason === 'hash-mismatch' || f.reason === 'missing-in-archive')
    if (tampered) {
      throw new Error(`This backup has been changed since it was made (${tampered.message}) Restore was refused and nothing was changed.`)
    }
    return { manifest, catalog, projects, familyTagsPayload, settings, savedFilters, verified, failed, stagingDir }
  } catch (error) {
    try { fs.rmSync(stagingDir, { recursive: true, force: true }) } catch { /* best effort */ }
    throw error
  }
}

function chooseFingerprintForEntry(
  entry: CatalogEntry,
  manifest: BackupManifest,
): { fingerprint: string; file: BackupFileEntry } | undefined {
  const referencing = manifest.files.filter((f) => f.entries?.some((r) => r.entryId === entry.id))
  if (referencing.length === 0) return undefined
  if (entry.sourceFingerprint) {
    const match = referencing.find((f) => f.fingerprint === entry.sourceFingerprint)
    if (match) return { fingerprint: match.fingerprint, file: match }
  }
  const first = referencing[0]
  return first ? { fingerprint: first.fingerprint, file: first } : undefined
}

function existingFingerprintMap(catalog: CatalogFile): Map<string, CatalogEntry> {
  const map = new Map<string, CatalogEntry>()
  for (const entry of catalog.entries) {
    for (const fp of entryKnownFingerprints(entry)) if (!map.has(fp)) map.set(fp, entry)
    const candidates = [entry.sourcePath, entry.installedPath, entry.disabledPath,
      ...(entry.installations ?? []).flatMap((c) => [c.path, c.parkedPath])]
    for (const candidate of candidates) {
      if (!candidate) continue
      const fp = tryFingerprintFile(candidate)
      if (fp && !map.has(fp)) map.set(fp, entry)
    }
  }
  return map
}

function allocateRestoredPath(paths: AppPaths, fingerprint: string, fileName: string, stagedPath: string): string {
  const dir = path.join(restoredFontsDir(paths), fingerprint)
  fs.mkdirSync(dir, { recursive: true })
  const safe = sanitizeFileName(fileName)
  const ext = path.extname(safe)
  const stem = ext ? safe.slice(0, -ext.length) : safe
  const candidates = [path.join(dir, safe), path.join(dir, `${stem}-${fingerprint.slice(0, 8)}${ext}`)]
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      fs.copyFileSync(stagedPath, candidate)
      return candidate
    }
    if (tryFingerprintFile(candidate) === fingerprint) return candidate
    // Different bytes at this path: never overwrite, fall through to the next name.
  }
  let counter = 2
  for (;;) {
    const candidate = path.join(dir, `${stem}-${fingerprint.slice(0, 8)}-${counter}${ext}`)
    if (!fs.existsSync(candidate)) {
      fs.copyFileSync(stagedPath, candidate)
      return candidate
    }
    if (tryFingerprintFile(candidate) === fingerprint) return candidate
    counter++
  }
}

function fileIsFile(filePath: string | undefined): filePath is string {
  if (!filePath) return false
  try { return fs.statSync(filePath).isFile() } catch { return false }
}

/** First recorded path (source, then installed, then parked) that already holds a file on this machine. */
function existingRecordedPath(entry: CatalogEntry): string | undefined {
  const candidates = [
    entry.sourcePath,
    entry.installedPath,
    entry.disabledPath,
    ...(entry.installations ?? []).flatMap((c) => [c.path, c.parkedPath]),
  ]
  return candidates.find((candidate) => candidate && fileIsFile(candidate) && !isProtectedFontPath(candidate))
}

/**
 * Place verified bytes for an entry: back at the recorded source path when its
 * folder is still there (and not protected), otherwise under the restore vault.
 * A file already at the destination is never overwritten.
 */
function placeRestoredBytes(
  paths: AppPaths,
  entry: CatalogEntry,
  fingerprint: string,
  fileName: string,
  stagedPath: string,
): string {
  const recorded = entry.sourcePath
  if (
    recorded &&
    !isProtectedFontPath(recorded, paths) &&
    fs.existsSync(path.dirname(recorded)) &&
    fs.statSync(path.dirname(recorded)).isDirectory()
  ) {
    const dest = path.resolve(recorded)
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(stagedPath, dest)
      return dest
    }
    if (fileIsFile(dest)) return dest // left as-is; caller treats recorded paths before this
  }
  return allocateRestoredPath(paths, fingerprint, fileName, stagedPath)
}

/**
 * Copy restored bytes into the install dir for a font that was on. Never
 * overwrites an existing file: a different file already at
 * `installDir/<fileName>` is left alone and the restored copy gets a new
 * name — that other file is not the restored copy and must not be
 * reported as a reactivation.
 */
function placeInstalledCopy(paths: AppPaths, sourcePath: string, fileName: string): string {
  fs.mkdirSync(paths.installDir, { recursive: true })
  const safe = sanitizeFileName(fileName)
  const dest = path.join(paths.installDir, safe)
  if (path.resolve(sourcePath) === path.resolve(dest)) return dest
  if (fs.existsSync(dest)) {
    // Only the identical bytes count as the copy already being there.
    const sourceFingerprint = tryFingerprintFile(sourcePath)
    if (sourceFingerprint && tryFingerprintFile(dest) === sourceFingerprint) return dest
  }
  const ext = path.extname(safe)
  const stem = ext ? safe.slice(0, -ext.length) : safe
  let candidate = dest
  let counter = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(paths.installDir, `${stem}-${counter}${ext}`)
    counter++
  }
  fs.copyFileSync(sourcePath, candidate)
  return candidate
}

function snapshotCurrentLibrary(paths: AppPaths, stagingDir: string): { snapshotPath: string; catalogBackupPath: string | null } {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const snapshotPath = path.join(paths.dataRoot, 'Backups', `restore-snapshot-${stamp}`)
  fs.mkdirSync(snapshotPath, { recursive: true })
  let catalogBackupPath: string | null = null
  if (fs.existsSync(paths.catalogPath)) {
    writeCatalogBackup(paths.catalogPath)
    catalogBackupPath = path.join(path.dirname(paths.catalogPath), 'catalog.json.bak')
    fs.copyFileSync(paths.catalogPath, path.join(snapshotPath, 'catalog.json'))
    // Preserve the pre-restore snapshot across the saveCatalog() calls below, which refresh .bak.
    const keep = path.join(stagingDir, 'catalog-before-restore.json')
    if (catalogBackupPath && fs.existsSync(catalogBackupPath)) fs.copyFileSync(catalogBackupPath, keep)
  }
  const projectsFile = projectsPath(paths)
  if (fs.existsSync(projectsFile)) fs.copyFileSync(projectsFile, path.join(snapshotPath, 'projects.json'))
  else fs.writeFileSync(path.join(snapshotPath, 'projects.json'), JSON.stringify({ version: 2, projects: loadProjects(paths) }, null, 2))
  if (fs.existsSync(paths.settingsPath)) fs.copyFileSync(paths.settingsPath, path.join(snapshotPath, 'settings.json'))
  else fs.writeFileSync(path.join(snapshotPath, 'settings.json'), JSON.stringify(loadSettings(paths), null, 2))
  const catalog = fs.existsSync(paths.catalogPath) ? loadCatalog(paths) : { tags: [], familyTags: [] }
  fs.writeFileSync(
    path.join(snapshotPath, 'family-tags.json'),
    JSON.stringify({ tags: catalog.tags ?? [], familyTags: catalog.familyTags ?? [] }, null, 2),
  )
  return { snapshotPath, catalogBackupPath }
}

/** Normalize a raw (redacted) backup settings object through the normal settings reader. */
function normalizeBackupSettings(raw: Record<string, unknown>, paths: AppPaths, stagingDir: string): AppSettings {
  const tempPath = path.join(stagingDir, 'backup-settings.json')
  fs.writeFileSync(tempPath, JSON.stringify(raw))
  const fake = { ...paths, settingsPath: tempPath } as AppPaths
  return loadSettings(fake)
}

/** Where a backup value is the redaction marker, keep the current value instead of writing the marker back. */
function preserveRedacted(current: unknown, incoming: unknown): unknown {
  if (incoming === REDACTED) return current
  if (Array.isArray(incoming)) return incoming
  if (incoming && typeof incoming === 'object' && current && typeof current === 'object' && !Array.isArray(current)) {
    const out: Record<string, unknown> = { ...(incoming as Record<string, unknown>) }
    for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
      out[key] = preserveRedacted((current as Record<string, unknown>)[key], value)
    }
    return out
  }
  return incoming
}

function emptyReport(options: RestoreOptions = {}, includesFonts = true): RestoreReport {
  return {
    includesFonts,
    restoreFonts: options.restoreFonts !== false,
    restoreOrganization: options.restoreOrganization !== false,
    restored: [], leftAsIs: [], reactivated: [], skippedIdentical: [], parkedAsExtra: [], failed: [],
    watchFoldersRestoredPaused: [], watchFoldersNotRestored: [],
    settingsKeysSkipped: [], settingsRestoredKeys: [],
    projectsRestored: 0, projectsMerged: 0, projectsSkipped: 0,
    projectMembersUnresolved: [], familyTagsRestored: 0, savedFiltersRestored: 0,
    catalogBackupPath: null, snapshotPath: null, warning: BACKUP_RESTORE_WARNING,
  }
}

function watchRootsOf(settings: Partial<AppSettings> & Record<string, unknown>): string[] {
  const folders = Array.isArray(settings.folders) ? (settings.folders as Array<{ root?: unknown }>) : []
  if (folders.length) return folders.map((f) => (typeof f?.root === 'string' ? f.root : '')).filter(Boolean)
  return Array.isArray(settings.watchFolders)
    ? (settings.watchFolders as unknown[]).filter((r): r is string => typeof r === 'string')
    : []
}

/** Preview a restore against the current library without changing anything. */
export function planRestore(paths: AppPaths, archivePath: string, options: RestoreOptions = {}): RestoreReport {
  const verifiedArchive = verifyArchive(archivePath)
  try {
    const includesFonts = verifiedArchive.manifest.includesFonts !== false
    const report = emptyReport(options, includesFonts)
    report.failed = [...verifiedArchive.failed]
    if (!report.restoreFonts) return finishPlanReport(report, verifiedArchive)
    const current = loadCatalog(paths)
    const byFingerprint = existingFingerprintMap(current)
    const conflictKeys = new Map<string, CatalogEntry>()
    for (const entry of current.entries) {
      const key = faceIdentityKey(entry.faces, entry.format)
      if (key && !conflictKeys.has(key)) conflictKeys.set(key, entry)
    }
    for (const entry of verifiedArchive.catalog.entries) {
      const chosen = chooseFingerprintForEntry(entry, verifiedArchive.manifest)
      if (!includesFonts) {
        report.failed.push({
          entryId: entry.id, fileName: path.basename(entry.sourcePath), reason: 'missing-in-archive',
          message: `${path.basename(entry.sourcePath)} was not restored because this backup contains no font files.`,
        })
        continue
      }
      if (chosen && verifiedArchive.verified.has(chosen.fingerprint)) {
        const identicalPlan = byFingerprint.get(chosen.fingerprint)
        if (identicalPlan) {
          report.skippedIdentical.push({ entryId: entry.id, existingEntryId: identicalPlan.id, fingerprint: chosen.fingerprint, fileName: chosen.file.fileName })
          continue
        }
      }
      const recordedExisting = existingRecordedPath(entry)
      if (recordedExisting) {
        report.leftAsIs.push({ entryId: entry.id, newEntryId: entry.id, fileName: chosen?.file.fileName ?? path.basename(recordedExisting), recordedPath: recordedExisting })
        if (backupActivationFor(entry) === 'on') report.reactivated.push({ entryId: entry.id, newEntryId: entry.id, fileName: path.basename(recordedExisting) })
        continue
      }
      if (!chosen || !verifiedArchive.verified.has(chosen.fingerprint)) {
        if (!report.failed.some((f) => f.entryId === entry.id)) {
          report.failed.push({
            entryId: entry.id, fileName: chosen?.file.fileName ?? entry.sourcePath,
            fingerprint: chosen?.fingerprint, reason: 'unrestorable',
            message: includesFonts
              ? `${path.basename(entry.sourcePath)} could not be restored from this backup.`
              : `${path.basename(entry.sourcePath)} was not restored because this backup contains no font files.`,
          })
        }
        continue
      }
      const existing = byFingerprint.get(chosen.fingerprint)
      if (existing) {
        report.skippedIdentical.push({ entryId: entry.id, existingEntryId: existing.id, fingerprint: chosen.fingerprint, fileName: chosen.file.fileName })
        continue
      }
      const key = faceIdentityKey(entry.faces, entry.format)
      const conflict = key ? conflictKeys.get(key) : undefined
      const restoredPath = path.join(restoredFontsDir(paths), chosen.fingerprint, sanitizeFileName(chosen.file.fileName))
      const reactivated = backupActivationFor(entry) === 'on' && !conflict
      if (conflict) {
        report.parkedAsExtra.push({ entryId: entry.id, newEntryId: entry.id, fingerprint: chosen.fingerprint, fileName: chosen.file.fileName, conflictingEntryId: conflict.id, faceIdentityKey: key })
      } else {
        report.restored.push({ entryId: entry.id, newEntryId: entry.id, fingerprint: chosen.fingerprint, fileName: chosen.file.fileName, restoredPath, faceIdentityKey: key, reactivated })
        if (reactivated) report.reactivated.push({ entryId: entry.id, newEntryId: entry.id, fileName: chosen.file.fileName })
      }
    }
    return finishPlanReport(report, verifiedArchive)
  } finally {
    try { fs.rmSync(verifiedArchive.stagingDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

function finishPlanReport(report: RestoreReport, verifiedArchive: VerifiedArchive): RestoreReport {
  if (report.restoreOrganization) {
    for (const root of watchRootsOf(verifiedArchive.settings)) {
      let isDir = false
      try { isDir = fs.existsSync(root) && fs.statSync(root).isDirectory() } catch { isDir = false }
      if (isDir) report.watchFoldersRestoredPaused.push({ root })
      else report.watchFoldersNotRestored.push({ root, reason: 'not restored — relink to resume watching' })
    }
  }
  report.settingsKeysSkipped = [
    ...(verifiedArchive.manifest.redactedSettingsKeys ?? []),
    ...collectRedactedKeys(verifiedArchive.settings),
  ].filter((v, i, a) => a.indexOf(v) === i)
  return report
}

/**
 * Cicero-style restore. Fonts and organization are separate choices.
 * Organization replaces projects, smart projects, tags, and settings, after
 * a snapshot of the current library data is written. A font file already on
 * disk at its recorded path is left as-is (no fingerprint check); no step
 * deletes or parks an existing entry or removes the only copy of a face.
 * Fonts that were on come back on; temporary/session activations stay off.
 */
export function restoreBackup(paths: AppPaths, archivePath: string, options: RestoreOptions = {}): RestoreReport {
  const verifiedArchive = verifyArchive(archivePath)
  const includesFonts = verifiedArchive.manifest.includesFonts !== false
  const report = emptyReport(options, includesFonts)
  report.failed = [...verifiedArchive.failed]
  let snapshotTemp: string | null = null
  try {
    const { manifest, catalog: backupCatalog, projects: backupProjects, familyTagsPayload, settings: backupSettings } = verifiedArchive

    // Snapshot the current library data before organization is replaced.
    if (report.restoreOrganization) {
      const snapshot = snapshotCurrentLibrary(paths, verifiedArchive.stagingDir)
      report.snapshotPath = snapshot.snapshotPath
      report.catalogBackupPath = snapshot.catalogBackupPath
      snapshotTemp = path.join(verifiedArchive.stagingDir, 'catalog-before-restore.json')
      if (!fs.existsSync(snapshotTemp)) snapshotTemp = null
    }

    const current = loadCatalog(paths)
    const byFingerprint = report.restoreFonts ? existingFingerprintMap(current) : new Map<string, CatalogEntry>()
    const conflictKeys = new Map<string, CatalogEntry>()
    for (const entry of current.entries) {
      const key = faceIdentityKey(entry.faces, entry.format)
      if (key && !conflictKeys.has(key)) conflictKeys.set(key, entry)
    }
    const idMap = new Map<string, string>()

    // Family tags are organization: they replace the current tags when that choice is on.
    if (report.restoreOrganization) {
      const incomingTags = familyTagsPayload.tags ?? backupCatalog.tags ?? []
      const beforeIds = new Set((current.tags ?? []).map((t) => t.id))
      report.familyTagsRestored = incomingTags.filter((t) => t && !beforeIds.has(t.id)).length
      current.tags = ensureSeedTags(incomingTags)
      current.familyTags = normalizeFamilyTagAssignments(
        familyTagsPayload.familyTags ?? backupCatalog.familyTags ?? [],
        current.tags,
      )
    }

    // Catalog font entries (only when the fonts choice is on).
    if (report.restoreFonts) for (const backupEntry of backupCatalog.entries) {
      if (!includesFonts) {
        report.failed.push({
          entryId: backupEntry.id, fileName: path.basename(backupEntry.sourcePath), reason: 'missing-in-archive',
          message: `${path.basename(backupEntry.sourcePath)} was not restored because this backup contains no font files.`,
        })
        continue
      }
      const chosen = chooseFingerprintForEntry(backupEntry, manifest)
      const activation = backupActivationFor(backupEntry)
      const recordedExisting = existingRecordedPath(backupEntry)
      const fileName = chosen?.file.fileName ?? path.basename(backupEntry.sourcePath)
      // A file already on disk at the recorded path is left as-is: no hash
      // check, no overwrite, whatever its bytes. The entry points at it.
      if (!recordedExisting && (!chosen || !verifiedArchive.verified.has(chosen.fingerprint))) {
        if (!report.failed.some((f) => f.entryId === backupEntry.id)) {
          report.failed.push({
            entryId: backupEntry.id, fileName,
            fingerprint: chosen?.fingerprint, reason: 'unrestorable',
            message: includesFonts
              ? `${path.basename(backupEntry.sourcePath)} could not be restored from this backup.`
              : `${path.basename(backupEntry.sourcePath)} was not restored because this backup contains no font files.`,
          })
        }
        continue
      }
      const fingerprint = chosen?.fingerprint ?? tryFingerprintFile(recordedExisting ?? '') ?? ''
      if (chosen && verifiedArchive.verified.has(chosen.fingerprint)) {
        const identical = byFingerprint.get(chosen.fingerprint)
        if (identical) {
          idMap.set(backupEntry.id, identical.id)
          report.skippedIdentical.push({ entryId: backupEntry.id, existingEntryId: identical.id, fingerprint: chosen.fingerprint, fileName: chosen.file.fileName })
          continue
        }
      }
      const verified = chosen ? verifiedArchive.verified.get(chosen.fingerprint) : undefined
      const restoredPath = recordedExisting
        ?? placeRestoredBytes(paths, backupEntry, chosen!.fingerprint, chosen!.file.fileName, verified!.stagedPath)
      const idCollision = current.entries.some((e) => e.id === backupEntry.id)
      const newId = idCollision ? crypto.randomUUID() : backupEntry.id
      idMap.set(backupEntry.id, newId)
      const now = Date.now()
      const key = faceIdentityKey(backupEntry.faces, backupEntry.format)
      const conflict = key ? conflictKeys.get(key) : undefined
      const wantsOn = activation === 'on' && !conflict
      let installedPath: string | undefined
      if (wantsOn) {
        // The recorded installed copy only counts when it is the same bytes;
        // a different file at that path is left alone, not adopted.
        const recordedInstalled = fileIsFile(backupEntry.installedPath) && !isProtectedFontPath(backupEntry.installedPath)
          && fingerprint && tryFingerprintFile(backupEntry.installedPath) === fingerprint
          ? backupEntry.installedPath
          : undefined
        installedPath = recordedInstalled ?? placeInstalledCopy(paths, restoredPath, fileName)
      }
      const restored: CatalogEntry = {
        ...JSON.parse(JSON.stringify(backupEntry)) as CatalogEntry,
        id: newId,
        sourcePath: restoredPath,
        disabledPath: wantsOn ? undefined : restoredPath,
        installedPath,
        installations: [],
        status: wantsOn ? 'installed' : 'deactivated',
        sourceFingerprint: fingerprint || backupEntry.sourceFingerprint,
        installedFingerprint: installedPath ? (tryFingerprintFile(installedPath) ?? (fingerprint || undefined)) : undefined,
        sourcePresent: true,
        sourceAvailability: 'none',
        ownerFolderId: backupEntry.ownerFolderId ?? null,
        temporaryActivation: backupEntry.temporaryActivation,
        updatedAt: now,
      }
      if (restoredPath !== backupEntry.sourcePath) delete (restored as { sourceRoot?: unknown }).sourceRoot
      current.entries.push(restored)
      if (fingerprint) byFingerprint.set(fingerprint, restored)
      if (recordedExisting) {
        report.leftAsIs.push({ entryId: backupEntry.id, newEntryId: newId, fileName, recordedPath: recordedExisting })
      }
      if (conflict && conflict.id !== restored.id) {
        report.parkedAsExtra.push({ entryId: backupEntry.id, newEntryId: newId, fingerprint, fileName, conflictingEntryId: conflict.id, faceIdentityKey: key })
      } else {
        report.restored.push({ entryId: backupEntry.id, newEntryId: newId, fingerprint, fileName, restoredPath, faceIdentityKey: key, reactivated: wantsOn })
        if (wantsOn) report.reactivated.push({ entryId: backupEntry.id, newEntryId: newId, fileName })
      }
      if (key && !conflictKeys.has(key)) conflictKeys.set(key, restored)
    }

    saveCatalog(paths, current)
    // saveCatalog refreshes catalog.json.bak with the new catalog; put the pre-restore snapshot back.
    if (snapshotTemp && report.catalogBackupPath && fs.existsSync(snapshotTemp)) {
      try { fs.copyFileSync(snapshotTemp, report.catalogBackupPath) } catch { /* best effort */ }
    }

    // Projects (manual + smart) are organization: they replace the current
    // projects when that choice is on. Members are remapped to restored or
    // already-present entries; members that match nothing are reported.
    if (report.restoreOrganization) {
      const replaced: ProjectSet[] = []
      for (const backupProject of backupProjects) {
        if (!backupProject || typeof backupProject !== 'object' || !backupProject.id) continue
        const remappedMembers: ProjectSet['members'] = []
        for (const member of backupProject.members ?? []) {
          const target = idMap.get(member.assetId)
          if (target) remappedMembers.push({ ...member, assetId: target })
          else if (current.entries.some((e) => e.id === member.assetId)) remappedMembers.push(member)
          else report.projectMembersUnresolved.push({ projectName: backupProject.name ?? backupProject.id, assetId: member.assetId })
        }
        replaced.push({ ...backupProject, members: backupProject.kind === 'smart' ? [] : remappedMembers })
        report.projectsRestored++
      }
      saveProjects(paths, replaced)
    }

    // Settings are organization: they replace the current settings when that
    // choice is on. Redacted secrets are never written back (the current
    // value, if any, is kept), and watch folders come back paused only when
    // their root exists on this machine.
    if (report.restoreOrganization) {
      const currentSettings = loadSettings(paths)
      report.settingsKeysSkipped = [
        ...(manifest.redactedSettingsKeys ?? []),
        ...collectRedactedKeys(backupSettings),
      ].filter((v, i, a) => a.indexOf(v) === i)

      const withCurrentSecrets = preserveRedacted(
        JSON.parse(JSON.stringify(currentSettings)) as unknown,
        JSON.parse(JSON.stringify(backupSettings)) as unknown,
      ) as Record<string, unknown>
      const nextSettings = normalizeBackupSettings(withCurrentSecrets, paths, verifiedArchive.stagingDir)
      report.settingsRestoredKeys = Object.keys(backupSettings).filter((k) => k !== 'folders' && k !== 'watchFolders')

      const beforeFilterIds = new Set(currentSettings.savedFilters.map((f) => f.id))
      report.savedFiltersRestored = nextSettings.savedFilters.filter((f) => !beforeFilterIds.has(f.id)).length
      if (Array.isArray(verifiedArchive.savedFilters)) {
        nextSettings.savedFilters = normalizeSavedFilters(verifiedArchive.savedFilters)
      }

      const keptFolders: AppSettings['folders'] = []
      for (const folder of nextSettings.folders) {
        let isDir = false
        try { isDir = fs.existsSync(folder.root) && fs.statSync(folder.root).isDirectory() } catch { isDir = false }
        if (!isDir) {
          report.watchFoldersNotRestored.push({ root: folder.root, reason: 'not restored — relink to resume watching' })
          continue
        }
        keptFolders.push({ ...folder, paused: true, watching: false })
        report.watchFoldersRestoredPaused.push({ root: folder.root })
      }
      nextSettings.folders = keptFolders
      saveSettings(paths, nextSettings)
    }

    return report
  } finally {
    try { fs.rmSync(verifiedArchive.stagingDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

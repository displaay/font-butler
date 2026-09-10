import fs from 'node:fs'
import path from 'node:path'
import { isFullyUnderAnyRoot } from './containment.ts'
import { retailManifestPath } from './paths.ts'
import type { AppPaths } from './paths.ts'
import {
  emptyRetailLocalManifest,
  isSyncableDrift,
  type RetailDriftItem,
  type RetailFile,
  type RetailLocalFile,
  type RetailLocalManifest,
  type RetailManifest,
} from '../shared/retail.ts'

export type RetailStat = { exists: boolean; size: number }

/** Injected so the diff stays pure and testable without touching disk. */
export type RetailStatFile = (relativePath: string) => RetailStat

export function statRetailFile(root: string): RetailStatFile {
  return (relativePath) => {
    const target = resolveRetailPath(root, relativePath)
    if (!target) return { exists: false, size: 0 }
    try {
      const stat = fs.statSync(target)
      return { exists: stat.isFile(), size: stat.size }
    } catch {
      return { exists: false, size: 0 }
    }
  }
}

/**
 * A server-supplied relative path is about to be written to the user's disk, so it is validated as
 * hostile input even though the worker is trusted.
 *
 * Deliberately platform-independent: `path.isAbsolute` answers differently on win32 and posix, so
 * `C:/Windows/x.otf` would be rejected on the dev box and accepted on the macOS target. The rules below
 * give the same answer everywhere, which is the only way the tests mean anything.
 */
export function isSafeRelativePath(relativePath: string): boolean {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return false
  if (relativePath.includes('\0')) return false
  if (relativePath.includes('\\')) return false
  if (relativePath.startsWith('/')) return false
  // A drive or UNC prefix is absolute on Windows and merely odd on macOS; refuse it on both.
  if (/^[A-Za-z]:/.test(relativePath)) return false
  const segments = relativePath.split('/')
  if (segments.length === 0) return false
  return segments.every((segment) => {
    if (!segment || segment.trim() !== segment) return false
    if (/^\.+$/.test(segment)) return false
    // Windows strips a trailing dot, so `a.` and `a` would name one file while the manifest holds two.
    if (segment.endsWith('.')) return false
    // macOS caps a path component at 255 bytes; a longer one can never be written.
    if (Buffer.byteLength(segment, 'utf8') > 255) return false
    return true
  })
}

/**
 * Absolute on-disk target, or null when the path is unsafe or escapes the root.
 *
 * `isFullyUnderAnyRoot` resolves symlinks, so a symlinked folder inside the retail root cannot redirect
 * a write outside it — the lexical check alone cannot see that. Same helper the rest of the service uses.
 */
export function resolveRetailPath(root: string, relativePath: string): string | null {
  if (!isSafeRelativePath(relativePath)) return null
  const base = path.resolve(root)
  const target = path.resolve(base, relativePath)
  // The root itself is never a valid write target.
  if (!target.startsWith(`${base}${path.sep}`)) return null
  if (!isFullyUnderAnyRoot(target, [base])) return null
  return target
}

/** Identity as the filesystem sees it: APFS is case- and unicode-normalization-insensitive. */
function pathIdentity(relativePath: string): string {
  return relativePath.normalize('NFC').toLowerCase()
}

function isValidRemoteFile(value: unknown): value is RetailFile {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<RetailFile>
  if (typeof row.key !== 'string' || !row.key) return false
  if (typeof row.relativePath !== 'string') return false
  if (typeof row.etag !== 'string') return false
  return typeof row.size === 'number' && Number.isFinite(row.size) && row.size >= 0
}

function isValidLocalFile(value: unknown, key: string): value is RetailLocalFile {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<RetailLocalFile>
  // The record key and the entry must agree, or the entry can never be matched, cleaned up or reported.
  if (typeof row.relativePath !== 'string' || row.relativePath !== key) return false
  if (typeof row.key !== 'string' || typeof row.etag !== 'string') return false
  if (typeof row.glyphsFile !== 'string') return false
  return typeof row.size === 'number' && Number.isFinite(row.size)
}

/**
 * Compare what R2 holds against what the last sync wrote.
 *
 * Deliberately never compares mtimes: `core/watch.ts` already documents why a timestamp cannot be
 * trusted for synced files. Remote identity is the `(size, etag)` pair treated as an opaque change
 * token — etag is NOT an MD5 for multipart uploads, so it is only ever compared for equality, and
 * pairing it with size catches the case where one of the two happens to be reused.
 *
 * The revision id is intentionally NOT part of the comparison. Regeneration reuses the same revision
 * (`/regenerate` overwrites the same prefix in place), so a revision change is neither necessary nor
 * sufficient evidence that the bytes moved.
 */
export function diffRetailManifest(
  remote: RetailManifest,
  local: RetailLocalManifest,
  statFile: RetailStatFile,
): RetailDriftItem[] {
  const drift: RetailDriftItem[] = []
  const seen = new Set<string>()
  // Keyed on filesystem identity, so a case-only or NFC/NFD-only difference is caught as a collision
  // rather than becoming two manifest entries fighting over one file forever.
  const claimed = new Map<string, { glyphsFile: string; relativePath: string }>()

  const known = new Map<string, RetailLocalFile>()
  for (const [key, value] of Object.entries(local.files ?? {})) {
    if (isValidLocalFile(value, key)) known.set(key, value)
  }

  for (const collection of remote.collections ?? []) {
    for (const file of collection.files ?? []) {
      if (!isValidRemoteFile(file) || !isSafeRelativePath(file.relativePath)) {
        const named = typeof file?.relativePath === 'string' ? file.relativePath : '(unnamed)'
        // Claim the path even though we refuse it, so a local copy of the same file is not ALSO
        // reported as `removed` — the server still lists it, we just will not act on this entry.
        if (isSafeRelativePath(named)) seen.add(named)
        // Never silent: a dropped file would otherwise read as "up to date" while nothing downloaded.
        drift.push({
          kind: 'refused',
          relativePath: named,
          glyphsFile: collection.glyphsFile,
          note: 'The server described this file in a way Font Buttler will not act on.',
        })
        continue
      }

      const identity = pathIdentity(file.relativePath)
      const owner = claimed.get(identity)
      if (owner && owner.glyphsFile !== collection.glyphsFile) {
        drift.push({
          kind: 'conflict',
          relativePath: file.relativePath,
          glyphsFile: collection.glyphsFile,
          remote: file,
          note: `${collection.glyphsFile} and ${owner.glyphsFile} both want ${owner.relativePath}.`,
        })
        continue
      }
      if (owner) continue
      claimed.set(identity, { glyphsFile: collection.glyphsFile, relativePath: file.relativePath })
      seen.add(file.relativePath)

      const current = known.get(file.relativePath)

      if (!current) {
        drift.push({
          kind: 'added',
          relativePath: file.relativePath,
          glyphsFile: collection.glyphsFile,
          remote: file,
        })
        continue
      }

      if (current.etag !== file.etag || current.size !== file.size) {
        drift.push({
          kind: 'changed',
          relativePath: file.relativePath,
          glyphsFile: collection.glyphsFile,
          remote: file,
          local: current,
        })
        continue
      }

      const stat = statFile(file.relativePath)
      if (!stat.exists) {
        drift.push({
          kind: 'missing-locally',
          relativePath: file.relativePath,
          glyphsFile: collection.glyphsFile,
          remote: file,
          local: current,
        })
        continue
      }
      if (stat.size !== file.size) {
        drift.push({
          kind: 'corrupt-locally',
          relativePath: file.relativePath,
          glyphsFile: collection.glyphsFile,
          remote: file,
          local: current,
        })
      }
    }
  }

  for (const current of known.values()) {
    if (seen.has(current.relativePath)) continue
    drift.push({
      kind: 'removed',
      relativePath: current.relativePath,
      glyphsFile: current.glyphsFile,
      local: current,
    })
  }

  drift.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return drift
}

export function countPendingDrift(drift: RetailDriftItem[]): number {
  return drift.filter(isSyncableDrift).length
}

export function loadRetailManifest(paths: AppPaths): RetailLocalManifest {
  const file = retailManifestPath(paths)
  if (!fs.existsSync(file)) return emptyRetailLocalManifest()
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RetailLocalManifest
    if (!parsed || parsed.version !== 1 || !parsed.files || typeof parsed.files !== 'object') {
      return emptyRetailLocalManifest()
    }
    // Entries are validated rather than trusted: a half-written file must degrade to "resync", never
    // crash the status poll. Null-prototype so a path like `toString` cannot match Object.prototype.
    const files: Record<string, RetailLocalFile> = Object.create(null)
    for (const [key, value] of Object.entries(parsed.files)) {
      if (isValidLocalFile(value, key)) files[key] = value
    }
    return {
      version: 1,
      syncedAt: typeof parsed.syncedAt === 'string' ? parsed.syncedAt : null,
      files,
    }
  } catch {
    return emptyRetailLocalManifest()
  }
}

export function saveRetailManifest(paths: AppPaths, manifest: RetailLocalManifest): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  const file = retailManifestPath(paths)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2))
  fs.renameSync(tmp, file)
}

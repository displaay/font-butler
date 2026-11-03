import crypto from 'node:crypto'
import fs from 'node:fs'
import type { CatalogEntry } from './types.ts'

export function fingerprintBuffer(data: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/** Catalog fingerprints that identify an entry's known bytes (source, installed, copies). */
export function entryKnownFingerprints(
  entry: Pick<CatalogEntry, 'sourceFingerprint' | 'installedFingerprint' | 'installations'>,
): string[] {
  const found = new Set<string>()
  if (entry.sourceFingerprint) found.add(entry.sourceFingerprint)
  if (entry.installedFingerprint) found.add(entry.installedFingerprint)
  for (const copy of entry.installations ?? []) {
    if (copy.fingerprint) found.add(copy.fingerprint)
  }
  return [...found]
}

function liveCopyPaths(
  entry: Pick<CatalogEntry, 'installedPath' | 'installations'>,
): string[] {
  const paths = new Set<string>()
  if (entry.installedPath) paths.add(entry.installedPath)
  for (const copy of entry.installations ?? []) {
    if (copy.path && !copy.parkedPath) paths.add(copy.path)
  }
  return [...paths]
}

/**
 * True when `fingerprint` matches any recorded catalog fingerprint, or (when
 * `includeLive`) the bytes currently at a live install path.
 */
export function entryMatchesFingerprint(
  entry: Pick<
    CatalogEntry,
    'sourceFingerprint' | 'installedFingerprint' | 'installations' | 'installedPath'
  >,
  fingerprint: string | undefined,
  options: { includeLive?: boolean } = {},
): boolean {
  if (!fingerprint) return false
  if (entryKnownFingerprints(entry).includes(fingerprint)) return true
  if (!options.includeLive) return false
  for (const livePath of liveCopyPaths(entry)) {
    if (tryFingerprintFile(livePath) === fingerprint) return true
  }
  return false
}

export function occupyingFingerprintsForEntry(
  entry: Pick<CatalogEntry, 'sourceFingerprint' | 'installedFingerprint' | 'installations'>,
): string[] {
  return entryKnownFingerprints(entry)
}

export function fingerprintFile(filePath: string): string {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(64 * 1024)
    let bytesRead = 0
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

export function tryFingerprintFile(filePath: string): string | undefined {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return undefined
    }
    return fingerprintFile(filePath)
  } catch {
    return undefined
  }
}

export function tryFingerprintFileIfChanged(
  filePath: string,
  previous?: { fingerprint?: string; mtimeMs?: number; size?: number },
): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return undefined
    if (
      previous?.fingerprint &&
      previous.mtimeMs === stat.mtimeMs &&
      previous.size === stat.size
    ) {
      return previous.fingerprint
    }
    return fingerprintFile(filePath)
  } catch {
    return undefined
  }
}

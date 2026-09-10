import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isUnderAnyRoot } from './containment.ts'
import {
  copyAt,
  dropCopy,
  findUnmanagedConflicts,
  inspectDestination,
  isDefaultDestinationId,
  plannedManagedPath,
  removeManagedCopy,
  targetsForDefaultDestination,
  upsertCopy,
  writeManagedCopy,
} from './destinations.ts'
import { tryFingerprintFile } from './fingerprint.ts'
import { extensionForFormat } from './install.ts'
import { recordMutationDestination } from './journal.ts'
import type { AppPaths } from './paths.ts'
import { resolveRetailInstallPath } from './retail-sync.ts'
import { loadSettings } from './settings.ts'
import type { CatalogEntry, DefaultDestinationId, DestinationId, InstallOptions } from './types.ts'

export function sameFile(left: string, right: string): boolean {
  try {
    const a = fs.statSync(left)
    const b = fs.statSync(right)
    return a.dev === b.dev && a.ino === b.ino
  } catch {
    return path.resolve(left) === path.resolve(right)
  }
}

export function destinationForInstall(
  paths: AppPaths,
  entry: CatalogEntry,
  fromPath: string,
  options: { reuseInstalled?: boolean } = {},
): string {
  if (entry.retailRelativePath) {
    const retailDest = resolveRetailInstallPath(paths.userFontsDir, entry.retailRelativePath)
    if (retailDest) return retailDest
  }
  const resolvedFrom = path.resolve(fromPath)
  const reuseInstalled = options.reuseInstalled !== false
  if (reuseInstalled && isUnderAnyRoot(resolvedFrom, [paths.installDir, paths.userFontsDir])) {
    return resolvedFrom
  }
  if (
    reuseInstalled &&
    entry.installedPath &&
    fs.existsSync(entry.installedPath) &&
    isUnderAnyRoot(entry.installedPath, [paths.installDir, paths.userFontsDir])
  ) {
    const installedExt = path.extname(entry.installedPath).toLowerCase()
    const incomingExt = extensionForFormat(entry.format, resolvedFrom).toLowerCase()
    if (!installedExt || installedExt === incomingExt) {
      return path.resolve(entry.installedPath)
    }
  }
  fs.mkdirSync(paths.installDir, { recursive: true })
  const ext = extensionForFormat(entry.format, resolvedFrom)
  const dest = path.join(paths.installDir, `${path.basename(resolvedFrom, path.extname(resolvedFrom))}${ext}`)
  if (!fs.existsSync(dest) || sameFile(dest, resolvedFrom)) {
    return dest
  }
  const stem = path.basename(dest, ext)
  const hash = crypto.createHash('sha1').update(resolvedFrom).digest('hex').slice(0, 8)
  return path.join(paths.installDir, `${stem}-${hash}${ext}`)
}

export function defaultDestinationFor(paths: AppPaths, entry: CatalogEntry): DefaultDestinationId {
  const settings = loadSettings(paths)
  const folder = settings.folders.find((item) => item.id === entry.ownerFolderId)
  if (folder?.destinationId) {
    return folder.destinationId
  }
  return isDefaultDestinationId(settings.defaultDestination) ? settings.defaultDestination : 'macos'
}

export function installTargets(paths: AppPaths, entry: CatalogEntry, options?: InstallOptions): DestinationId[] {
  if (options?.destinationIds?.length) {
    return [...new Set(options.destinationIds)]
  }
  if (options?.destinationId) return [options.destinationId]
  const existing = (entry.installations ?? [])
    .map((item) => item.destinationId)
    .filter((item, index, all) => all.indexOf(item) === index)
  if (existing.length) return existing
  return targetsForDefaultDestination(defaultDestinationFor(paths, entry))
}

export function placeAdobeCopy(
  paths: AppPaths,
  entry: CatalogEntry,
  stagedPath: string,
  format: string,
  faces: CatalogEntry['faces'],
): void {
  const capability = inspectDestination(paths, 'adobe-shared')
  if (!capability.supported) {
    throw new Error(capability.remedy || capability.reason || 'The Adobe testing folder is not available.')
  }
  const managed = (entry.installations ?? [])
    .filter((item) => item.destinationId === 'adobe-shared')
    .map((item) => item.path)
  const conflicts = findUnmanagedConflicts(paths, 'adobe-shared', faces, managed)
  if (conflicts[0]) {
    throw new Error(conflicts[0].reason)
  }
  const dest =
    copyAt(entry, 'adobe-shared')?.path ?? plannedManagedPath(paths, 'adobe-shared', entry.sourcePath, format)
  recordMutationDestination(paths, entry.id, dest)
  const leftoverParked = copyAt(entry, 'adobe-shared')?.parkedPath
  const written = writeManagedCopy({
    paths,
    destinationId: 'adobe-shared',
    stagedPath,
    dest,
    rollbackDir: path.join(paths.dataRoot, 'rollback'),
  })
  upsertCopy(entry, {
    destinationId: 'adobe-shared',
    path: written,
    fingerprint: tryFingerprintFile(written),
    verification: 'file-present',
  })
  if (
    leftoverParked &&
    fs.existsSync(leftoverParked) &&
    path.resolve(leftoverParked) !== path.resolve(written)
  ) {
    fs.rmSync(leftoverParked, { force: true })
  }
}

export function removeAdobeCopy(paths: AppPaths, entry: CatalogEntry): void {
  const existing = copyAt(entry, 'adobe-shared')
  if (!existing) return
  try {
    removeManagedCopy(paths, 'adobe-shared', existing.path)
  } catch (error) {
    // A missing destination is already clean. Preserve metadata when removal failed for a
    // real reason so callers can report the failure and retry instead of silently forgetting it.
    if (fs.existsSync(existing.path)) throw error
  }
  dropCopy(entry, 'adobe-shared')
}

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadCatalog } from './catalog.ts'
import { isUnderAnyRoot } from './containment.ts'
import { pruneStaleDuplicates } from './duplicates.ts'
import { emitEvent } from './events.ts'
import { withOccupiedDestinations } from './identity.ts'
import { getFontNative } from './native.ts'
import { readFileStat } from './parse.ts'
import type { AppPaths } from './paths.ts'
import { moveToTrash } from './reveal.ts'
import type { CatalogEntry, DuplicateWarning, Notice } from './types.ts'

export function now(): number {
  return Date.now()
}

export function newId(): string {
  return crypto.randomUUID()
}

export function displayFamily(entry: CatalogEntry): string {
  return entry.customFamilyName || entry.faces[0]?.familyName || 'Unknown'
}

export function bindEntryToInstalledFile(entry: CatalogEntry, dest: string): void {
  const resolved = path.resolve(dest)
  const stat = readFileStat(resolved)
  entry.sourcePath = resolved
  entry.installedPath = resolved
  entry.disabledPath = undefined
  entry.sourceMtimeMs = stat.mtimeMs
  entry.sourceSize = stat.size
  entry.sourcePresent = false
  entry.installedSnapshotMtimeMs = stat.mtimeMs
  entry.installedSnapshotSize = stat.size
  entry.status = 'installed'
}

export function emitCatalog(paths: AppPaths): CatalogEntry[] {
  const entries = withOccupiedDestinations(loadCatalog(paths).entries, paths)
  emitEvent({ type: 'catalog', entries })
  return entries
}

export function emitDuplicates(paths: AppPaths): DuplicateWarning[] {
  const duplicates = pruneStaleDuplicates(paths)
  emitEvent({ type: 'duplicates', duplicates })
  return duplicates
}

export function emitNotice(notice: Notice): void {
  emitEvent({ type: 'notice', notice })
}

export function touchEntry(entry: CatalogEntry): void {
  entry.updatedAt = now()
}

export async function removeInstalledCopy(entry: CatalogEntry): Promise<void> {
  if (entry.installedPath) {
    await getFontNative().unregisterFont(entry.installedPath)
    if (fs.existsSync(entry.installedPath)) {
      fs.rmSync(entry.installedPath, { force: true })
    }
  }
  entry.installedPath = undefined
}

export function isProtectedSource(filePath: string, paths: AppPaths): boolean {
  return isUnderAnyRoot(filePath, [
    paths.systemFontsDir,
    paths.computerFontsDir,
    paths.supplementalFontsDir,
  ])
}

export async function deleteSourceFile(filePath: string, paths: AppPaths): Promise<void> {
  const resolved = path.resolve(filePath)
  if (isProtectedSource(resolved, paths)) {
    throw new Error('System font files cannot be deleted.')
  }
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(resolved)
  } catch {
    return
  }
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(resolved)
    return
  }
  if (!stat.isFile()) {
    throw new Error('That source path is not a file.')
  }
  await moveToTrash(resolved)
}

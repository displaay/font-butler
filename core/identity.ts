import fs from 'node:fs'
import path from 'node:path'
import { isUnderAnyRoot } from './containment.ts'
import { faceIdentityKey } from './catalog.ts'
import { entryFormat, instancesOverlap, normalizeFormat } from './formats.ts'
import type { AppPaths } from './paths.ts'
import type { CatalogEntry, CatalogFile, DestinationId, FontFaceInfo } from './types.ts'

export const IDENTITY_MUTEX_MESSAGE =
  'Another copy of this font is already active. Switch to this copy, or park the active one first.'

export function sameFaceIdentity(
  left: Pick<CatalogEntry, 'faces' | 'format' | 'sourcePath'>,
  right: Pick<CatalogEntry, 'faces' | 'format' | 'sourcePath'>,
  options: { sameFormat?: boolean } = {},
): boolean {
  const requireFormat = options.sameFormat !== false
  const leftKey = faceIdentityKey(left.faces, requireFormat ? entryFormat(left) : undefined)
  const rightKey = faceIdentityKey(right.faces, requireFormat ? entryFormat(right) : undefined)
  if (leftKey && rightKey && leftKey === rightKey) return true
  if (!instancesOverlap(left, right)) return false
  if (!requireFormat) return true
  return normalizeFormat(entryFormat(left)) === normalizeFormat(entryFormat(right))
}

export function matchesIncomingIdentity(
  entry: Pick<CatalogEntry, 'faces' | 'format' | 'sourcePath'>,
  faces: FontFaceInfo[],
  format?: string,
): boolean {
  const requireFormat = format !== undefined
  const incomingKey = faceIdentityKey(faces, format)
  const entryKey = faceIdentityKey(entry.faces, requireFormat ? entryFormat(entry) : undefined)
  if (incomingKey && entryKey && incomingKey === entryKey) return true
  if (!instancesOverlap(entry, { faces })) return false
  if (!requireFormat) return true
  return normalizeFormat(entryFormat(entry)) === normalizeFormat(format)
}

export function findAllByFaceIdentity(
  catalog: CatalogFile | CatalogEntry[],
  faces: FontFaceInfo[],
  format?: string,
): CatalogEntry[] {
  const entries = Array.isArray(catalog) ? catalog : catalog.entries
  return entries.filter((entry) => matchesIncomingIdentity(entry, faces, format))
}

function isLiveFontPath(filePath: string, paths: AppPaths): boolean {
  if (isUnderAnyRoot(filePath, [paths.disabledDir])) return false
  return isUnderAnyRoot(filePath, [paths.installDir, paths.userFontsDir, paths.adobeFontsDir])
}

export function occupiesDestination(
  entry: CatalogEntry,
  destId: DestinationId,
  paths: AppPaths,
): boolean {
  if (destId === 'macos') {
    const candidates = [
      entry.installedPath,
      entry.installations?.find((item) => item.destinationId === 'macos' && !item.parkedPath)?.path,
    ]
    return candidates.some(
      (candidate) =>
        Boolean(candidate) &&
        fs.existsSync(candidate!) &&
        isLiveFontPath(candidate!, paths),
    )
  }
  const copy = entry.installations?.find((item) => item.destinationId === 'adobe-shared')
  if (!copy?.path || copy.parkedPath) return false
  return fs.existsSync(copy.path) && isLiveFontPath(copy.path, paths)
}

export function occupiedDestinations(entry: CatalogEntry, paths: AppPaths): DestinationId[] {
  const dests: DestinationId[] = []
  if (occupiesDestination(entry, 'macos', paths)) dests.push('macos')
  if (occupiesDestination(entry, 'adobe-shared', paths)) dests.push('adobe-shared')
  return dests
}

export function withOccupiedDestinations(entries: CatalogEntry[], paths: AppPaths): CatalogEntry[] {
  return entries.map((entry) => ({
    ...entry,
    occupiedDestinations: occupiedDestinations(entry, paths),
  }))
}

export function occupyingSiblings(
  catalog: CatalogEntry[],
  entry: Pick<CatalogEntry, 'id' | 'faces' | 'format' | 'sourcePath'>,
  paths: AppPaths,
  destIds?: DestinationId[],
): CatalogEntry[] {
  const targets = destIds?.length ? destIds : (['macos', 'adobe-shared'] as DestinationId[])
  return catalog.filter((other) => {
    if (other.id === entry.id) return false
    if (!sameFaceIdentity(entry, other, { sameFormat: true })) return false
    return targets.some((dest) => occupiesDestination(other, dest, paths))
  })
}

export function occupyingSiblingsForIncoming(
  catalog: CatalogEntry[],
  faces: FontFaceInfo[],
  format: string | undefined,
  paths: AppPaths,
): CatalogEntry[] {
  return catalog.filter((other) => {
    if (!matchesIncomingIdentity(other, faces, format)) return false
    return occupiedDestinations(other, paths).length > 0
  })
}

export function isBoundSourcePath(entry: CatalogEntry, incomingPath: string): boolean {
  const resolved = path.resolve(incomingPath)
  if (path.resolve(entry.sourcePath) === resolved) return true
  if (entry.installedPath && path.resolve(entry.installedPath) === resolved) return true
  return Boolean(
    entry.installations?.some((copy) => copy.path && path.resolve(copy.path) === resolved),
  )
}

export function identityMutexMessage(existing?: CatalogEntry): string {
  if (!existing) return IDENTITY_MUTEX_MESSAGE
  const family = existing.customFamilyName || existing.faces[0]?.familyName || 'This font'
  return `Another copy of ${family} is already active. Switch to this copy, or park the active one first.`
}

export function liveSameIdentityFiles(
  catalog: CatalogEntry[],
  faces: FontFaceInfo[],
  format: string | undefined,
  paths: AppPaths,
): string[] {
  const files: string[] = []
  for (const entry of occupyingSiblingsForIncoming(catalog, faces, format, paths)) {
    if (occupiesDestination(entry, 'macos', paths)) {
      const live = entry.installedPath
      if (live && fs.existsSync(live)) files.push(path.resolve(live))
    }
    const adobe = entry.installations?.find((item) => item.destinationId === 'adobe-shared' && !item.parkedPath)
    if (adobe?.path && fs.existsSync(adobe.path) && isLiveFontPath(adobe.path, paths)) {
      files.push(path.resolve(adobe.path))
    }
  }
  return files
}

import fs from 'node:fs'
import path from 'node:path'
import {
  findById,
  isExternalSource,
  loadCatalog,
  removeEntryById,
  runCatalogTask,
  saveCatalog,
  sourceFileExists,
  upsertEntry,
} from './catalog.ts'
import { isUnderAnyRoot } from './containment.ts'
import { copyAt } from './destinations.ts'
import { parseFontFile } from './parse.ts'
import { emitEvent } from './events.ts'
import { retailCacheDir } from './paths.ts'
import type { AppPaths } from './paths.ts'
import { loadRetailManifest, resolveRetailCachePath, resolveRetailInstallPath } from './retail-sync.ts'
import { removeAdobeCopy } from './service-destinations.ts'
import { removeInstalledCopy, touchEntry } from './service-helpers.ts'
import type { CatalogEntry } from './types.ts'
import { isSyncableDrift, retailDriftFamilyName, type RetailDriftItem, type RetailFamilyCollision } from '../shared/retail.ts'

export function catalogEntryFamilyNames(entry: CatalogEntry): string[] {
  const names = new Set<string>()
  const custom = entry.customFamilyName?.trim()
  if (custom) names.add(custom)
  const retailFamily = entry.retailFamilyName?.trim()
  if (retailFamily) names.add(retailFamily)
  for (const face of entry.faces ?? []) {
    const name = face.familyName?.trim()
    if (name) names.add(name)
  }
  return [...names]
}

export function entryInstallPaths(entry: CatalogEntry): string[] {
  const paths: string[] = []
  for (const candidate of [
    entry.installedPath,
    entry.disabledPath,
    entry.sourcePath,
    ...(entry.installations ?? []).flatMap((copy) => [copy.path, copy.parkedPath]),
  ]) {
    if (candidate) paths.push(candidate)
  }
  return paths
}

function fileIsPresent(filePath: string | undefined): boolean {
  if (!filePath) return false
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

export function isActivelyInstalled(entry: CatalogEntry): boolean {
  if (entry.status !== 'installed' && entry.status !== 'outdated') return false
  if (fileIsPresent(entry.installedPath)) return true
  const adobe = copyAt(entry, 'adobe-shared')
  return fileIsPresent(adobe?.path) && !adobe?.parkedPath
}

export type RetailOwnedInstallContext = {
  ownedPaths: Set<string>
  cacheRoot: string
}

/**
 * Paths Font Buttler already treats as Displaay retail installs.
 *
 * Family name is deliberately not used: an imported Azeret is not "ours" just because
 * the retail collection also has an Azeret family.
 */
export function retailOwnedInstallContext(
  paths: AppPaths,
  catalog: readonly CatalogEntry[] = loadCatalog(paths).entries,
): RetailOwnedInstallContext {
  const ownedPaths = new Set<string>()
  const cacheRoot = path.resolve(retailCacheDir(paths))
  for (const entry of catalog) {
    if (!entry.retailRelativePath) continue
    for (const candidate of entryInstallPaths(entry)) {
      ownedPaths.add(path.resolve(candidate))
    }
  }
  const local = loadRetailManifest(paths)
  for (const file of Object.values(local.files)) {
    if (file.installedPath) ownedPaths.add(path.resolve(file.installedPath))
    const cached = resolveRetailCachePath(paths, file.relativePath)
    if (cached) ownedPaths.add(path.resolve(cached))
    if (file.parked) continue
    const dest = resolveRetailInstallPath(paths.userFontsDir, file.relativePath)
    if (dest && file.installedPath && path.resolve(file.installedPath) === path.resolve(dest)) {
      ownedPaths.add(path.resolve(dest))
    }
  }
  return { ownedPaths, cacheRoot }
}

export function isRetailOwnedInstall(entry: CatalogEntry, owned: RetailOwnedInstallContext): boolean {
  if (entry.retailRelativePath) return true
  for (const candidate of entryInstallPaths(entry)) {
    const resolved = path.resolve(candidate)
    if (owned.ownedPaths.has(resolved)) return true
    if (isUnderAnyRoot(resolved, [owned.cacheRoot])) return true
  }
  return false
}

function collisionFromEntries(
  familyName: string,
  typefaceName: string,
  entries: CatalogEntry[],
): RetailFamilyCollision {
  const labels = [
    ...new Set(
      entries.map((entry) => {
        const dest = entry.installedPath || copyAt(entry, 'adobe-shared')?.path || entry.sourcePath
        return dest ? path.basename(dest) : familyName
      }),
    ),
  ]
  return {
    familyName,
    typefaceName,
    entryIds: entries.map((entry) => entry.id),
    installedLabel: labels.join(', '),
  }
}

export function findOutsideCollisionsForRetailFamilies(
  catalog: readonly CatalogEntry[],
  families: Array<{ familyName: string; typefaceName: string }>,
  owned: RetailOwnedInstallContext,
): RetailFamilyCollision[] {
  const collisions: RetailFamilyCollision[] = []
  for (const family of families) {
    if (!family.familyName) continue
    const outside = catalog.filter(
      (entry) =>
        isActivelyInstalled(entry) &&
        !isRetailOwnedInstall(entry, owned) &&
        catalogEntryFamilyNames(entry).includes(family.familyName),
    )
    if (outside.length === 0) continue
    collisions.push(collisionFromEntries(family.familyName, family.typefaceName || family.familyName, outside))
  }
  return collisions
}

export function findRetailCollisionsForIncomingFamilies(
  catalog: readonly CatalogEntry[],
  incoming: ReadonlyArray<string | { familyName?: string; path?: string }>,
  owned: RetailOwnedInstallContext,
): RetailFamilyCollision[] {
  const seen = new Set<string>()
  const collisions: RetailFamilyCollision[] = []
  for (const raw of incoming) {
    const familyName = (typeof raw === 'string' ? raw : raw.familyName ?? '').trim()
    const incomingPath = typeof raw === 'string' ? '' : raw.path
    if (incomingPath) {
      const resolved = path.resolve(incomingPath)
      if (owned.ownedPaths.has(resolved) || isUnderAnyRoot(resolved, [owned.cacheRoot])) continue
    }
    if (!familyName || seen.has(familyName)) continue
    seen.add(familyName)
    const retail = catalog.filter(
      (entry) =>
        isActivelyInstalled(entry) &&
        isRetailOwnedInstall(entry, owned) &&
        catalogEntryFamilyNames(entry).includes(familyName),
    )
    if (retail.length === 0) continue
    const typefaceName = (retail[0]?.retailTypefaceName ?? familyName).trim() || familyName
    collisions.push(collisionFromEntries(familyName, typefaceName, retail))
  }
  return collisions
}

export type DropReplacementIncoming = string | { familyName?: string; path?: string }

function incomingReplacementPath(raw: DropReplacementIncoming): { familyName: string; path: string } | null {
  if (typeof raw === 'string') return null
  const filePath = raw.path?.trim()
  if (!filePath) return null
  return { familyName: (raw.familyName ?? '').trim(), path: filePath }
}

/** True when the dropped file is still on disk and still parses as that family. */
export function incomingPathStillMatchesFamily(
  filePath: string,
  familyName: string,
  owned?: RetailOwnedInstallContext,
): boolean {
  const wanted = familyName.trim()
  if (!wanted || !filePath.trim()) return false
  const resolved = path.resolve(filePath)
  if (owned) {
    if (owned.ownedPaths.has(resolved) || isUnderAnyRoot(resolved, [owned.cacheRoot])) return false
  }
  if (!fileIsPresent(resolved)) return false
  try {
    const parsed = parseFontFile(resolved)
    return parsed.faces.some((face) => face.familyName?.trim() === wanted)
  } catch {
    return false
  }
}

/**
 * Replace may uninstall retail only when at least one planned incoming file still exists
 * and still belongs to that family.
 */
export function familyHasValidDropReplacement(
  incoming: ReadonlyArray<DropReplacementIncoming>,
  familyName: string,
  owned?: RetailOwnedInstallContext,
): boolean {
  const wanted = familyName.trim()
  if (!wanted) return false
  for (const raw of incoming) {
    const item = incomingReplacementPath(raw)
    if (!item) continue
    if (item.familyName && item.familyName !== wanted) continue
    if (incomingPathStillMatchesFamily(item.path, wanted, owned)) return true
  }
  return false
}

export function retailFamiliesPendingSync(
  fonts: Array<{ familyName: string; typefaceName: string; enabled?: boolean }>,
  drift: RetailDriftItem[],
): Array<{ familyName: string; typefaceName: string }> {
  const pending = new Set<string>()
  for (const item of drift) {
    if (!isSyncableDrift(item)) continue
    const family = retailDriftFamilyName(item)
    if (family) pending.add(family)
  }
  return fonts
    .filter((font) => font.enabled !== false && pending.has(font.familyName))
    .map((font) => ({ familyName: font.familyName, typefaceName: font.typefaceName }))
}

export async function uninstallCollisionEntries(paths: AppPaths, entryIds: readonly string[]): Promise<void> {
  if (entryIds.length === 0) return
  await runCatalogTask(async () => {
    const catalog = loadCatalog(paths)
    let dirty = false
    for (const id of entryIds) {
      const entry = findById(catalog, id)
      if (!entry) continue
      await removeInstalledCopy(entry)
      removeAdobeCopy(paths, entry)
      entry.installations = []
      entry.destinationId = undefined
      if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
        fs.rmSync(entry.disabledPath, { force: true })
      }
      entry.disabledPath = undefined
      entry.installedPath = undefined
      if (entry.retailRelativePath || (isExternalSource(entry) && sourceFileExists(entry.sourcePath))) {
        entry.sourcePresent = !entry.retailRelativePath
        entry.status = 'uninstalled'
        touchEntry(entry)
        upsertEntry(catalog, entry)
      } else {
        removeEntryById(catalog, id)
      }
      dirty = true
    }
    if (dirty) {
      saveCatalog(paths, catalog)
      emitEvent({ type: 'catalog', entries: catalog.entries })
    }
  })
}

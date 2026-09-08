import fs from 'node:fs'
import path from 'node:path'
import {
  applySourcePresence,
  findById,
  isExternalSource,
  loadCatalog,
  removeEntryById,
  saveCatalog,
  sourceFileExists,
  upsertEntry,
} from './catalog.ts'
import { copyAt, upsertCopy } from './destinations.ts'
import { tryFingerprintFile } from './fingerprint.ts'
import { assertExpectedSourceFingerprint } from './comparison.ts'
import { isWebFontFile, isWebFontFormat, WOFF_INSTALL_ERROR } from './formats.ts'
import {
  applyInstalledMetadata,
  commitInstalledFile,
  removeStagedFile,
  stageFontFile,
} from './install.ts'
import { identityMutexMessage, occupiedDestinations, occupyingSiblings, occupiesDestination } from './identity.ts'
import { recordMutationDestination, withMutationJournal } from './journal.ts'
import { ensureFontActivation, getFontNative } from './native.ts'
import { parseFontFile, readFileStat } from './parse.ts'
import type { AppPaths } from './paths.ts'
import { addManualOwner, removeManualOwner } from './projects.ts'
import { storeRevision } from './revisions.ts'
import { applyEntryFacts } from './state.ts'
import { renameFamilyCopy } from './rename.ts'
import type { CatalogEntry, DestinationId, InstallOptions } from './types.ts'
import {
  destinationForInstall,
  installTargets,
  placeAdobeCopy,
  removeAdobeCopy,
} from './service-destinations.ts'
import {
  bindEntryToInstalledFile,
  deleteSourceFile,
  displayFamily,
  emitNotice,
  newId,
  now,
  removeInstalledCopy,
  touchEntry,
} from './service-helpers.ts'

export type ServiceLifecycleHost = {
  readonly paths: AppPaths
  assertPinnedInstall(entry: CatalogEntry): void
  assertNoOccupyingSibling(entry: CatalogEntry, catalog: CatalogEntry[], dests?: DestinationId[]): void
  resolveFormatConflicts(
    entry: CatalogEntry,
    catalog: CatalogEntry[],
    replace?: boolean,
    destinationIds?: DestinationId[],
  ): Promise<CatalogEntry[]>
  snapshotAndRemoveConflicts(
    conflicts: CatalogEntry[],
  ): Promise<Array<{ entry: CatalogEntry; file: string }>>
  restoreConflictSnapshots(snapshots: Array<{ entry: CatalogEntry; file: string }>): Promise<void>
  parkManagedCopies(entry: CatalogEntry): Promise<void>
  unparkManagedCopies(entry: CatalogEntry, dests?: DestinationId[]): Promise<void>
  clearCachesAfterInstall(): Promise<void>
  isLiveDestPath(filePath: string): boolean
}

export async function installEntry(
  host: ServiceLifecycleHost,
  id: string,
  familyName?: string,
  options?: InstallOptions & { sourcePathOverride?: string },
): Promise<CatalogEntry> {
  let catalog = loadCatalog(host.paths)
  let entry = findById(catalog, id)
  if (!entry) {
    throw new Error('Font is not in the library.')
  }
  if (entry.previewOnly || isWebFontFormat(entry.format) || isWebFontFile(entry.sourcePath)) {
    throw new Error(WOFF_INSTALL_ERROR)
  }
  host.assertPinnedInstall(entry)
  const sourcePath = options?.sourcePathOverride ?? entry.sourcePath
  if (!sourceFileExists(sourcePath)) {
    applySourcePresence(entry)
    saveCatalog(host.paths, catalog)
    throw new Error('The source file is missing.')
  }
  if (!options?.sourcePathOverride) {
    assertExpectedSourceFingerprint(tryFingerprintFile(entry.sourcePath), options?.expectedSourceFingerprint)
  }
  const renameTo = familyName?.trim()
  const installAs = Boolean(renameTo && renameTo !== displayFamily(entry))
  if (installAs && renameTo) {
    return installRenamedCopy(host, entry, renameTo, options)
  }
  const staged = stageFontFile(sourcePath, path.join(host.paths.dataRoot, 'staging'))
  const targets = installTargets(host.paths, entry, options)
  if (!options?.switch) {
    const siblings = occupyingSiblings(catalog.entries, entry, host.paths, targets)
    if (siblings[0]) {
      throw new Error(identityMutexMessage(siblings[0]))
    }
  }
  const installMacos = targets.includes('macos')
  let conflictSnapshots: Array<{ entry: CatalogEntry; file: string }> = []
  try {
    entry.format = staged.parsed.format
    entry.faces = staged.parsed.faces
    const conflicts = installMacos || options?.replace
      ? await host.resolveFormatConflicts(entry, catalog.entries, options?.replace, targets)
      : []
    catalog = loadCatalog(host.paths)
    entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    entry.format = staged.parsed.format
    entry.faces = staged.parsed.faces
    if (
      installMacos &&
      entry.status === 'installed' &&
      entry.installedPath &&
      fs.existsSync(entry.installedPath) &&
      conflicts.length === 0 &&
      !targets.includes('adobe-shared')
    ) {
      const current = readFileStat(entry.sourcePath)
      if (
        current.mtimeMs === entry.installedSnapshotMtimeMs &&
        current.size === entry.installedSnapshotSize
      ) {
        entry.sourcePresent = isExternalSource(entry)
        return entry
      }
    }
    return await withMutationJournal(
      host.paths,
      {
        kind: options?.replace ? 'replace' : 'install',
        // Conflicting installed entries are removed inside this transaction.
        // Snapshot them in the durable journal before any file is touched so a
        // process crash can restore both sides of a replacement.
        entries: [entry, ...conflicts],
      },
      async () => {
    if (conflicts.length) {
      conflictSnapshots = await host.snapshotAndRemoveConflicts(conflicts)
      catalog = loadCatalog(host.paths)
      entry = findById(catalog, id)
      if (!entry) {
        throw new Error('Font is not in the library.')
      }
      entry.format = staged.parsed.format
      entry.faces = staged.parsed.faces
    }
    if (installMacos) {
      const dest = destinationForInstall(host.paths, entry, entry.sourcePath)
      recordMutationDestination(host.paths, entry.id, dest)
      const previousInstalled =
        entry.installedPath && path.resolve(entry.installedPath) !== dest
          ? entry.installedPath
          : undefined
      let retainedFingerprint: string | undefined
      if (entry.installedPath && fs.existsSync(entry.installedPath)) {
        const retained = storeRevision(host.paths, entry.installedPath, {
          faces: entry.faces,
          format: entry.format,
        })
        retainedFingerprint = retained?.fingerprint
      }
      await commitInstalledFile({
        dest,
        stagedPath: staged.stagedPath,
        rollbackDir: path.join(host.paths.dataRoot, 'rollback'),
        native: getFontNative(),
      })
      if (previousInstalled && fs.existsSync(previousInstalled)) {
        await getFontNative().unregisterFont(previousInstalled)
        fs.rmSync(previousInstalled, { force: true })
      }
      catalog = loadCatalog(host.paths)
      entry = findById(catalog, id)
      if (!entry) {
        throw new Error('Font is not in the library.')
      }
      if (retainedFingerprint) {
        entry.previousRevisionId = retainedFingerprint
      }
      if (!sourceFileExists(entry.sourcePath)) {
        entry.sourcePath = dest
      }
      const leftoverVault = entry.disabledPath
      const fingerprint = tryFingerprintFile(dest) ?? tryFingerprintFile(staged.stagedPath)
      applyInstalledMetadata(entry, dest, staged, {
        externalSource: isExternalSource(entry),
        fingerprint,
      })
      upsertCopy(entry, {
        destinationId: 'macos',
        path: dest,
        fingerprint,
        verification: 'file-present',
      })
      if (
        leftoverVault &&
        fs.existsSync(leftoverVault) &&
        path.resolve(leftoverVault) !== path.resolve(dest)
      ) {
        fs.rmSync(leftoverVault, { force: true })
      }
    }
    if (targets.includes('adobe-shared')) {
      try {
        placeAdobeCopy(host.paths, entry, staged.stagedPath, staged.parsed.format, staged.parsed.faces)
      } catch (error) {
        if (!installMacos) throw error
        const existing = copyAt(entry, 'adobe-shared')
        if (existing) existing.verification = 'unavailable'
      }
    }
    if (!installMacos) {
      entry.faces = staged.parsed.faces
      entry.format = staged.parsed.format
      entry.status = 'installed'
      const fingerprint = tryFingerprintFile(staged.stagedPath)
      if (fingerprint) entry.installedFingerprint = fingerprint
      if (isExternalSource(entry) && !options?.sourcePathOverride) {
        entry.sourceMtimeMs = staged.stat.mtimeMs
        entry.sourceSize = staged.stat.size
        entry.sourcePresent = true
        if (fingerprint) entry.sourceFingerprint = fingerprint
      }
    }
    if (entry.updateHold === 'relink-review') {
      entry.updateHold = null
    }
    applyEntryFacts(entry)
    touchEntry(entry)
    saveCatalog(host.paths, catalog)
    return entry
      },
    )
  } catch (error) {
    await host.restoreConflictSnapshots(conflictSnapshots)
    throw error
  } finally {
    removeStagedFile(staged.stagedPath)
    for (const snapshot of conflictSnapshots) {
      if (fs.existsSync(snapshot.file)) {
        fs.rmSync(snapshot.file, { force: true })
      }
    }
  }
}

async function installRenamedCopy(
  host: ServiceLifecycleHost,
  sourceEntry: CatalogEntry,
  familyName: string,
  options?: { replace?: boolean },
): Promise<CatalogEntry> {
  const temp = await renameFamilyCopy(sourceEntry.sourcePath, familyName)
  try {
    const parsed = parseFontFile(temp)
    const catalog = loadCatalog(host.paths)
    const draft: CatalogEntry = {
      id: newId(),
      sourcePath: temp,
      sourceMtimeMs: 0,
      sourceSize: 0,
      sourcePresent: false,
      status: 'uninstalled',
      faces: parsed.faces,
      format: parsed.format,
      addedAt: now(),
      updatedAt: now(),
    }
    host.assertNoOccupyingSibling(draft, catalog.entries)
    const conflicts = await host.resolveFormatConflicts(draft, catalog.entries, options?.replace)
    const conflictSnapshots: Array<{ entry: CatalogEntry; file: string }> = []
    try {
      return await withMutationJournal(
        host.paths,
        {
          kind: options?.replace ? 'replace' : 'install',
          entries: [draft, ...conflicts],
          newEntryIds: [draft.id],
        },
        async () => {
      if (conflicts.length) {
        conflictSnapshots.push(...await host.snapshotAndRemoveConflicts(conflicts))
      }
      const dest = destinationForInstall(host.paths, draft, temp, { reuseInstalled: false })
      recordMutationDestination(host.paths, draft.id, dest)
      await commitInstalledFile({
        dest,
        stagedPath: temp,
        rollbackDir: path.join(host.paths.dataRoot, 'rollback'),
        native: getFontNative(),
      })
      bindEntryToInstalledFile(draft, dest)
      draft.faces = parsed.faces
      draft.format = parsed.format
      const next = loadCatalog(host.paths)
      upsertEntry(next, draft)
      saveCatalog(host.paths, next)
      return draft
        },
      )
    } catch (error) {
      await host.restoreConflictSnapshots(conflictSnapshots)
      throw error
    } finally {
      for (const snapshot of conflictSnapshots) {
        if (fs.existsSync(snapshot.file)) {
          fs.rmSync(snapshot.file, { force: true })
        }
      }
    }
  } finally {
    if (fs.existsSync(temp)) {
      fs.rmSync(temp, { force: true })
    }
  }
}

export async function uninstallEntry(
  host: ServiceLifecycleHost,
  id: string,
  options?: { deleteSource?: boolean },
): Promise<CatalogEntry> {
  const catalog = loadCatalog(host.paths)
  const entry = findById(catalog, id)
  if (!entry) {
    throw new Error('Font is not in the library.')
  }
  host.assertPinnedInstall(entry)
  const sourcePath = entry.sourcePath
  const hasSource = isExternalSource(entry) && sourceFileExists(sourcePath)
  const deleteSource = Boolean(options?.deleteSource && hasSource)
  await removeInstalledCopy(entry)
  removeAdobeCopy(host.paths, entry)
  entry.installations = []
  entry.destinationId = undefined
  removeManualOwner(entry)
  if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
    fs.rmSync(entry.disabledPath, { force: true })
  }
  entry.disabledPath = undefined
  entry.installedPath = undefined
  if (deleteSource) {
    await deleteSourceFile(sourcePath, host.paths)
    removeEntryById(catalog, id)
    saveCatalog(host.paths, catalog)
    entry.sourcePresent = false
    entry.status = 'uninstalled'
    return entry
  }
  if (hasSource) {
    entry.sourcePresent = true
    entry.status = 'uninstalled'
    touchEntry(entry)
    saveCatalog(host.paths, catalog)
    return entry
  }
  removeEntryById(catalog, id)
  saveCatalog(host.paths, catalog)
  entry.sourcePresent = false
  entry.status = 'uninstalled'
  return entry
}

export async function deactivateEntry(
  host: ServiceLifecycleHost,
  id: string,
  options: { removeManualOwner?: boolean } = {},
): Promise<CatalogEntry> {
  const catalog = loadCatalog(host.paths)
  const entry = findById(catalog, id)
  if (!entry) {
    throw new Error('Font is not in the library.')
  }
  const live =
    occupiedDestinations(entry, host.paths).length > 0 ||
    Boolean(entry.installedPath && fs.existsSync(entry.installedPath) && host.isLiveDestPath(entry.installedPath)) ||
    Boolean(
      copyAt(entry, 'adobe-shared')?.path &&
        fs.existsSync(copyAt(entry, 'adobe-shared')!.path) &&
        host.isLiveDestPath(copyAt(entry, 'adobe-shared')!.path),
    )
  if (!live) {
    throw new Error('This font is not installed.')
  }
  return withMutationJournal(host.paths, { kind: 'park', entries: [entry] }, async () => {
  await host.parkManagedCopies(entry)
  if (options.removeManualOwner) {
    entry.activationOwners = (entry.activationOwners ?? []).filter(
      (owner) => owner.kind !== 'manual',
    )
  }
  touchEntry(entry)
  saveCatalog(host.paths, catalog)
  return entry
  })
}

export async function activateEntry(
  host: ServiceLifecycleHost,
  id: string,
  options: InstallOptions & { owner?: 'manual' | 'project' } = {},
): Promise<CatalogEntry> {
  let catalog = loadCatalog(host.paths)
  let entry = findById(catalog, id)
  if (!entry) {
    throw new Error('Font is not in the library.')
  }
  if (!options.switch) {
    host.assertNoOccupyingSibling(entry, catalog.entries)
  }
  const targets = installTargets(host.paths, entry, options)
  const conflicts = await host.resolveFormatConflicts(entry, catalog.entries, options?.replace, targets)
  const conflictSnapshots: Array<{ entry: CatalogEntry; file: string }> = []
  catalog = loadCatalog(host.paths)
  entry = findById(catalog, id)
  if (!entry) {
    await host.restoreConflictSnapshots(conflictSnapshots)
    throw new Error('Font is not in the library.')
  }
  try {
    return await withMutationJournal(
      host.paths,
      { kind: 'install', entries: [entry, ...conflicts] },
      async () => {
    if (conflicts.length) {
      conflictSnapshots.push(...await host.snapshotAndRemoveConflicts(conflicts))
      catalog = loadCatalog(host.paths)
      entry = findById(catalog, id)
      if (!entry) throw new Error('Font is not in the library.')
    }
    const parked =
      Boolean(entry.disabledPath && fs.existsSync(entry.disabledPath)) ||
      Boolean(copyAt(entry, 'adobe-shared')?.parkedPath && fs.existsSync(copyAt(entry, 'adobe-shared')!.parkedPath))
    if (parked) {
      const requestedDestinations = options.destinationIds?.length ? options.destinationIds : undefined
      await host.unparkManagedCopies(entry, requestedDestinations)
      if (options.owner === 'manual') {
        addManualOwner(entry)
      }
      entry.status = 'installed'
      entry.sourcePresent = isExternalSource(entry)
      touchEntry(entry)
      saveCatalog(host.paths, catalog)
      const extra = (options.destinationIds ?? []).filter(
        (dest) => !occupiesDestination(entry, dest, host.paths),
      )
      const retainedPath =
        entry.installedPath && fs.existsSync(entry.installedPath)
          ? entry.installedPath
          : copyAt(entry, 'adobe-shared')?.path
      if (extra.length && retainedPath && fs.existsSync(retainedPath)) {
        return installEntry(host, id, undefined, {
          ...options,
          destinationIds: extra,
          sourcePathOverride: retainedPath,
        })
      }
      return entry
    }
    if (entry.installedPath && fs.existsSync(entry.installedPath) && host.isLiveDestPath(entry.installedPath)) {
      await ensureFontActivation(getFontNative(), entry.installedPath, true)
      catalog = loadCatalog(host.paths)
      entry = findById(catalog, id)
      if (!entry) {
        throw new Error('Font is not in the library.')
      }
      if (options.owner === 'manual') {
        addManualOwner(entry)
      }
      entry.status = 'installed'
      touchEntry(entry)
      saveCatalog(host.paths, catalog)
      const extra = (options.destinationIds ?? []).filter(
        (dest) => !occupiesDestination(entry, dest, host.paths),
      )
      if (extra.length && entry.installedPath && fs.existsSync(entry.installedPath)) {
        return installEntry(host, id, undefined, {
          ...options,
          destinationIds: extra,
          sourcePathOverride: entry.installedPath,
        })
      }
      return entry
    }
    return installEntry(host, id, undefined, options)
      },
    )
  } catch (error) {
    await host.restoreConflictSnapshots(conflictSnapshots)
    throw error
  } finally {
    for (const snapshot of conflictSnapshots) {
      if (fs.existsSync(snapshot.file)) {
        fs.rmSync(snapshot.file, { force: true })
      }
    }
  }
}

export async function reinstallEntry(
  host: ServiceLifecycleHost,
  id: string,
  options?: InstallOptions,
): Promise<CatalogEntry> {
  const catalog = loadCatalog(host.paths)
  const entry = findById(catalog, id)
  if (!entry) {
    throw new Error('Font is not in the library.')
  }
  if (entry.status === 'deactivated') {
    return activateEntry(host, id, { owner: 'manual' })
  }
  await host.clearCachesAfterInstall()
  const updated = await installEntry(host, id, entry.customFamilyName, options)
  emitNotice({
    kind: 'reinstalled',
    message: `Reinstalled ${displayFamily(updated)}`,
    entryId: updated.id,
  })
  return updated
}

import fs from 'node:fs'
import path from 'node:path'
import {
  findByInstalledPath,
  findBySourcePath,
  isExternalSource,
  loadCatalog,
  saveCatalog,
  upsertEntry,
} from './catalog.ts'
import { isUnderAnyRoot } from './containment.ts'
import { duplicateNotifyKey, upsertDuplicateWarning } from './duplicates.ts'
import { occupyingSiblingsForIncoming } from './identity.ts'
import { assertNotWebFont, isWebFontFile, isWebFontFormat } from './formats.ts'
import { tryFingerprintFile } from './fingerprint.ts'
import { folderForPath, isExcluded, mostSpecificOwner } from './folders.ts'
import { applyParsedFont, isFontFile, isPreviewableFontFile, parseFontFile, readFileStat } from './parse.ts'
import { classifyImportFile, isInactiveRetailListing, isWatchIdentityDuplicate } from './planner.ts'
import type { AppPaths } from './paths.ts'
import { applyEntryFacts } from './state.ts'
import { loadSettings } from './settings.ts'
import type { CatalogEntry, CatalogFile } from './types.ts'
import { displayFamily, emitDuplicates, emitNotice, newId, now, touchEntry } from './service-helpers.ts'

export function importOneUnlocked(
  paths: AppPaths,
  filePath: string,
  options: { forceNew?: boolean; catalog?: CatalogFile; persist?: boolean } = {},
): CatalogEntry {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error('Not a file.')
  }
  const previewOnly = isWebFontFile(resolved)
  if (!previewOnly) {
    assertNotWebFont(resolved)
  }
  if (!isFontFile(resolved) && !isPreviewableFontFile(resolved)) {
    throw new Error('Not a font file.')
  }
  const parsed = parseFontFile(resolved)
  if (parsed.faces.length === 0) {
    throw new Error('Could not read any faces in that font.')
  }
  if (isWebFontFormat(parsed.format)) {
    // Parsed content wins over a misleading extension.
  }
  const catalog = options.catalog ?? loadCatalog(paths)
  const persist = options.persist !== false
  const fingerprint = tryFingerprintFile(resolved)
  const samePath = (() => {
    const found = findByInstalledPath(catalog, resolved) ?? findBySourcePath(catalog, resolved)
    return found && isInactiveRetailListing(found) ? undefined : found
  })()
  const sameBytes = fingerprint
    ? catalog.entries.find(
        (item) =>
          !isInactiveRetailListing(item) &&
          (item.sourceFingerprint === fingerprint || item.installedFingerprint === fingerprint),
      )
    : undefined
  const existing = options.forceNew ? samePath : (samePath ?? sameBytes)
  const stat = readFileStat(resolved)
  const inUserFonts = isUnderAnyRoot(resolved, [paths.userFontsDir, paths.installDir])
  const settings = loadSettings(paths)
  const owner = mostSpecificOwner(settings.folders, resolved)
  if (existing) {
    if (samePath && inUserFonts && !existing.installedPath) {
      existing.installedPath = resolved
      existing.status = 'installed'
    }
    applyParsedFont(existing, parsed)
    if (fingerprint) existing.sourceFingerprint = existing.sourceFingerprint ?? fingerprint
    if (!inUserFonts || isExternalSource(existing)) {
      existing.sourceMtimeMs = stat.mtimeMs
      existing.sourceSize = stat.size
    }
    if (
      samePath &&
      existing.status === 'installed' &&
      isExternalSource(existing) &&
      fingerprint &&
      existing.installedFingerprint &&
      fingerprint !== existing.installedFingerprint
    ) {
      existing.status = 'outdated'
    } else if (
      samePath &&
      existing.status === 'installed' &&
      isExternalSource(existing) &&
      (stat.mtimeMs !== existing.installedSnapshotMtimeMs ||
        stat.size !== existing.installedSnapshotSize)
    ) {
      existing.status = 'outdated'
    }
    applyEntryFacts(existing)
    touchEntry(existing)
    if (persist) saveCatalog(paths, catalog)
    return existing
  }
  const web = previewOnly || isWebFontFormat(parsed.format)
  const entry: CatalogEntry = {
    id: newId(),
    sourcePath: resolved,
    sourceMtimeMs: stat.mtimeMs,
    sourceSize: stat.size,
    sourcePresent: !inUserFonts,
    sourceFingerprint: fingerprint,
    installedFingerprint: inUserFonts ? fingerprint : undefined,
    ownerFolderId: owner?.id ?? null,
    previewOnly: web,
    status: web ? 'uninstalled' : inUserFonts ? 'installed' : 'uninstalled',
    installedPath: web ? undefined : inUserFonts ? resolved : undefined,
    faces: parsed.faces,
    format: parsed.format,
    previewSample: parsed.previewSample,
    addedAt: now(),
    updatedAt: now(),
  }
  applyEntryFacts(entry)
  upsertEntry(catalog, entry)
  if (persist) saveCatalog(paths, catalog)
  return entry
}

export type InboxImportHost = {
  readonly paths: AppPaths
  listCatalog(): CatalogEntry[]
  importPaths(filePaths: string[]): Promise<{
    entries: CatalogEntry[]
    errors: string[]
    ignored: number
  }>
  install(id: string): Promise<CatalogEntry>
}

export async function importInboxFiles(host: InboxImportHost, filePaths: string[]): Promise<void> {
  const settings = loadSettings(host.paths)
  const allowed = filePaths.filter((filePath) => {
    const folder = folderForPath(settings.folders, filePath)
    if (!folder) return true
    if (!folder.watching || folder.paused || isExcluded(folder, filePath)) return false
    return true
  })
  const catalog = loadCatalog(host.paths)
  const auto: string[] = []
  let notified = 0
  for (const filePath of allowed) {
    const item = classifyImportFile(filePath, catalog, { paths: host.paths })
    if (isWatchIdentityDuplicate(item)) {
      const occupying = occupyingSiblingsForIncoming(
        catalog.entries,
        item.faces ?? [],
        item.format,
        host.paths,
      )
      const { notify } = upsertDuplicateWarning(host.paths, {
        path: item.path,
        fingerprint: item.fingerprint,
        familyName: item.familyName,
        format: item.format,
        incomingVersion: item.incomingVersion,
        conflictingEntryIds: [
          ...new Set([
            ...occupying.map((entry) => entry.id),
            ...(item.siblingEntryIds ?? []),
            ...(item.entryId ? [item.entryId] : []),
          ]),
        ],
        activeEntryId: occupying[0]?.id ?? item.entryId,
        folderId: folderForPath(settings.folders, filePath)?.id,
        notifyKey: duplicateNotifyKey(
          item.path,
          item.fingerprint,
          occupying.map((entry) => entry.installedFingerprint ?? entry.sourceFingerprint ?? '').filter(Boolean),
        ),
      })
      if (notify) notified += 1
      continue
    }
    auto.push(filePath)
  }
  emitDuplicates(host.paths)
  if (notified > 0) {
    emitNotice({
      kind: 'info',
      message:
        notified === 1
          ? 'A watch-folder duplicate needs review before anything is installed.'
          : `${notified} watch-folder duplicates need review before anything is installed.`,
    })
  }
  if (auto.length === 0) {
    return
  }
  const beforeIds = new Set(host.listCatalog().map((entry) => entry.id))
  const result = await host.importPaths(auto)
  const added = result.entries.filter((entry) => !beforeIds.has(entry.id))
  const installed: CatalogEntry[] = []
  for (const entry of added) {
    if (entry.previewOnly || entry.status === 'installed' || entry.status === 'source-missing') {
      continue
    }
    const folder = settings.folders.find((item) => item.id === entry.ownerFolderId)
    if (folder && (folder.paused || isExcluded(folder, entry.sourcePath))) {
      continue
    }
    const installNew = folder ? folder.installNew : settings.installWatchFolderFonts
    if (!installNew) continue
    try {
      installed.push(await host.install(entry.id))
    } catch (error) {
      emitNotice({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : `Could not install ${displayFamily(entry)}`,
        entryId: entry.id,
      })
    }
  }
  const first = installed[0] ?? added[0]
  if (first) {
    const count = installed.length > 0 ? installed.length : added.length
    const didInstall = installed.length > 0
    emitNotice({
      kind: didInstall ? 'installed' : 'info',
      message:
        count === 1
          ? `${didInstall ? 'Installed' : 'Added'} ${displayFamily(first)} from a watch folder`
          : `${didInstall ? 'Installed' : 'Added'} ${count} fonts from a watch folder`,
      entryId: first.id,
    })
  }
  if (result.errors.length) {
    emitNotice({
      kind: 'error',
      message: result.errors.join('\n'),
    })
  }
}

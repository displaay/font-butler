import fs from 'node:fs'
import path from 'node:path'
import { readRetailToken, writeRetailToken } from './auth.ts'
import { loadCatalog, occupantsAtPath, removeEntryById, runCatalogTask, saveCatalog, upsertEntry } from './catalog.ts'
import { copyAt, upsertCopy } from './destinations.ts'
import { emitEvent } from './events.ts'
import { tryFingerprintFile } from './fingerprint.ts'
import { importOneUnlocked } from './service-import.ts'
import { getFontNative } from './native.ts'
import { applyParsedFont, parseFontFile } from './parse.ts'
import { retailTokenPath } from './paths.ts'
import { loadPlan } from './planner.ts'
import { loadProjects } from './projects.ts'
import type { AppPaths } from './paths.ts'
import { yieldEventLoop } from './event-loop.ts'
import { applyRetailSync } from './retail-apply.ts'
import { fetchRetailFile, fetchRetailManifest, isAllowedRetailBaseUrl } from './retail-client.ts'
import {
  countPendingDrift,
  diffRetailManifest,
  loadRetailManifest,
  resolveRetailCachePath,
  resolveRetailInstallPath,
  saveRetailManifest,
  statRetailFile,
} from './retail-sync.ts'
import { newId, now, removeInstalledCopy, touchEntry } from './service-helpers.ts'
import { DEFAULT_RETAIL_WORKER_BASE_URL, defaultRetailSync, loadSettings, saveSettings } from './settings.ts'
import { applyEntryFacts } from './state.ts'
import type { AppSettings, CatalogEntry, FontFaceInfo, RetailSyncSettings } from './types.ts'
import {
  familyHasValidDropReplacement,
  findOutsideCollisionsForRetailFamilies,
  findRetailCollisionsForIncomingFamilies,
  retailFamiliesPendingSync,
  retailOwnedInstallContext,
  uninstallCollisionEntries,
  type DropReplacementIncoming,
} from './retail-collisions.ts'
import {
  applyRetailFontSelection,
  filterDisabledRetailDrift,
  isRetailFamilyOptedOut,
  normalizeAutoCheckMinutes,
  normalizeDisabledGlyphsFiles,
  normalizeFamilyFormats,
  retailFileFamilyName,
  retailFileFormat,
  retailFontsFromCollections,
  retailTypefaceName,
  selectedFormatsFromFonts,
  selectedRetailFormat,
  isSelectedRetailFormat,
  type RetailCollisionAction,
  type RetailFamilyCollision,
  type RetailFontFormat,
  type RetailOptOutMode,
} from '../shared/retail.ts'
import type {
  RetailDriftItem,
  RetailManifest,
  RetailSkip,
  RetailSyncFont,
  RetailSyncStatus,
} from '../shared/retail.ts'

type CachedRetailFont = {
  familyName: string
  typefaceName: string
  glyphsFile: string
  fileCount: number
  available: boolean
  formats: RetailFontFormat[]
}

/** In-memory only: the last check's result, so `status` is cheap and never touches the network. */
type RetailCache = {
  checkedAt: string | null
  drift: RetailDriftItem[]
  skipped: RetailSkip[]
  error: string | null
  /** `null` until a successful check this process; catalog listings cover a restart. */
  fonts: CachedRetailFont[] | null
  collisions: RetailFamilyCollision[]
}

const cache: RetailCache = {
  checkedAt: null,
  drift: [],
  skipped: [],
  error: null,
  fonts: null,
  collisions: [],
}

/**
 * Two overlapping syncs would fight over the same `.part` files: the second one's entry sweep deletes
 * the first one's in-flight downloads, and both write the same temp path before renaming it over the
 * target. A shared promise makes a second request join the run already in progress.
 */
let inflightSync: Promise<RetailSyncStatus> | null = null

export function resetRetailCache(): void {
  cache.checkedAt = null
  cache.drift = []
  cache.skipped = []
  cache.error = null
  cache.fonts = null
  cache.collisions = []
}

function cacheFontsFromSync(fonts: RetailSyncFont[]): CachedRetailFont[] {
  return fonts.map((font) => ({
    familyName: font.familyName,
    typefaceName: font.typefaceName,
    glyphsFile: font.familyName,
    fileCount: font.fileCount,
    available: font.available,
    formats: font.formats,
  }))
}

function firstRelativeSegment(relativePath: string): string {
  const slash = relativePath.indexOf('/')
  return (slash === -1 ? relativePath : relativePath.slice(0, slash)).trim()
}

function fontsFromCatalog(
  paths: AppPaths,
  disabledGlyphsFiles: readonly string[],
  familyFormats: Readonly<Record<string, RetailFontFormat>>,
  optOutMode: RetailOptOutMode,
): RetailSyncFont[] {
  const families = new Map<
    string,
    {
      familyName: string
      typefaceName: string
      formats: Set<RetailFontFormat>
      counts: Map<RetailFontFormat | 'other', number>
    }
  >()
  for (const entry of loadCatalog(paths).entries) {
    const relative = entry.retailRelativePath
    if (!relative) continue
    const typefaceFallback = firstRelativeSegment(relative)
    const familyName = (entry.retailFamilyName ?? entry.faces[0]?.familyName ?? typefaceFallback).trim()
    if (!familyName) continue
    const typefaceName = (entry.retailTypefaceName ?? (typefaceFallback || familyName)).trim()
    const current = families.get(familyName) ?? {
      familyName,
      typefaceName,
      formats: new Set<RetailFontFormat>(),
      counts: new Map<RetailFontFormat | 'other', number>(),
    }
    const format = retailFileFormat(relative) ?? retailFileFormat(`.${entry.format}`)
    if (format) current.formats.add(format)
    const key = format ?? 'other'
    current.counts.set(key, (current.counts.get(key) ?? 0) + 1)
    families.set(familyName, current)
  }
  return applyRetailFontSelection(
    [...families.values()].map((family) => {
      const formats = [...family.formats]
      const selected = selectedRetailFormat(family.familyName, formats, familyFormats)
      const fileCount =
        formats.length === 0
          ? [...family.counts.values()].reduce((sum, count) => sum + count, 0)
          : (family.counts.get(selected) ?? 0)
      return {
        familyName: family.familyName,
        typefaceName: family.typefaceName,
        glyphsFile: family.familyName,
        fileCount,
        formats,
        available: true,
      }
    }),
    disabledGlyphsFiles,
    familyFormats,
    optOutMode,
  )
}

function listRetailFonts(
  paths: AppPaths,
  disabledGlyphsFiles: readonly string[],
  familyFormats: Readonly<Record<string, RetailFontFormat>>,
  optOutMode: RetailOptOutMode,
): RetailSyncFont[] {
  if (cache.fonts) {
    return applyRetailFontSelection(cache.fonts, disabledGlyphsFiles, familyFormats, optOutMode)
  }
  return fontsFromCatalog(paths, disabledGlyphsFiles, familyFormats, optOutMode)
}

function optOutModeOf(config: RetailSyncSettings): RetailOptOutMode {
  return config.familyOptOuts ? 'family' : 'typeface'
}

function visibleDrift(config: RetailSyncSettings, fonts: RetailSyncFont[]): RetailDriftItem[] {
  return filterDisabledRetailDrift(cache.drift, config.disabledGlyphsFiles, {
    disabledFamilyNames: config.disabledGlyphsFiles,
    familyFormats: config.familyFormats,
    selectedFormats: selectedFormatsFromFonts(fonts),
    optOutMode: optOutModeOf(config),
  })
}

function retailSettings(settings: AppSettings): RetailSyncSettings {
  const current = settings.retailSync
  if (!current) return defaultRetailSync()
  return {
    ...defaultRetailSync(),
    ...current,
    disabledGlyphsFiles: current.disabledGlyphsFiles ?? [],
    familyFormats: current.familyFormats ?? {},
    familyOptOuts: current.familyOptOuts === true,
  }
}

export function retailStatus(paths: AppPaths, settings = loadSettings(paths)): RetailSyncStatus {
  const config = retailSettings(settings)
  const local = loadRetailManifest(paths)
  const fonts = listRetailFonts(
    paths,
    config.disabledGlyphsFiles,
    config.familyFormats,
    optOutModeOf(config),
  )
  const drift = visibleDrift(config, fonts)
  return {
    enabled: config.enabled,
    autoCheckMinutes: config.autoCheckMinutes,
    configured: config.enabled,
    // Never the token itself: this object is emitted as an event and returned to the renderer.
    hasToken: readRetailToken(retailTokenPath(paths)).length > 0,
    workerBaseUrl: config.workerBaseUrl || DEFAULT_RETAIL_WORKER_BASE_URL,
    checkedAt: cache.checkedAt,
    syncedAt: local.syncedAt,
    pending: countPendingDrift(drift),
    drift,
    skipped: cache.skipped,
    error: cache.error,
    fonts,
    disabledGlyphsFiles: config.disabledGlyphsFiles,
    familyFormats: config.familyFormats,
    collisions: cache.collisions,
  }
}

function emitRetail(paths: AppPaths): RetailSyncStatus {
  const status = retailStatus(paths)
  emitEvent({ type: 'retail', status })
  return status
}

export async function configureRetailSync(
  paths: AppPaths,
  input: {
    enabled?: boolean
    workerBaseUrl?: string
    autoCheckMinutes?: number
    token?: string
    folderId?: string | null
    disabledGlyphsFiles?: string[]
    familyFormats?: Record<string, RetailFontFormat>
  },
): Promise<RetailSyncStatus> {
  const settings = loadSettings(paths)
  const current = retailSettings(settings)

  const workerBaseUrl = (input.workerBaseUrl ?? current.workerBaseUrl).trim()
  if (workerBaseUrl && !isAllowedRetailBaseUrl(workerBaseUrl)) {
    throw new Error('The Displaay worker address must be an https URL.')
  }

  const next: RetailSyncSettings = {
    enabled: input.enabled ?? current.enabled,
    workerBaseUrl: workerBaseUrl || DEFAULT_RETAIL_WORKER_BASE_URL,
    autoCheckMinutes:
      input.autoCheckMinutes === undefined
        ? current.autoCheckMinutes
        : normalizeAutoCheckMinutes(input.autoCheckMinutes),
    disabledGlyphsFiles:
      input.disabledGlyphsFiles === undefined
        ? (current.disabledGlyphsFiles ?? [])
        : normalizeDisabledGlyphsFiles(input.disabledGlyphsFiles),
    familyFormats:
      input.familyFormats === undefined
        ? (current.familyFormats ?? {})
        : normalizeFamilyFormats(input.familyFormats),
    familyOptOuts: input.disabledGlyphsFiles === undefined ? current.familyOptOuts : true,
  }
  // Cached drift describes one server. If the address or credentials change, it is no longer a
  // statement about anything — serving it would report the old server's files as pending.
  const invalidates = next.workerBaseUrl !== current.workerBaseUrl || input.token !== undefined
  // The token is written to its own 0600 file, never into settings.json. An empty string clears it.
  // Written first: if it throws, settings are not yet on disk and the two cannot disagree.
  if (input.token !== undefined) {
    writeRetailToken(retailTokenPath(paths), input.token)
  }
  settings.retailSync = next
  saveSettings(paths, settings)
  if (invalidates) {
    resetRetailCache()
  }

  emitEvent({ type: 'settings', settings })
  const formatsChanged = JSON.stringify(next.familyFormats) !== JSON.stringify(current.familyFormats)
  if (formatsChanged) {
    await uninstallUnselectedRetailFormats(paths, next)
  }
  return emitRetail(paths)
}

function retailFamilyOfEntry(entry: CatalogEntry): string {
  const relative = entry.retailRelativePath ?? ''
  return (entry.retailFamilyName ?? entry.faces[0]?.familyName ?? firstRelativeSegment(relative)).trim()
}

function retailTypefaceOfEntry(entry: CatalogEntry): string {
  const relative = entry.retailRelativePath ?? ''
  return (entry.retailTypefaceName ?? (firstRelativeSegment(relative) || retailFamilyOfEntry(entry))).trim()
}

function resetRetailListingSource(entry: CatalogEntry, removedPaths: string[]): void {
  const removed = new Set(removedPaths.filter(Boolean).map((item) => path.resolve(item)))
  const source = entry.sourcePath
  if (source && (removed.has(path.resolve(source)) || !fs.existsSync(source))) {
    entry.sourcePath = ''
    entry.sourceMtimeMs = 0
    entry.sourceSize = 0
  }
  entry.sourcePresent = false
  entry.sourceAvailability = 'none'
  entry.status = 'uninstalled'
  touchEntry(entry)
}

async function uninstallUnselectedRetailFormats(paths: AppPaths, config: RetailSyncSettings): Promise<void> {
  await runCatalogTask(async () => {
    const fonts = listRetailFonts(
      paths,
      config.disabledGlyphsFiles,
      config.familyFormats,
      optOutModeOf(config),
    )
    const mode = optOutModeOf(config)
    const selected = selectedFormatsFromFonts(fonts)
    const catalog = loadCatalog(paths)
    let dirty = false
    for (const entry of catalog.entries) {
      const relative = entry.retailRelativePath
      if (!relative) continue
      const familyName = retailFamilyOfEntry(entry)
      const typefaceName = retailTypefaceOfEntry(entry)
      if (!familyName || isRetailFamilyOptedOut(familyName, typefaceName, config.disabledGlyphsFiles, mode)) {
        continue
      }
      const want = selected[familyName]
      const format = retailFileFormat(relative)
      if (!want || !format || format === want) continue
      const installed =
        entry.status === 'installed' ||
        Boolean(entry.installedPath && fs.existsSync(entry.installedPath))
      if (installed || entry.disabledPath) {
        const livePath = entry.installedPath
        const parkedPath = entry.disabledPath
        await removeInstalledCopy(entry)
        if (parkedPath && fs.existsSync(parkedPath)) {
          fs.rmSync(parkedPath, { force: true })
        }
        entry.disabledPath = undefined
        entry.installations = []
        resetRetailListingSource(entry, [livePath ?? '', parkedPath ?? ''])
        upsertEntry(catalog, entry)
        dirty = true
      }
    }
    if (dirty) {
      saveCatalog(paths, catalog)
      emitEvent({ type: 'catalog', entries: catalog.entries })
    }
  })
}

function requireReady(paths: AppPaths): {
  config: RetailSyncSettings
  token: string
} {
  const settings = loadSettings(paths)
  const config = retailSettings(settings)
  if (!config.enabled) {
    throw new Error('Turn on the Displaay retail collection first.')
  }
  const token = readRetailToken(retailTokenPath(paths))
  if (!token) {
    throw new Error('Add a Displaay worker token first.')
  }
  return { config, token }
}

function findRetailEntry(catalog: ReturnType<typeof loadCatalog>, relativePath: string): CatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.retailRelativePath === relativePath)
}

function occupantAt(catalog: ReturnType<typeof loadCatalog>, dest: string): CatalogEntry | undefined {
  const resolved = path.resolve(dest)
  return (
    catalog.entries.find(
      (entry) =>
        entry.installedPath &&
        path.resolve(entry.installedPath) === resolved &&
        fs.existsSync(entry.installedPath),
    ) ??
    catalog.entries.find(
      (entry) =>
        entry.disabledPath &&
        path.resolve(entry.disabledPath) === resolved &&
        fs.existsSync(entry.disabledPath),
    )
  )
}

function fontsDestOccupied(paths: AppPaths, relativePath: string): boolean {
  const dest = resolveRetailInstallPath(paths.userFontsDir, relativePath)
  if (!dest) return false
  const occupants = occupantsAtPath(loadCatalog(paths), dest).filter(
    (entry) => entry.retailRelativePath !== relativePath,
  )
  if (occupants.length > 0) return true
  return fs.existsSync(dest) && !occupantAt(loadCatalog(paths), dest)
}

function destForRelativePath(paths: AppPaths, relativePath: string): { dest: string; parked: boolean } | null {
  const catalog = loadCatalog(paths)
  const existing = findRetailEntry(catalog, relativePath)
  const config = retailSettings(loadSettings(paths))
  const optOutMode = optOutModeOf(config)
  const fonts = listRetailFonts(
    paths,
    config.disabledGlyphsFiles,
    config.familyFormats,
    optOutMode,
  )
  const familyName = existing ? retailFamilyOfEntry(existing) : firstRelativeSegment(relativePath)
  const typefaceName = existing ? retailTypefaceOfEntry(existing) : firstRelativeSegment(relativePath)
  if (
    familyName &&
    (isRetailFamilyOptedOut(familyName, typefaceName, config.disabledGlyphsFiles, optOutMode) ||
      !isSelectedRetailFormat(relativePath, familyName, {
        selectedFormats: selectedFormatsFromFonts(fonts),
      }))
  ) {
    return null
  }
  const pinned = loadProjects(paths).some(
    (project) =>
      project.desiredActive &&
      project.members.some(
        (member) =>
          member.assetId === existing?.id &&
          Boolean(member.pinFingerprint),
      ),
  )
  if (pinned) throw new Error('This retail font is pinned by an active project.')
  if (existing?.status === 'deactivated' && existing.disabledPath) {
    return { dest: existing.disabledPath, parked: true }
  }
  if (existing?.installedPath && existing.status !== 'uninstalled') {
    return { dest: existing.installedPath, parked: false }
  }
  const known = loadRetailManifest(paths).files[relativePath]
  const holdOffFonts = existing?.status === 'uninstalled' && Boolean(known)
  if (holdOffFonts || fontsDestOccupied(paths, relativePath)) {
    const cached = resolveRetailCachePath(paths, relativePath)
    if (!cached) return null
    return { dest: cached, parked: true }
  }
  const dest = resolveRetailInstallPath(paths.userFontsDir, relativePath)
  if (!dest) return null
  return { dest, parked: false }
}

function stubRetailFace(familyName: string, relativePath: string): FontFaceInfo {
  const base = path.basename(relativePath, path.extname(relativePath))
  const family = familyName.trim() || base
  return {
    familyName: family,
    styleName: base.replace(new RegExp(`^${family}`, 'i'), '').replace(/^[-_ ]+/, '') || 'Regular',
    fullName: `${family} ${base}`.trim(),
    postscriptName: '',
    isVariable: /vf$/i.test(base),
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function ensureRetailListings(paths: AppPaths, manifest: RetailManifest): boolean {
  const catalog = loadCatalog(paths)
  let changed = false
  for (const collection of manifest.collections ?? []) {
    const typefaceName = retailTypefaceName(collection)
    for (const file of collection.files ?? []) {
      if (!file?.relativePath || !resolveRetailInstallPath(paths.userFontsDir, file.relativePath)) {
        continue
      }
      const familyName = retailFileFamilyName(file, collection)
      const existing = findRetailEntry(catalog, file.relativePath)
      if (existing) {
        if (existing.retailFamilyName !== familyName || existing.retailTypefaceName !== typefaceName) {
          existing.retailFamilyName = familyName
          existing.retailTypefaceName = typefaceName
          applyEntryFacts(existing)
          upsertEntry(catalog, existing)
          changed = true
        }
        continue
      }
      const format = path.extname(file.relativePath).replace(/^\./, '').toLowerCase() || 'otf'
      const entry: CatalogEntry = {
        id: newId(),
        sourcePath: '',
        sourceMtimeMs: 0,
        sourceSize: 0,
        sourcePresent: false,
        retailRelativePath: file.relativePath,
        retailFamilyName: familyName,
        retailTypefaceName: typefaceName,
        status: 'uninstalled',
        faces: [stubRetailFace(familyName, file.relativePath)],
        format,
        addedAt: now(),
        updatedAt: now(),
      }
      applyEntryFacts(entry)
      upsertEntry(catalog, entry)
      changed = true
    }
  }
  if (changed) {
    saveCatalog(paths, catalog)
    emitEvent({ type: 'catalog', entries: loadCatalog(paths).entries })
  }
  return changed
}

function statRetailInstall(paths: AppPaths) {
  const catalog = loadCatalog(paths)
  const disk = statRetailFile(paths.userFontsDir)
  return (relativePath: string) => {
    const entry = findRetailEntry(catalog, relativePath)
    const live = entry?.installedPath
    const parked = entry?.disabledPath
    for (const candidate of [live, parked, entry?.sourcePath]) {
      if (!candidate) continue
      try {
        const stat = fs.statSync(candidate)
        if (stat.isFile()) return { exists: true, size: stat.size }
      } catch {
        // Fall through to the flattened Fonts path.
      }
    }
    const cached = resolveRetailCachePath(paths, relativePath)
    if (cached) {
      try {
        const stat = fs.statSync(cached)
        if (stat.isFile()) return { exists: true, size: stat.size }
      } catch {
        // Fall through.
      }
    }
    return disk(relativePath)
  }
}

async function readManifest(
  paths: AppPaths,
  options: { refresh?: boolean; fetchManifest?: typeof fetchRetailManifest } = {},
): Promise<{ manifest: RetailManifest; token: string; workerBaseUrl: string }> {
  const { config, token } = requireReady(paths)
  const manifest = await (options.fetchManifest ?? fetchRetailManifest)({
    workerBaseUrl: config.workerBaseUrl,
    token,
    refresh: options.refresh,
  })
  return { manifest, token, workerBaseUrl: config.workerBaseUrl }
}

function measureDrift(paths: AppPaths, manifest: RetailManifest): RetailDriftItem[] {
  return diffRetailManifest(manifest, loadRetailManifest(paths), statRetailInstall(paths))
}

function isStubRetailFaces(entry: CatalogEntry | undefined): boolean {
  return !entry?.faces?.some((face) => Boolean(face.postscriptName))
}

function recordedFingerprintForDest(entry: CatalogEntry | undefined, dest: string): string | undefined {
  if (!entry) return undefined
  const resolved = path.resolve(dest)
  const macos = copyAt(entry, 'macos')
  if (entry.installedPath && path.resolve(entry.installedPath) === resolved) {
    return macos?.fingerprint ?? entry.installedFingerprint
  }
  if (entry.disabledPath && path.resolve(entry.disabledPath) === resolved) {
    return macos?.fingerprint ?? entry.installedFingerprint
  }
  if (entry.sourcePath && path.resolve(entry.sourcePath) === resolved) {
    return entry.sourceFingerprint ?? macos?.fingerprint ?? entry.installedFingerprint
  }
  return macos?.fingerprint ?? entry.installedFingerprint ?? entry.sourceFingerprint
}

/** True when faces are stubs or the dest bytes are not the revision the catalog last recorded. */
function destNeedsFaceParse(
  entry: CatalogEntry | undefined,
  dest: string,
  liveFingerprint: string | undefined,
): boolean {
  if (isStubRetailFaces(entry)) return true
  if (!liveFingerprint) return false
  return liveFingerprint !== recordedFingerprintForDest(entry, dest)
}

async function catalogRetailWrites(
  paths: AppPaths,
  written: Array<{ relativePath: string; dest: string; parked: boolean }>,
  options: { parse?: 'always' | 'if-unconfirmed' } = {},
): Promise<void> {
  if (written.length === 0) return
  // Held across yields so a concurrent uninstall/import cannot save a newer catalog that we then
  // overwrite with this snapshot. Nested persist callers already hold the lock; runCatalogTask
  // runs those immediately.
  await runCatalogTask(async () => {
    const parse = options.parse ?? 'always'
    const catalog = loadCatalog(paths)
    let dirty = false
    for (let index = 0; index < written.length; index += 1) {
      await yieldEventLoop()
      const item = written[index]!
      let entry = findRetailEntry(catalog, item.relativePath)
      const pathOccupant = catalog.entries.find((candidate) => {
        if (candidate.id === entry?.id || candidate.retailRelativePath) return false
        const pathsToCheck = [candidate.installedPath, candidate.disabledPath, ...(candidate.installations ?? []).flatMap((copy) => [copy.path, copy.parkedPath])]
        return pathsToCheck.some((candidatePath) => candidatePath && path.resolve(candidatePath) === path.resolve(item.dest) && fs.existsSync(candidatePath))
      })
      if (!entry && pathOccupant) entry = pathOccupant
      if (entry && pathOccupant && pathOccupant.id !== entry.id) {
        removeEntryById(catalog, pathOccupant.id)
      }
      const wasDeactivated = Boolean(
        entry &&
          (entry.status === 'deactivated' ||
            (entry.disabledPath && fs.existsSync(entry.disabledPath)) ||
            copyAt(entry, 'macos')?.parkedPath && fs.existsSync(copyAt(entry, 'macos')!.parkedPath!)),
      )
      const previousMacos = entry ? copyAt(entry, 'macos') : undefined
      const fingerprint = tryFingerprintFile(item.dest)
      const shouldParse = parse === 'always' || destNeedsFaceParse(entry, item.dest, fingerprint)
      try {
        if (shouldParse && fs.existsSync(item.dest)) {
          const parsed = parseFontFile(item.dest)
          if (parsed.faces.length > 0) {
            if (entry) applyParsedFont(entry, parsed)
            else entry = importOneUnlocked(paths, item.dest, { catalog, persist: false })
          }
        }
      } catch {
        // Dummy or unreadable bytes still keep the listing.
      }
      if (!entry) continue
      entry.retailRelativePath = item.relativePath
      if (item.parked && wasDeactivated) {
        const livePath = entry.installedPath ?? previousMacos?.path ?? resolveRetailInstallPath(paths.userFontsDir, item.relativePath) ?? item.dest
        entry.sourcePath = entry.sourcePath || livePath
        entry.installedPath = livePath
        entry.disabledPath = item.dest
        entry.status = 'deactivated'
        upsertCopy(entry, {
          destinationId: 'macos',
          path: livePath,
          parkedPath: item.dest,
          fingerprint,
          verification: 'unavailable',
        })
        if (fingerprint) entry.installedFingerprint = fingerprint
      } else if (item.parked) {
        // A cached copy is still the source used when the user explicitly installs the listing.
        entry.sourcePath = item.dest
        entry.sourcePresent = true
        entry.installedPath = undefined
        entry.disabledPath = undefined
        entry.status = 'uninstalled'
        if (fingerprint) entry.sourceFingerprint = fingerprint
        if (previousMacos) {
          entry.installations = (entry.installations ?? []).filter((copy) => copy.destinationId !== 'macos')
        }
      } else {
        entry.installedPath = item.dest
        entry.disabledPath = undefined
        entry.sourcePath = item.dest
        entry.status = 'installed'
        entry.sourcePresent = false
        entry.installedFingerprint = fingerprint
        if (fingerprint) {
          const stat = fs.statSync(item.dest)
          entry.installedSnapshotMtimeMs = stat.mtimeMs
          entry.installedSnapshotSize = stat.size
        }
        upsertCopy(entry, {
          destinationId: 'macos',
          path: item.dest,
          fingerprint,
          verification: 'file-present',
        })
      }
      upsertEntry(catalog, entry)
      applyEntryFacts(entry)
      dirty = true
    }
    if (dirty) {
      saveCatalog(paths, catalog)
      emitEvent({ type: 'catalog', entries: catalog.entries })
    }
  })
}

async function reconcileRetailCatalog(
  paths: AppPaths,
  manifest: ReturnType<typeof loadRetailManifest>,
): Promise<void> {
  const written = Object.values(manifest.files).flatMap((file) => {
    const dest = file.installedPath ?? resolveRetailInstallPath(paths.userFontsDir, file.relativePath)
    if (!dest || !fs.existsSync(dest)) return []
    const parked = Boolean(file.parked)
    return [{ relativePath: file.relativePath, dest, parked }]
  })
  // Restart reconnect: skip fontkit when faces exist and dest bytes already match the catalog.
  await catalogRetailWrites(paths, written, { parse: 'if-unconfirmed' })
}

/**
 * Compare R2 against the last sync. Never called on the cold-start path — it is a deliberate user
 * action or a manual refresh, matching how the app-update check is wired.
 */
export async function checkRetail(
  paths: AppPaths,
  options: {
    refresh?: boolean
    credentialsOnly?: boolean
    fetchManifest?: typeof fetchRetailManifest
  } = {},
): Promise<RetailSyncStatus> {
  try {
    const { manifest } = await readManifest(paths, options)
    if (options.credentialsOnly) {
      cache.checkedAt = new Date().toISOString()
      cache.drift = []
      cache.skipped = []
      cache.error = null
      cache.fonts = null
      cache.collisions = []
      return emitRetail(paths)
    }
    ensureRetailListings(paths, manifest)
    await reconcileRetailCatalog(paths, loadRetailManifest(paths))
    const drift = measureDrift(paths, manifest)
    cache.checkedAt = new Date().toISOString()
    cache.drift = drift
    cache.skipped = manifest.skipped
    cache.error = null
    cache.fonts = cacheFontsFromSync(
      retailFontsFromCollections(manifest.collections, [], manifest.skipped),
    )
  } catch (error) {
    // Deliberately does NOT bump `checkedAt`: nothing was measured, and a fresh timestamp next to
    // stale drift would read as a successful check.
    cache.error = error instanceof Error ? error.message : 'Could not reach the Displaay worker.'
  }
  return emitRetail(paths)
}

export function optOutRetailFamilies(paths: AppPaths, familyNames: readonly string[]): RetailSyncStatus {
  const unique = [...new Set(familyNames.map((name) => name.trim()).filter(Boolean))]
  if (unique.length === 0) return emitRetail(paths)
  const settings = loadSettings(paths)
  const current = retailSettings(settings)
  const fonts = listRetailFonts(
    paths,
    current.disabledGlyphsFiles,
    current.familyFormats,
    optOutModeOf(current),
  )
  const disabled = new Set(current.disabledGlyphsFiles)
  if (!current.familyOptOuts) {
    for (const font of fonts) {
      if (isRetailFamilyOptedOut(font.familyName, font.typefaceName, disabled, 'typeface')) {
        disabled.add(font.familyName)
      }
    }
  }
  for (const name of unique) disabled.add(name)
  settings.retailSync = {
    ...current,
    disabledGlyphsFiles: normalizeDisabledGlyphsFiles([...disabled]),
    familyOptOuts: true,
  }
  saveSettings(paths, settings)
  emitEvent({ type: 'settings', settings })
  return emitRetail(paths)
}

export function listDropRetailCollisions(
  paths: AppPaths,
  incoming: ReadonlyArray<string | { familyName?: string; path?: string }>,
): RetailFamilyCollision[] {
  const catalog = loadCatalog(paths).entries
  return findRetailCollisionsForIncomingFamilies(
    catalog,
    incoming,
    retailOwnedInstallContext(paths, catalog),
  )
}

export async function resolveDropRetailCollisions(
  paths: AppPaths,
  choices: Record<string, RetailCollisionAction>,
  options: {
    planId?: string
    incoming?: ReadonlyArray<DropReplacementIncoming>
  } = {},
): Promise<RetailSyncStatus> {
  const incoming = collectDropReplacementIncoming(paths, options)
  const replaceIds: string[] = []
  const optOut: string[] = []
  const catalog = loadCatalog(paths).entries
  const owned = retailOwnedInstallContext(paths, catalog)
  const collisions = findRetailCollisionsForIncomingFamilies(
    catalog,
    Object.keys(choices),
    owned,
  )
  for (const collision of collisions) {
    const action = choices[collision.familyName]
    if (action !== 'replace') continue
    if (!familyHasValidDropReplacement(incoming, collision.familyName, owned)) continue
    optOut.push(collision.familyName)
    replaceIds.push(...collision.entryIds)
  }
  if (optOut.length) optOutRetailFamilies(paths, optOut)
  if (replaceIds.length) await uninstallCollisionEntries(paths, replaceIds)
  cache.collisions = []
  return emitRetail(paths)
}

function collectDropReplacementIncoming(
  paths: AppPaths,
  options: {
    planId?: string
    incoming?: ReadonlyArray<DropReplacementIncoming>
  },
): Array<{ familyName?: string; path?: string }> {
  const items: Array<{ familyName?: string; path?: string }> = []
  if (options.planId) {
    const plan = loadPlan(paths, options.planId)
    if (plan) {
      for (const item of plan.items) {
        if (item.path) items.push({ familyName: item.familyName, path: item.path })
      }
    }
  }
  for (const raw of options.incoming ?? []) {
    if (typeof raw === 'string' || !raw.path?.trim()) continue
    items.push({ familyName: raw.familyName, path: raw.path })
  }
  return items
}

export async function syncRetail(
  paths: AppPaths,
  options: {
    fetchManifest?: typeof fetchRetailManifest
    fetchFile?: typeof fetchRetailFile
    choices?: Record<string, RetailCollisionAction>
  } = {},
): Promise<RetailSyncStatus> {
  const hasChoices = Boolean(options.choices && Object.keys(options.choices).length > 0)
  if (inflightSync) {
    if (!hasChoices) return inflightSync
    await inflightSync
  }
  inflightSync = runSync(paths, options).finally(() => {
    inflightSync = null
  })
  return inflightSync
}

async function runSync(
  paths: AppPaths,
  options: {
    fetchManifest?: typeof fetchRetailManifest
    fetchFile?: typeof fetchRetailFile
    choices?: Record<string, RetailCollisionAction>
  },
): Promise<RetailSyncStatus> {
  try {
    const { manifest, token, workerBaseUrl } = await readManifest(paths, {
      refresh: true,
      fetchManifest: options.fetchManifest,
    })
    ensureRetailListings(paths, manifest)
    await reconcileRetailCatalog(paths, loadRetailManifest(paths))

    const choices = options.choices ?? {}
    const keepFamilies = Object.entries(choices)
      .filter(([, action]) => action === 'keep')
      .map(([familyName]) => familyName)
    if (keepFamilies.length) optOutRetailFamilies(paths, keepFamilies)

    const drift = measureDrift(paths, manifest)
    const config = retailSettings(loadSettings(paths))
    cache.fonts = cacheFontsFromSync(
      retailFontsFromCollections(manifest.collections, [], manifest.skipped, config.familyFormats),
    )
    const fonts = listRetailFonts(
      paths,
      config.disabledGlyphsFiles,
      config.familyFormats,
      optOutModeOf(config),
    )
    const download = options.fetchFile ?? fetchRetailFile
    const syncDrift = filterDisabledRetailDrift(drift, config.disabledGlyphsFiles, {
      disabledFamilyNames: config.disabledGlyphsFiles,
      familyFormats: config.familyFormats,
      selectedFormats: selectedFormatsFromFonts(fonts),
      optOutMode: optOutModeOf(config),
    })
    const pendingFamilies = retailFamiliesPendingSync(fonts, syncDrift)
    const replaceNames = new Set(
      Object.entries(choices)
        .filter(([, action]) => action === 'replace')
        .map(([familyName]) => familyName),
    )
    if (replaceNames.size) {
      const catalogForReplace = loadCatalog(paths).entries
      const currentCollisions = findOutsideCollisionsForRetailFamilies(
        catalogForReplace,
        pendingFamilies,
        retailOwnedInstallContext(paths, catalogForReplace),
      )
      const replaceIds: string[] = []
      for (const collision of currentCollisions) {
        if (replaceNames.has(collision.familyName)) replaceIds.push(...collision.entryIds)
      }
      if (replaceIds.length) await uninstallCollisionEntries(paths, replaceIds)
    }

    const remaining = findOutsideCollisionsForRetailFamilies(
      loadCatalog(paths).entries,
      pendingFamilies,
      retailOwnedInstallContext(paths),
    )
    cache.collisions = remaining
    if (remaining.length > 0) {
      cache.checkedAt = new Date().toISOString()
      cache.drift = drift
      cache.skipped = manifest.skipped
      cache.error = null
      return emitRetail(paths)
    }

    await uninstallUnselectedRetailFormats(paths, config)

    const result = await applyRetailSync({
      userFontsDir: paths.userFontsDir,
      stagingDir: path.join(paths.dataRoot, 'staging'),
      rollbackDir: path.join(paths.dataRoot, 'rollback'),
      drift: syncDrift,
      manifest: loadRetailManifest(paths),
      persist: async (next, written) => {
        saveRetailManifest(paths, next)
        if (written?.length) {
          await catalogRetailWrites(paths, written)
        }
      },
      destFor: (relativePath) => destForRelativePath(paths, relativePath),
      withLock: (task) => runCatalogTask(task),
      native: getFontNative(),
      download: (key, expectedSize) => download({ workerBaseUrl, token, key, expectedSize }),
    })

    // persist already cataloged each batch under the lock; replaying writtenDests would
    // overwrite an uninstall or deactivate that landed between persist and this point.

    cache.checkedAt = new Date().toISOString()
    cache.drift = measureDrift(paths, manifest)
    cache.skipped = manifest.skipped
    cache.error = result.errors.length ? result.errors.slice(0, 5).join(' ') : null
    cache.collisions = []
  } catch (error) {
    cache.error = error instanceof Error ? error.message : 'Could not sync the retail collection.'
  }
  return emitRetail(paths)
}

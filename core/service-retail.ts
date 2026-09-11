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
import { loadProjects } from './projects.ts'
import type { AppPaths } from './paths.ts'
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
import { newId, now } from './service-helpers.ts'
import { DEFAULT_RETAIL_WORKER_BASE_URL, defaultRetailSync, loadSettings, saveSettings } from './settings.ts'
import { applyEntryFacts } from './state.ts'
import type { AppSettings, CatalogEntry, FontFaceInfo, RetailSyncSettings } from './types.ts'
import {
  filterDisabledRetailDrift,
  normalizeAutoCheckMinutes,
  normalizeDisabledGlyphsFiles,
  retailFontsFromCollections,
} from '../shared/retail.ts'
import type {
  RetailDriftItem,
  RetailManifest,
  RetailSkip,
  RetailSyncFont,
  RetailSyncStatus,
} from '../shared/retail.ts'

/** In-memory only: the last check's result, so `status` is cheap and never touches the network. */
type RetailCache = {
  checkedAt: string | null
  drift: RetailDriftItem[]
  skipped: RetailSkip[]
  error: string | null
  /** `null` until a successful check this process; catalog listings cover a restart. */
  fonts: Array<{ glyphsFile: string; fileCount: number; available: boolean }> | null
}

const cache: RetailCache = { checkedAt: null, drift: [], skipped: [], error: null, fonts: null }

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
}

function applyFontEnabled(
  fonts: Array<{ glyphsFile: string; fileCount: number; available?: boolean }>,
  disabledGlyphsFiles: readonly string[],
): RetailSyncFont[] {
  const disabled = new Set(disabledGlyphsFiles)
  return fonts
    .slice()
    .sort((left, right) => left.glyphsFile.localeCompare(right.glyphsFile))
    .map((font) => ({
      glyphsFile: font.glyphsFile,
      fileCount: font.fileCount,
      enabled: !disabled.has(font.glyphsFile),
      available: font.available !== false,
    }))
}

function fontsFromCatalog(paths: AppPaths, disabledGlyphsFiles: readonly string[]): RetailSyncFont[] {
  const counts = new Map<string, number>()
  for (const entry of loadCatalog(paths).entries) {
    const relative = entry.retailRelativePath
    if (!relative) continue
    const slash = relative.indexOf('/')
    const glyphsFile = (slash === -1 ? relative : relative.slice(0, slash)).trim()
    if (!glyphsFile) continue
    counts.set(glyphsFile, (counts.get(glyphsFile) ?? 0) + 1)
  }
  return applyFontEnabled(
    [...counts.entries()].map(([glyphsFile, fileCount]) => ({ glyphsFile, fileCount })),
    disabledGlyphsFiles,
  )
}

function listRetailFonts(paths: AppPaths, disabledGlyphsFiles: readonly string[]): RetailSyncFont[] {
  if (cache.fonts) return applyFontEnabled(cache.fonts, disabledGlyphsFiles)
  return fontsFromCatalog(paths, disabledGlyphsFiles)
}

function visibleDrift(config: RetailSyncSettings): RetailDriftItem[] {
  return filterDisabledRetailDrift(cache.drift, config.disabledGlyphsFiles)
}

function retailSettings(settings: AppSettings): RetailSyncSettings {
  const current = settings.retailSync
  if (!current) return defaultRetailSync()
  return {
    ...defaultRetailSync(),
    ...current,
    disabledGlyphsFiles: current.disabledGlyphsFiles ?? [],
  }
}

export function retailStatus(paths: AppPaths, settings = loadSettings(paths)): RetailSyncStatus {
  const config = retailSettings(settings)
  const local = loadRetailManifest(paths)
  const drift = visibleDrift(config)
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
    fonts: listRetailFonts(paths, config.disabledGlyphsFiles),
    disabledGlyphsFiles: config.disabledGlyphsFiles,
  }
}

function emitRetail(paths: AppPaths): RetailSyncStatus {
  const status = retailStatus(paths)
  emitEvent({ type: 'retail', status })
  return status
}

export function configureRetailSync(
  paths: AppPaths,
  input: {
    enabled?: boolean
    workerBaseUrl?: string
    autoCheckMinutes?: number
    token?: string
    folderId?: string | null
    disabledGlyphsFiles?: string[]
  },
): RetailSyncStatus {
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
  return emitRetail(paths)
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

function stubRetailFace(glyphsFile: string, relativePath: string): FontFaceInfo {
  const base = path.basename(relativePath, path.extname(relativePath))
  const familyName = glyphsFile.trim() || base
  return {
    familyName,
    styleName: base.replace(new RegExp(`^${familyName}`, 'i'), '').replace(/^[-_ ]+/, '') || 'Regular',
    fullName: `${familyName} ${base}`.trim(),
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
    for (const file of collection.files ?? []) {
      if (!file?.relativePath || !resolveRetailInstallPath(paths.userFontsDir, file.relativePath)) {
        continue
      }
      if (findRetailEntry(catalog, file.relativePath)) continue
      const format = path.extname(file.relativePath).replace(/^\./, '').toLowerCase() || 'otf'
      const entry: CatalogEntry = {
        id: newId(),
        sourcePath: '',
        sourceMtimeMs: 0,
        sourceSize: 0,
        sourcePresent: false,
        retailRelativePath: file.relativePath,
        status: 'uninstalled',
        faces: [stubRetailFace(collection.glyphsFile, file.relativePath)],
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

function catalogRetailWrites(
  paths: AppPaths,
  written: Array<{ relativePath: string; dest: string; parked: boolean }>,
): void {
  if (written.length === 0) return
  for (const item of written) {
    const catalog = loadCatalog(paths)
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
    try {
      if (fs.existsSync(item.dest)) {
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
    const fingerprint = fs.existsSync(item.dest) ? tryFingerprintFile(item.dest) : undefined
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
    saveCatalog(paths, catalog)
  }
  emitEvent({ type: 'catalog', entries: loadCatalog(paths).entries })
}

function reconcileRetailCatalog(paths: AppPaths, manifest: ReturnType<typeof loadRetailManifest>): void {
  const written = Object.values(manifest.files).flatMap((file) => {
    const dest = file.installedPath ?? resolveRetailInstallPath(paths.userFontsDir, file.relativePath)
    if (!dest || !fs.existsSync(dest)) return []
    const parked = Boolean(file.parked)
    return [{ relativePath: file.relativePath, dest, parked }]
  })
  catalogRetailWrites(paths, written)
}

/**
 * Compare R2 against the last sync. Never called on the cold-start path — it is a deliberate user
 * action or a manual refresh, matching how the app-update check is wired.
 */
export async function checkRetail(
  paths: AppPaths,
  options: { refresh?: boolean; fetchManifest?: typeof fetchRetailManifest } = {},
): Promise<RetailSyncStatus> {
  try {
    const { manifest } = await readManifest(paths, options)
    ensureRetailListings(paths, manifest)
    reconcileRetailCatalog(paths, loadRetailManifest(paths))
    const drift = measureDrift(paths, manifest)
    cache.checkedAt = new Date().toISOString()
    cache.drift = drift
    cache.skipped = manifest.skipped
    cache.error = null
    cache.fonts = retailFontsFromCollections(manifest.collections, [], manifest.skipped).map((font) => ({
      glyphsFile: font.glyphsFile,
      fileCount: font.fileCount,
      available: font.available,
    }))
  } catch (error) {
    // Deliberately does NOT bump `checkedAt`: nothing was measured, and a fresh timestamp next to
    // stale drift would read as a successful check.
    cache.error = error instanceof Error ? error.message : 'Could not reach the Displaay worker.'
  }
  return emitRetail(paths)
}

export async function syncRetail(
  paths: AppPaths,
  options: {
    fetchManifest?: typeof fetchRetailManifest
    fetchFile?: typeof fetchRetailFile
  } = {},
): Promise<RetailSyncStatus> {
  // A second request joins the run already in progress rather than starting a competing one.
  if (inflightSync) return inflightSync
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
  },
): Promise<RetailSyncStatus> {
  try {
    const { manifest, token, workerBaseUrl } = await readManifest(paths, {
      refresh: true,
      fetchManifest: options.fetchManifest,
    })
    ensureRetailListings(paths, manifest)
    reconcileRetailCatalog(paths, loadRetailManifest(paths))

    const drift = measureDrift(paths, manifest)
    cache.fonts = retailFontsFromCollections(manifest.collections, [], manifest.skipped).map((font) => ({
      glyphsFile: font.glyphsFile,
      fileCount: font.fileCount,
      available: font.available,
    }))
    const download = options.fetchFile ?? fetchRetailFile
    const syncDrift = filterDisabledRetailDrift(
      drift,
      retailSettings(loadSettings(paths)).disabledGlyphsFiles,
    )

    const result = await applyRetailSync({
      userFontsDir: paths.userFontsDir,
      stagingDir: path.join(paths.dataRoot, 'staging'),
      rollbackDir: path.join(paths.dataRoot, 'rollback'),
      drift: syncDrift,
      manifest: loadRetailManifest(paths),
      persist: async (next, written) => {
        saveRetailManifest(paths, next)
        if (written?.length) {
          await runCatalogTask(() => catalogRetailWrites(paths, written))
        }
      },
      destFor: (relativePath) => destForRelativePath(paths, relativePath),
      withLock: (task) => runCatalogTask(task),
      native: getFontNative(),
      download: (key, expectedSize) => download({ workerBaseUrl, token, key, expectedSize }),
    })

    catalogRetailWrites(paths, result.writtenDests)

    cache.checkedAt = new Date().toISOString()
    cache.drift = measureDrift(paths, manifest)
    cache.skipped = manifest.skipped
    cache.error = result.errors.length ? result.errors.slice(0, 5).join(' ') : null
  } catch (error) {
    cache.error = error instanceof Error ? error.message : 'Could not sync the retail collection.'
  }
  return emitRetail(paths)
}

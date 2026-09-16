import { SYSTEM_FONT_CACHE_VERSION } from './constants.ts'
import fs from 'node:fs'
import path from 'node:path'
import { loadCatalog } from './catalog.ts'
import { emitEvent } from './events.ts'
import { yieldEventLoop } from './event-loop.ts'
import { isFontFile, parseFontFile, readFileStat } from './parse.ts'
import { isFullyUnderAnyRoot, isUnderAnyRoot } from './containment.ts'
import { type AppPaths, isMac } from './paths.ts'
import type { CatalogFile, SystemFace } from './types.ts'

/** Parse every uncached file inline when the tree is this small (unit tests). */
const SMALL_TREE_FILE_LIMIT = 8
/** Cold large-tree budget: keep the first scan off the event loop. */
const SYNC_UNCACHE_BUDGET = 2

/** Apple hides UI/PUA system faces whose family name begins with a period. */
export function isHiddenSystemFamily(name: string): boolean {
  return name.startsWith('.')
}

function walkFonts(root: string, acc: string[], depth = 0, seen = new Set<string>()): void {
  if (depth > 12 || acc.length > 20_000) return
  if (!fs.existsSync(root)) {
    return
  }
  let real: string
  try {
    real = fs.realpathSync(root)
  } catch {
    return
  }
  if (seen.has(real)) return
  seen.add(real)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isSymbolicLink()) continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      walkFonts(full, acc, depth + 1, seen)
      continue
    }
    if (entry.isFile() && isFontFile(full)) {
      acc.push(full)
    }
  }
}

function isProtectedPath(filePath: string, paths: AppPaths): boolean {
  const roots = [paths.systemFontsDir]
  if (!isMac()) {
    roots.push('/usr/share/fonts')
  }
  return isUnderAnyRoot(filePath, roots)
}

function isWritable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

type CacheFile = {
  version?: number
  faces: SystemFace[]
  stamps: Record<string, number>
}

type PreparedScan = {
  files: string[]
  cache: CacheFile
  catalog: CatalogFile
  byInstall: Map<string, string>
  bySource: Map<string, string>
  cachedByPath: Map<string, SystemFace[]>
}

type UncachedFile = { filePath: string; mtime: number }

const ensureScanByRoot = new Map<string, Promise<SystemFace[]>>()

function loadSystemCache(paths: AppPaths): CacheFile {
  if (!fs.existsSync(paths.systemCachePath)) {
    return { faces: [], stamps: {} }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.systemCachePath, 'utf8')) as CacheFile
    if (parsed.version === SYSTEM_FONT_CACHE_VERSION) {
      return parsed
    }
  } catch {
    // Rebuild from disk.
  }
  return { faces: [], stamps: {} }
}

function prepareScan(paths: AppPaths): PreparedScan {
  const roots = [paths.computerFontsDir, paths.systemFontsDir]
  const files: string[] = []
  for (const root of [...new Set(roots)]) {
    walkFonts(root, files)
  }

  const cache = loadSystemCache(paths)
  const catalog = loadCatalog(paths)
  const byInstall = new Map(
    catalog.entries
      .filter((entry) => entry.installedPath)
      .map((entry) => [path.resolve(entry.installedPath!), entry.id]),
  )
  const bySource = new Map(
    catalog.entries.map((entry) => [path.resolve(entry.sourcePath), entry.id]),
  )
  const cachedByPath = new Map<string, SystemFace[]>()
  for (const face of cache.faces) {
    const list = cachedByPath.get(face.path)
    if (list) list.push(face)
    else cachedByPath.set(face.path, [face])
  }
  return { files, cache, catalog, byInstall, bySource, cachedByPath }
}

function cachedFacesFor(
  filePath: string,
  mtime: number,
  prepared: PreparedScan,
  paths: AppPaths,
): SystemFace[] | undefined {
  const cached = prepared.cachedByPath.get(filePath) ?? []
  if (prepared.cache.stamps[filePath] !== mtime || cached.length === 0) {
    return undefined
  }
  return cached
    .filter((face) => !isHiddenSystemFamily(face.familyName))
    .map((face) => ({
      ...face,
      managedId: prepared.byInstall.get(path.resolve(filePath)) ?? prepared.bySource.get(path.resolve(filePath)),
      protected: isProtectedPath(filePath, paths),
      writable: isWritable(filePath) && !isProtectedPath(filePath, paths),
    }))
}

function parseUncachedFile(
  filePath: string,
  paths: AppPaths,
  byInstall: Map<string, string>,
  bySource: Map<string, string>,
): SystemFace[] {
  const faces: SystemFace[] = []
  try {
    const parsed = parseFontFile(filePath)
    for (const face of parsed.faces) {
      if (isHiddenSystemFamily(face.familyName)) continue
      faces.push({
        path: filePath,
        familyName: face.familyName,
        styleName: face.styleName,
        fullName: face.fullName,
        postscriptName: face.postscriptName,
        isVariable: face.isVariable,
        instanceCount: face.instanceCount,
        instanceNames: face.instanceNames,
        weight: face.weight,
        italic: face.italic,
        format: parsed.format,
        previewSample: parsed.previewSample,
        protected: isProtectedPath(filePath, paths),
        writable: isWritable(filePath) && !isProtectedPath(filePath, paths),
        managedId: byInstall.get(path.resolve(filePath)) ?? bySource.get(path.resolve(filePath)),
      })
    }
  } catch {
    // Skip unreadable or corrupt fonts.
  }
  return faces
}

function deactivatedFaces(
  catalog: CatalogFile,
  computerFontsDir: string,
  seenPaths: Set<string>,
): SystemFace[] {
  const nextFaces: SystemFace[] = []
  for (const entry of catalog.entries) {
    if (entry.status !== 'deactivated' || !entry.disabledPath || !fs.existsSync(entry.disabledPath)) {
      continue
    }
    if (!isUnderAnyRoot(entry.sourcePath, [computerFontsDir])) {
      continue
    }
    if (seenPaths.has(path.resolve(entry.disabledPath))) continue
    seenPaths.add(path.resolve(entry.disabledPath))
    for (const face of entry.faces) {
      if (isHiddenSystemFamily(face.familyName)) continue
      nextFaces.push({
        path: entry.disabledPath,
        familyName: face.familyName,
        styleName: face.styleName,
        fullName: face.fullName,
        postscriptName: face.postscriptName,
        isVariable: face.isVariable,
        instanceCount: face.instanceCount,
        instanceNames: face.instanceNames,
        weight: face.weight,
        italic: face.italic,
        format: entry.format,
        previewSample: entry.previewSample,
        protected: false,
        writable: true,
        managedId: entry.id,
        deactivated: true,
      })
    }
  }
  return nextFaces
}

function persistSystemCache(paths: AppPaths, faces: SystemFace[], stamps: Record<string, number>): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  fs.writeFileSync(
    paths.systemCachePath,
    JSON.stringify({ version: SYSTEM_FONT_CACHE_VERSION, faces, stamps }),
  )
}

function collectWalkedFiles(
  paths: AppPaths,
  prepared: PreparedScan,
): { hits: SystemFace[]; stamps: Record<string, number>; seenPaths: Set<string>; uncached: UncachedFile[] } {
  const hits: SystemFace[] = []
  const stamps: Record<string, number> = {}
  const seenPaths = new Set<string>()
  const uncached: UncachedFile[] = []
  for (const filePath of prepared.files) {
    let mtime = 0
    try {
      mtime = readFileStat(filePath).mtimeMs
    } catch {
      continue
    }
    seenPaths.add(path.resolve(filePath))
    const cached = cachedFacesFor(filePath, mtime, prepared, paths)
    if (cached) {
      stamps[filePath] = mtime
      hits.push(...cached)
      continue
    }
    uncached.push({ filePath, mtime })
  }
  return { hits, stamps, seenPaths, uncached }
}

export function scanSystemFonts(paths: AppPaths): SystemFace[] {
  const prepared = prepareScan(paths)
  const { hits, stamps, seenPaths, uncached } = collectWalkedFiles(paths, prepared)
  const inlineLimit =
    prepared.files.length <= SMALL_TREE_FILE_LIMIT ? uncached.length : SYNC_UNCACHE_BUDGET
  const nextFaces = [...hits]
  for (const item of uncached.slice(0, inlineLimit)) {
    stamps[item.filePath] = item.mtime
    nextFaces.push(
      ...parseUncachedFile(item.filePath, paths, prepared.byInstall, prepared.bySource),
    )
  }
  nextFaces.push(...deactivatedFaces(prepared.catalog, paths.computerFontsDir, seenPaths))
  if (!ensureScanByRoot.has(paths.dataRoot)) {
    persistSystemCache(paths, nextFaces, stamps)
  }
  if (uncached.length > inlineLimit) {
    void ensureSystemFontScan(paths).catch(() => {})
  }
  return nextFaces
}

async function completeSystemFontScan(paths: AppPaths): Promise<SystemFace[]> {
  const prepared = prepareScan(paths)
  const { hits, stamps, seenPaths, uncached } = collectWalkedFiles(paths, prepared)
  const nextFaces = [...hits]
  for (const item of uncached) {
    await yieldEventLoop()
    stamps[item.filePath] = item.mtime
    nextFaces.push(
      ...parseUncachedFile(item.filePath, paths, prepared.byInstall, prepared.bySource),
    )
  }
  nextFaces.push(...deactivatedFaces(prepared.catalog, paths.computerFontsDir, seenPaths))
  persistSystemCache(paths, nextFaces, stamps)
  emitEvent({ type: 'system', faces: nextFaces })
  return nextFaces
}

/** Finish remaining uncached system-font parses, yielding between files. */
export function ensureSystemFontScan(paths: AppPaths): Promise<SystemFace[]> {
  const key = paths.dataRoot
  const existing = ensureScanByRoot.get(key)
  if (existing) return existing
  const job = completeSystemFontScan(paths).finally(() => {
    if (ensureScanByRoot.get(key) === job) ensureScanByRoot.delete(key)
  })
  ensureScanByRoot.set(key, job)
  return job
}

export function allowedFontPath(filePath: string, paths: AppPaths): boolean {
  return isFullyUnderAnyRoot(filePath, [
    paths.installDir,
    paths.disabledDir,
    paths.sourcesDir,
    paths.uploadsDir,
    paths.userFontsDir,
    paths.computerFontsDir,
    paths.systemFontsDir,
    paths.seedDir,
  ])
}

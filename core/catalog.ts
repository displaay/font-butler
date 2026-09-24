import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeFormat } from './formats.ts'
import type { AppPaths } from './paths.ts'
import { applyEntryFacts } from './state.ts'
import type { CatalogEntry, CatalogFile, FontFaceInfo, FontStatus } from './types.ts'

function resolvedPath(value: string | undefined): string | undefined {
  if (!value) return undefined
  return path.resolve(value)
}

/** True when sourcePath is a separate file from the installed/disabled copy. */
export function isExternalSource(entry: CatalogEntry): boolean {
  const source = resolvedPath(entry.sourcePath)
  if (!source) return false
  if (source === resolvedPath(entry.installedPath) || source === resolvedPath(entry.disabledPath)) {
    return false
  }
  if (entry.installations?.some((copy) =>
    source === resolvedPath(copy.path) || source === resolvedPath(copy.parkedPath),
  )) {
    return false
  }
  return true
}

const emptyCatalog = (): CatalogFile => ({ version: 1, entries: [] })

export class CatalogCorruptError extends Error {
  readonly catalogPath: string

  constructor(catalogPath: string, reason: string) {
    super(`The font catalog is unreadable (${reason}). The existing file was left unchanged.`)
    this.name = 'CatalogCorruptError'
    this.catalogPath = catalogPath
  }
}

function catalogBackupPath(catalogPath: string): string {
  return path.join(path.dirname(catalogPath), 'catalog.json.bak')
}

function hydrateCatalog(catalog: CatalogFile): CatalogFile {
  for (const entry of catalog.entries) {
    if (typeof entry.sourcePresent !== 'boolean') {
      entry.sourcePresent = entry.status !== 'source-missing'
    }
    if (!entry.sourceAvailability) {
      applyEntryFacts(entry)
    }
  }
  return catalog
}

function writeCatalogBackup(catalogPath: string): void {
  const backupPath = catalogBackupPath(catalogPath)
  const tmp = `${backupPath}.${process.pid}.${process.hrtime.bigint()}.tmp`
  try {
    fs.copyFileSync(catalogPath, tmp)
    fs.renameSync(tmp, backupPath)
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // Best effort; the next save retries the backup.
    }
    throw error
  }
}

function readCatalogFile(catalogPath: string): CatalogFile {
  let raw: string
  try {
    raw = fs.readFileSync(catalogPath, 'utf8')
  } catch (error) {
    throw new CatalogCorruptError(
      catalogPath,
      error instanceof Error ? error.message : 'unreadable',
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CatalogCorruptError(catalogPath, 'invalid JSON')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new CatalogCorruptError(catalogPath, 'not an object')
  }
  const catalog = parsed as CatalogFile
  if (catalog.version !== 1 || !Array.isArray(catalog.entries)) {
    throw new CatalogCorruptError(catalogPath, 'unsupported or incomplete catalog')
  }
  return catalog
}

let catalogQueue: Promise<void> = Promise.resolve()
const catalogLock = new AsyncLocalStorage<boolean>()
let catalogGeneration = 0

export function currentCatalogGeneration(): number {
  return catalogGeneration
}

export function runCatalogTask<T>(task: () => Promise<T> | T): Promise<T> {
  if (catalogLock.getStore()) {
    return Promise.resolve().then(() => task())
  }
  const run = async () => catalogLock.run(true, () => task())
  const result = catalogQueue.then(run, run)
  catalogQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export function loadCatalog(paths: AppPaths): CatalogFile {
  if (!fs.existsSync(paths.catalogPath)) {
    return emptyCatalog()
  }
  try {
    return hydrateCatalog(readCatalogFile(paths.catalogPath))
  } catch (error) {
    const backupPath = catalogBackupPath(paths.catalogPath)
    if (!fs.existsSync(backupPath)) throw error
    try {
      return hydrateCatalog(readCatalogFile(backupPath))
    } catch {
      throw error
    }
  }
}

export function saveCatalog(paths: AppPaths, catalog: CatalogFile): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  if (fs.existsSync(paths.catalogPath)) {
    try {
      readCatalogFile(paths.catalogPath)
    } catch {
      // Existing file is missing or unreadable: replace it.
    }
  }
  const tmp = `${paths.catalogPath}.${process.pid}.${process.hrtime.bigint()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2))
  fs.renameSync(tmp, paths.catalogPath)
  catalogGeneration += 1
  try {
    writeCatalogBackup(paths.catalogPath)
  } catch {
    // The primary rename already committed. A backup failure must not fail the
    // save or trigger mutation-journal rollback against a catalog that landed.
  }
}

export function upsertEntry(catalog: CatalogFile, entry: CatalogEntry): void {
  const index = catalog.entries.findIndex((item) => item.id === entry.id)
  if (index === -1) {
    catalog.entries.unshift(entry)
    return
  }
  catalog.entries[index] = entry
}

export function findBySourcePath(
  catalog: CatalogFile,
  sourcePath: string,
): CatalogEntry | undefined {
  const resolved = path.resolve(sourcePath)
  return catalog.entries.find((entry) => resolvedPath(entry.sourcePath) === resolved)
}

export type PathOccupancyIndex = {
  occupantsAt(resolved: string): CatalogEntry[]
  findByInstalledPath(resolved: string): CatalogEntry | undefined
  findBySourcePath(resolved: string): CatalogEntry | undefined
}

function pushOccupant(
  map: Map<string, CatalogEntry[]>,
  filePath: string | undefined,
  entry: CatalogEntry,
): void {
  if (!filePath || !fs.existsSync(filePath)) return
  const resolved = path.resolve(filePath)
  const list = map.get(resolved)
  if (list) {
    if (!list.includes(entry)) list.push(entry)
  } else {
    map.set(resolved, [entry])
  }
}

/** One pass over catalog entries for adoption and path lookups (O(entries), not O(files × entries)). */
export function buildPathOccupancyIndex(entries: CatalogEntry[]): PathOccupancyIndex {
  const occupants = new Map<string, CatalogEntry[]>()
  const byInstalled = new Map<string, CatalogEntry>()
  const bySource = new Map<string, CatalogEntry>()
  for (const entry of entries) {
    pushOccupant(occupants, entry.installedPath, entry)
    pushOccupant(occupants, entry.disabledPath, entry)
    for (const copy of entry.installations ?? []) {
      pushOccupant(occupants, copy.path, entry)
      pushOccupant(occupants, copy.parkedPath, entry)
    }
    bySource.set(path.resolve(entry.sourcePath), entry)
    if (entry.installedPath && fs.existsSync(entry.installedPath)) {
      byInstalled.set(path.resolve(entry.installedPath), entry)
    }
    if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
      byInstalled.set(path.resolve(entry.disabledPath), entry)
    }
  }
  return {
    occupantsAt(resolved) {
      return occupants.get(resolved) ?? []
    },
    findByInstalledPath(resolved) {
      return byInstalled.get(resolved)
    },
    findBySourcePath(resolved) {
      return bySource.get(resolved)
    },
  }
}

export function occupantsAtPath(catalog: CatalogFile | CatalogEntry[], filePath: string): CatalogEntry[] {
  const resolved = path.resolve(filePath)
  const entries = Array.isArray(catalog) ? catalog : catalog.entries
  return entries.filter((entry) => {
    if (
      entry.installedPath &&
      resolvedPath(entry.installedPath) === resolved &&
      fs.existsSync(entry.installedPath)
    ) return true
    if (
      entry.disabledPath &&
      resolvedPath(entry.disabledPath) === resolved &&
      fs.existsSync(entry.disabledPath)
    ) return true
    if (
      entry.installations?.some((copy) =>
        ((copy.path && resolvedPath(copy.path) === resolved && fs.existsSync(copy.path)) ||
          (copy.parkedPath && resolvedPath(copy.parkedPath) === resolved && fs.existsSync(copy.parkedPath))),
      )
    ) return true
    return false
  })
}

export function findByInstalledPath(
  catalog: CatalogFile,
  filePath: string,
): CatalogEntry | undefined {
  const resolved = path.resolve(filePath)
  return catalog.entries.find(
    (entry) =>
      resolvedPath(entry.installedPath) === resolved || resolvedPath(entry.disabledPath) === resolved,
  )
}

export function faceIdentityKey(faces: FontFaceInfo[], format?: string): string | null {
  const names = faces.map((face) => face.postscriptName.trim()).filter(Boolean)
  if (names.length === 0 || names.length !== faces.length) {
    return null
  }
  const faceKey = names.slice().sort().join('\0')
  if (format === undefined) {
    return faceKey
  }
  return `${normalizeFormat(format)}\0${faceKey}`
}

export function findByFaceIdentity(
  catalog: CatalogFile,
  faces: FontFaceInfo[],
  format?: string,
): CatalogEntry | undefined {
  return findAllByFaceIdentity(catalog, faces, format)[0]
}

export function findAllByFaceIdentity(
  catalog: CatalogFile,
  faces: FontFaceInfo[],
  format?: string,
): CatalogEntry[] {
  const key = faceIdentityKey(faces, format)
  if (!key) {
    return []
  }
  return catalog.entries.filter((entry) => {
    const entryFormat = format === undefined ? undefined : entry.format || path.extname(entry.sourcePath)
    return faceIdentityKey(entry.faces, entryFormat) === key
  })
}

export function sourceFileExists(sourcePath: string): boolean {
  try {
    return fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()
  } catch {
    return false
  }
}

export function findById(
  catalog: CatalogFile,
  id: string,
): CatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.id === id)
}

export function findByIds(catalog: CatalogFile, ids: string[]): CatalogEntry[] {
  const set = new Set(ids)
  return catalog.entries.filter((entry) => set.has(entry.id))
}

export function removeEntryById(catalog: CatalogFile, id: string): CatalogEntry | undefined {
  const index = catalog.entries.findIndex((entry) => entry.id === id)
  if (index === -1) {
    return undefined
  }
  const [removed] = catalog.entries.splice(index, 1)
  return removed
}

function statusForPresentCopy(entry: CatalogEntry): FontStatus | null {
  if (entry.installedPath && fs.existsSync(entry.installedPath)) {
    return entry.status === 'deactivated' ? 'deactivated' : 'installed'
  }
  if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
    return 'deactivated'
  }
  if (entry.installations?.some((copy) => copy.parkedPath && fs.existsSync(copy.parkedPath))) {
    return 'deactivated'
  }
  return null
}

export function resolveStatusWhenSourceFound(entry: CatalogEntry): FontStatus {
  return statusForPresentCopy(entry) ?? 'uninstalled'
}

export function resolveStatusWhenSourceMissing(entry: CatalogEntry): FontStatus {
  return statusForPresentCopy(entry) ?? 'source-missing'
}

export function applySourcePresence(entry: CatalogEntry): boolean {
  return applyEntryFacts(entry)
}

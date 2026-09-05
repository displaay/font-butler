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
  return source !== resolvedPath(entry.installedPath) && source !== resolvedPath(entry.disabledPath)
}

const emptyCatalog = (): CatalogFile => ({ version: 1, entries: [] })

let catalogQueue: Promise<void> = Promise.resolve()
const catalogLock = new AsyncLocalStorage<boolean>()

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
    const raw = fs.readFileSync(paths.catalogPath, 'utf8')
    const parsed = JSON.parse(raw) as CatalogFile
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return emptyCatalog()
    }
    for (const entry of parsed.entries) {
      if (typeof entry.sourcePresent !== 'boolean') {
        entry.sourcePresent = entry.status !== 'source-missing'
      }
      if (!entry.sourceAvailability) {
        applyEntryFacts(entry)
      }
    }
    return parsed
  } catch {
    return emptyCatalog()
  }
}

export function saveCatalog(paths: AppPaths, catalog: CatalogFile): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  const tmp = `${paths.catalogPath}.${process.pid}.${process.hrtime.bigint()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2))
  fs.renameSync(tmp, paths.catalogPath)
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
  const key = faceIdentityKey(faces, format)
  if (!key) {
    return undefined
  }
  return catalog.entries.find((entry) => {
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

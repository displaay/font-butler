import fs from 'node:fs'
import type { AppPaths } from './paths.ts'
import type { CatalogEntry, CatalogFile, FontStatus } from './types.ts'

const emptyCatalog = (): CatalogFile => ({ version: 1, entries: [] })

let catalogQueue: Promise<void> = Promise.resolve()

export function runCatalogTask<T>(task: () => Promise<T> | T): Promise<T> {
  const run = async () => task()
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
    return parsed
  } catch {
    return emptyCatalog()
  }
}

export function saveCatalog(paths: AppPaths, catalog: CatalogFile): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  const tmp = `${paths.catalogPath}.tmp`
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
  return catalog.entries.find((entry) => entry.sourcePath === sourcePath)
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

export function resolveStatusWhenSourceFound(entry: CatalogEntry): FontStatus {
  if (entry.installedPath && fs.existsSync(entry.installedPath)) {
    return 'installed'
  }
  if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
    return 'deactivated'
  }
  return 'uninstalled'
}

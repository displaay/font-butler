import fs from 'node:fs'
import type { AppPaths } from './paths.ts'
import type { CatalogEntry, CatalogFile } from './types.ts'

const emptyCatalog = (): CatalogFile => ({ version: 1, entries: [] })

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

import fs from 'node:fs'
import type { AppPaths } from './paths.ts'
import type { CatalogEntry, CatalogFile, FontFaceInfo, FontStatus } from './types.ts'

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
    for (const entry of parsed.entries) {
      if (typeof entry.sourcePresent !== 'boolean') {
        entry.sourcePresent = entry.status !== 'source-missing'
      }
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

export function faceIdentityKey(faces: FontFaceInfo[]): string | null {
  const names = faces.map((face) => face.postscriptName.trim()).filter(Boolean)
  if (names.length === 0 || names.length !== faces.length) {
    return null
  }
  return names.slice().sort().join('\0')
}

export function findByFaceIdentity(
  catalog: CatalogFile,
  faces: FontFaceInfo[],
): CatalogEntry | undefined {
  const key = faceIdentityKey(faces)
  if (!key) {
    return undefined
  }
  return catalog.entries.find((entry) => faceIdentityKey(entry.faces) === key)
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

export function resolveStatusWhenSourceFound(entry: CatalogEntry): FontStatus {
  if (entry.installedPath && fs.existsSync(entry.installedPath)) {
    return 'installed'
  }
  if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
    return 'deactivated'
  }
  return 'uninstalled'
}

export function resolveStatusWhenSourceMissing(entry: CatalogEntry): FontStatus {
  if (entry.installedPath && fs.existsSync(entry.installedPath)) {
    return 'installed'
  }
  if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
    return 'deactivated'
  }
  return 'source-missing'
}

export function applySourcePresence(entry: CatalogEntry): boolean {
  const present = sourceFileExists(entry.sourcePath)
  let changed = entry.sourcePresent !== present
  entry.sourcePresent = present
  if (!present) {
    const next = resolveStatusWhenSourceMissing(entry)
    if (entry.status !== next) {
      entry.status = next
      changed = true
    }
    return changed
  }
  if (entry.status === 'source-missing') {
    entry.status = resolveStatusWhenSourceFound(entry)
    changed = true
  }
  return changed
}

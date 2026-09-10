import { entryHasTrackedSource } from './group'
import type { CatalogEntry } from './types'

/** Sidebar / saved-filter sentinel for the virtual Displaay retail collection. */
export const RETAIL_LIBRARY_FILTER = '__retail__'

export const RETAIL_LIBRARY_LABEL = 'Displaay retail'

export function isRetailLibraryFilter(folder: string | null | undefined): boolean {
  return folder === RETAIL_LIBRARY_FILTER
}

export function isRetailLibraryEntry(entry: CatalogEntry): boolean {
  return Boolean(entry.retailRelativePath)
}

export function normalizeWatchPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function isPathUnderFolder(filePath: string, folder: string): boolean {
  const file = normalizeWatchPath(filePath)
  const root = normalizeWatchPath(folder)
  if (!file || !root) return false
  return file === root || file.startsWith(`${root}/`)
}

/** Watch-folder views list current sources only; missing sources stay on Fonts. */
export function isWatchFolderEntry(entry: CatalogEntry, folder: string): boolean {
  return entryHasTrackedSource(entry) && isPathUnderFolder(entry.sourcePath, folder)
}

export function watchFolderName(folder: string): string {
  const parts = normalizeWatchPath(folder).split('/').filter(Boolean)
  return parts[parts.length - 1] ?? folder
}

export function watchFolderLabel(folder: string, all: string[]): string {
  const name = watchFolderName(folder)
  const clash = all.some((other) => other !== folder && watchFolderName(other) === name)
  if (!clash) return name
  const parts = normalizeWatchPath(folder).split('/').filter(Boolean)
  if (parts.length >= 2) return parts.slice(-2).join('/')
  return folder
}

export function matchesLibraryFolderFilter(entry: CatalogEntry, filter: string): boolean {
  if (isRetailLibraryFilter(filter)) return isRetailLibraryEntry(entry)
  return isWatchFolderEntry(entry, filter)
}

export function libraryFolderFilterLabel(filter: string, all: string[]): string {
  if (isRetailLibraryFilter(filter)) return RETAIL_LIBRARY_LABEL
  return watchFolderLabel(filter, all)
}

export function mergeWatchFolders(current: string[], added: string[]): string[] {
  const seen = new Set(current.map(normalizeWatchPath))
  const next = [...current]
  for (const folder of added) {
    const key = normalizeWatchPath(folder)
    if (!key || seen.has(key)) continue
    seen.add(key)
    next.push(folder)
  }
  return next
}

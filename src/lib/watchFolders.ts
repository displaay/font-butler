import { entryHasTrackedSource } from './group'
import type { CatalogEntry } from './types'

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

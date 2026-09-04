import path from 'node:path'
import type { CatalogEntry } from './types.ts'

export function normalizeFormat(format: string): string {
  return format.trim().toLowerCase().replace(/^\./, '')
}

export function isWebFontFormat(format: string): boolean {
  const value = normalizeFormat(format)
  return value === 'woff' || value === 'woff2'
}

export function isWebFontFile(filePath: string): boolean {
  return isWebFontFormat(path.extname(filePath))
}

export function entryFormat(entry: Pick<CatalogEntry, 'format' | 'sourcePath'>): string {
  return normalizeFormat(entry.format) || normalizeFormat(path.extname(entry.sourcePath))
}

export function uniqueFormats(entries: Array<Pick<CatalogEntry, 'format' | 'sourcePath'>>): string[] {
  return [...new Set(entries.map(entryFormat).filter(Boolean))]
}

export function assertNotWebFont(filePath: string): void {
  if (isWebFontFile(filePath)) {
    throw new Error('WOFF files cannot be installed.')
  }
}

export function assertSingleInstallableFormat(
  entries: Array<Pick<CatalogEntry, 'format' | 'sourcePath'>>,
): void {
  for (const entry of entries) {
    if (isWebFontFormat(entryFormat(entry)) || isWebFontFile(entry.sourcePath)) {
      throw new Error('WOFF files cannot be installed.')
    }
  }
  if (uniqueFormats(entries).length > 1) {
    throw new Error('Install one font format at a time.')
  }
}

function familyNameOf(entry: Pick<CatalogEntry, 'customFamilyName' | 'faces'>): string {
  return entry.customFamilyName || entry.faces[0]?.familyName || 'Unknown'
}

function isActiveStatus(status: CatalogEntry['status']): boolean {
  return status === 'installed' || status === 'outdated' || status === 'deactivated'
}

export function installedFormatConflict(
  entry: CatalogEntry,
  catalog: CatalogEntry[],
): CatalogEntry | undefined {
  const format = entryFormat(entry)
  const family = familyNameOf(entry)
  return catalog.find((other) => {
    if (other.id === entry.id || !isActiveStatus(other.status)) return false
    if (familyNameOf(other) !== family) return false
    return entryFormat(other) !== format
  })
}

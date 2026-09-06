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

export const INSTALLABLE_FORMATS = ['otf', 'ttf', 'ttc', 'otc'] as const

export function countInstallableFormats(filePaths: string[]): Array<{ format: string; count: number }> {
  const counts = new Map<string, number>()
  for (const filePath of filePaths) {
    const format = normalizeFormat(path.extname(filePath))
    if (!format || isWebFontFormat(format)) continue
    if (!(INSTALLABLE_FORMATS as readonly string[]).includes(format)) continue
    counts.set(format, (counts.get(format) ?? 0) + 1)
  }
  return INSTALLABLE_FORMATS.filter((format) => counts.has(format)).map((format) => ({
    format,
    count: counts.get(format) ?? 0,
  }))
}

export const WOFF_INSTALL_ERROR = 'WOFF files cannot be installed.'

export function assertNotWebFont(filePath: string): void {
  if (isWebFontFile(filePath)) {
    throw new Error(WOFF_INSTALL_ERROR)
  }
}

export function assertSingleInstallableFormat(
  entries: Array<Pick<CatalogEntry, 'format' | 'sourcePath'>>,
): void {
  for (const entry of entries) {
    if (isWebFontFormat(entryFormat(entry)) || isWebFontFile(entry.sourcePath)) {
      throw new Error(WOFF_INSTALL_ERROR)
    }
  }
  if (uniqueFormats(entries).length > 1) {
    throw new Error('Install one font format at a time.')
  }
}

function occupiesForFormatConflict(status: CatalogEntry['status']): boolean {
  return status === 'installed' || status === 'outdated'
}

function instanceKey(familyName: string, styleName: string): string {
  return `${familyName.trim().toLowerCase()}::${styleName.trim().toLowerCase()}`
}

export function instancesOverlap(
  left: Pick<CatalogEntry, 'faces'>,
  right: Pick<CatalogEntry, 'faces'>,
): boolean {
  const styles = new Set<string>()
  const posts = new Set<string>()
  for (const face of left.faces) {
    styles.add(instanceKey(face.familyName, face.styleName))
    const postscript = face.postscriptName.trim().toLowerCase()
    if (postscript) posts.add(postscript)
  }
  return right.faces.some((face) => {
    if (styles.has(instanceKey(face.familyName, face.styleName))) return true
    const postscript = face.postscriptName.trim().toLowerCase()
    return Boolean(postscript && posts.has(postscript))
  })
}

export function installedFormatConflicts(entry: CatalogEntry, catalog: CatalogEntry[]): CatalogEntry[] {
  const format = entryFormat(entry)
  return catalog.filter((other) => {
    if (other.id === entry.id || !occupiesForFormatConflict(other.status)) return false
    if (entryFormat(other) === format) return false
    return instancesOverlap(entry, other)
  })
}

export function installedFormatConflict(
  entry: CatalogEntry,
  catalog: CatalogEntry[],
): CatalogEntry | undefined {
  return installedFormatConflicts(entry, catalog)[0]
}

export function formatConflictMessage(entry: CatalogEntry, existing: CatalogEntry): string {
  const existingKeys = new Set(
    existing.faces.map((face) => instanceKey(face.familyName, face.styleName)),
  )
  const face =
    entry.faces.find((item) => existingKeys.has(instanceKey(item.familyName, item.styleName))) ??
    entry.faces[0]
  const name = face ? `${face.familyName} ${face.styleName}`.trim() : 'This font'
  return `${name} is already installed as ${entryFormat(existing).toUpperCase()}.`
}

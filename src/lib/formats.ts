import type { CatalogEntry } from './types'

export const INSTALLABLE_FORMATS = ['otf', 'ttf', 'ttc', 'otc'] as const
export const WOFF_INSTALL_ERROR = 'WOFF files cannot be installed.'

export type InstallableFormat = (typeof INSTALLABLE_FORMATS)[number]

export type FormatCount = {
  format: string
  count: number
}

const FORMAT_LABELS: Record<string, string> = {
  otf: 'OpenType',
  ttf: 'TrueType',
  ttc: 'TrueType Collection',
  otc: 'OpenType Collection',
}

export function normalizeFormat(format: string): string {
  return format.trim().toLowerCase().replace(/^\./, '')
}

export function formatFromName(name: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(name)
  return match ? normalizeFormat(match[1]) : null
}

export function isWebFormat(format: string): boolean {
  const value = normalizeFormat(format)
  return value === 'woff' || value === 'woff2'
}

export function isInstallableFormat(format: string): format is InstallableFormat {
  return (INSTALLABLE_FORMATS as readonly string[]).includes(normalizeFormat(format))
}

export function formatLabel(format: string): string {
  const value = normalizeFormat(format)
  return FORMAT_LABELS[value] ?? value.toUpperCase()
}

export function formatExtension(format: string): string {
  return `.${normalizeFormat(format)}`
}

export function preferredFormat(formats: string[]): string | undefined {
  for (const format of INSTALLABLE_FORMATS) {
    if (formats.includes(format)) return format
  }
  return formats[0]
}

export function countFormats(formats: string[]): FormatCount[] {
  const counts = new Map<string, number>()
  for (const format of formats) {
    const value = normalizeFormat(format)
    if (!value || isWebFormat(value)) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return INSTALLABLE_FORMATS.filter((format) => counts.has(format)).map((format) => ({
    format,
    count: counts.get(format) ?? 0,
  }))
}

export function fileCountLabel(count: number): string {
  return count === 1 ? '1 file' : `${count} files`
}

export function entryFormatOf(entry: Pick<CatalogEntry, 'format' | 'sourcePath'>): string {
  return normalizeFormat(entry.format) || formatFromName(entry.sourcePath) || ''
}

export function uniqueEntryFormats(
  entries: Array<Pick<CatalogEntry, 'format' | 'sourcePath'>>,
): string[] {
  return countFormats(entries.map(entryFormatOf)).map((item) => item.format)
}

function isActiveStatus(status: CatalogEntry['status']): boolean {
  return status === 'installed' || status === 'outdated' || status === 'deactivated'
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

export type FormatConflict = {
  incoming: CatalogEntry
  existing: CatalogEntry
}

export function listFormatConflicts(
  incoming: CatalogEntry[],
  catalog: CatalogEntry[],
): FormatConflict[] {
  const conflicts: FormatConflict[] = []
  const seen = new Set<string>()
  for (const entry of incoming) {
    const format = entryFormatOf(entry)
    const existing = catalog.find((other) => {
      if (other.id === entry.id || !isActiveStatus(other.status)) return false
      if (entryFormatOf(other) === format) return false
      return instancesOverlap(entry, other)
    })
    if (!existing) continue
    const key = `${entry.id}:${existing.id}`
    if (seen.has(key)) continue
    seen.add(key)
    conflicts.push({ incoming: entry, existing })
  }
  return conflicts
}

export function conflictInstanceNames(conflicts: FormatConflict[]): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const { incoming, existing } of conflicts) {
    const existingKeys = new Set(
      existing.faces.map((face) => instanceKey(face.familyName, face.styleName)),
    )
    const matches = incoming.faces.filter((face) =>
      existingKeys.has(instanceKey(face.familyName, face.styleName)),
    )
    const faces = matches.length > 0 ? matches : incoming.faces.slice(0, 1)
    for (const face of faces) {
      const name = `${face.familyName} ${face.styleName}`.trim()
      if (seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

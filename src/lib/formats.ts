export const INSTALLABLE_FORMATS = ['otf', 'ttf', 'ttc', 'otc'] as const
export const WEB_FORMATS = ['woff', 'woff2'] as const
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

export function isWebFontName(name: string): boolean {
  const format = formatFromName(name)
  return Boolean(format && isWebFormat(format))
}

export function isInstallableFormat(format: string): format is InstallableFormat {
  return (INSTALLABLE_FORMATS as readonly string[]).includes(normalizeFormat(format))
}

export function isInstallableFontName(name: string): boolean {
  const format = formatFromName(name)
  return Boolean(format && isInstallableFormat(format))
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

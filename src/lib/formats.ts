export const INSTALLABLE_FORMATS = ['otf', 'ttf', 'ttc', 'otc'] as const
export const WOFF_INSTALL_ERROR = 'WOFF files cannot be installed.'

export type InstallableFormat = (typeof INSTALLABLE_FORMATS)[number]

export type FormatCount = {
  format: string
  count: number
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

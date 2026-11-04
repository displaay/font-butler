export const APP_ICON_STYLES = ['classic', 'bright', 'mono', 'cuttler'] as const

export type AppIconStyle = (typeof APP_ICON_STYLES)[number]

export const DEFAULT_APP_ICON_STYLE: AppIconStyle = 'classic'

export const APP_ICON_OPTIONS: { id: AppIconStyle; label: string }[] = [
  { id: 'classic', label: 'Butt' },
  { id: 'bright', label: 'Suit' },
  { id: 'mono', label: 'Dark' },
  { id: 'cuttler', label: 'Cuttler' },
]

export function isAppIconStyle(value: unknown): value is AppIconStyle {
  return typeof value === 'string' && (APP_ICON_STYLES as readonly string[]).includes(value)
}

export function parseAppIconStyle(value: unknown): AppIconStyle {
  return isAppIconStyle(value) ? value : DEFAULT_APP_ICON_STYLE
}

export function appIconPreviewSrc(style: AppIconStyle): string {
  return `/app-icons/${style}.png`
}

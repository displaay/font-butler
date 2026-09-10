export const APP_ICON_STYLES = ['classic', 'bright', 'mono'] as const

export type AppIconStyle = (typeof APP_ICON_STYLES)[number]

export const DEFAULT_APP_ICON_STYLE: AppIconStyle = 'classic'

export const APP_ICON_OPTIONS: { id: AppIconStyle; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'bright', label: 'Bright' },
  { id: 'mono', label: 'Black & grey' },
]

export function isAppIconStyle(value: unknown): value is AppIconStyle {
  return value === 'classic' || value === 'bright' || value === 'mono'
}

export function parseAppIconStyle(value: unknown): AppIconStyle {
  return isAppIconStyle(value) ? value : DEFAULT_APP_ICON_STYLE
}

export function appIconPreviewSrc(style: AppIconStyle): string {
  return `/app-icons/${style}.png`
}

import { isLatinPreviewSample, resolvedPreviewSample } from './previewSample.ts'

export const LATIN_PREVIEW_PRESETS = ['Aa', 'Ag', 'Ta', 'ag'] as const

export type LatinPreviewQuickPreset = (typeof LATIN_PREVIEW_PRESETS)[number]

export type LatinPreviewPreset = LatinPreviewQuickPreset | 'custom'

export const LATIN_PREVIEW_MAX_LENGTH = 8

export const DEFAULT_LATIN_PREVIEW_TEXT = 'Aa'

export type LatinPreviewPreferences = {
  preset: LatinPreviewPreset
  custom: string
}

export function isLatinPreviewPreset(value: unknown): value is LatinPreviewPreset {
  return value === 'Aa' || value === 'Ag' || value === 'Ta' || value === 'ag' || value === 'custom'
}

export function normalizeLatinPreviewCustom(value: unknown): string {
  if (typeof value !== 'string') return ''
  return [...value.replace(/\s+/g, ' ').trim()].slice(0, LATIN_PREVIEW_MAX_LENGTH).join('')
}

export function parseLatinPreview(value: unknown): LatinPreviewPreferences | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Partial<LatinPreviewPreferences>
  if (!isLatinPreviewPreset(row.preset)) return undefined
  return {
    preset: row.preset,
    custom: normalizeLatinPreviewCustom(row.custom),
  }
}

export function latinPreviewText(prefs?: LatinPreviewPreferences | null): string {
  if (!prefs || prefs.preset !== 'custom') {
    return prefs && prefs.preset !== 'custom' ? prefs.preset : DEFAULT_LATIN_PREVIEW_TEXT
  }
  return normalizeLatinPreviewCustom(prefs.custom) || DEFAULT_LATIN_PREVIEW_TEXT
}

export function isLatinDefaultSample(sample: string): boolean {
  return isLatinPreviewSample(sample)
}

export function applyLatinPreviewSample(
  stored: string | undefined | null,
  latinText: string,
): string {
  const sample = resolvedPreviewSample(stored)
  return isLatinDefaultSample(sample) ? latinText : sample
}

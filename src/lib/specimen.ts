import type { PreviewPreferences } from './types'

export const SPECIMEN_PRESETS: Record<
  PreviewPreferences['preset'],
  { label: string; text: string }
> = {
  headline: {
    label: 'Headline',
    text: 'The quick brown fox jumps over the lazy type.',
  },
  paragraph: {
    label: 'Paragraph',
    text: 'A designer judges a font with the words they actually set. Pack the specimen with letters, figures, and punctuation so the next export can be compared before it is installed.',
  },
  numerals: {
    label: 'Numerals',
    text: '0123456789 $€£¥ ½⅓¼ %.,;:!? @#&*',
  },
  custom: {
    label: 'Custom',
    text: 'The quick brown fox jumps over the lazy type.',
  },
}

export const DEFAULT_SPECIMEN: PreviewPreferences = {
  text: SPECIMEN_PRESETS.headline.text,
  size: 32,
  lineHeight: 1.2,
  preset: 'headline',
}

export function specimenFromSettings(value?: PreviewPreferences | null): PreviewPreferences {
  if (!value) return { ...DEFAULT_SPECIMEN }
  return {
    text: value.text || DEFAULT_SPECIMEN.text,
    size: value.size || DEFAULT_SPECIMEN.size,
    lineHeight: value.lineHeight || DEFAULT_SPECIMEN.lineHeight,
    preset: value.preset || 'headline',
  }
}

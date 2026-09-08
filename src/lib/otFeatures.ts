export type OtFeatureGroupId = 'stylistic' | 'figures' | 'rest'

export type OtFeatureGroup = {
  id: OtFeatureGroupId
  label: string
  tags: string[]
}

const FIGURE_TAGS = [
  'lnum',
  'onum',
  'pnum',
  'tnum',
  'frac',
  'afrc',
  'ordn',
  'zero',
  'numr',
  'dnom',
] as const

const FIGURE_TAG_SET = new Set<string>(FIGURE_TAGS)

const FIGURE_NAME_TO_TAG: Record<string, string> = {
  'lining figures': 'lnum',
  'lining numerals': 'lnum',
  'oldstyle figures': 'onum',
  'old-style figures': 'onum',
  'oldstyle numerals': 'onum',
  'old-style numerals': 'onum',
  'proportional figures': 'pnum',
  'proportional numerals': 'pnum',
  'tabular figures': 'tnum',
  'tabular numerals': 'tnum',
  fractions: 'frac',
  'slashed zero': 'zero',
  numerators: 'numr',
  denominators: 'dnom',
  ordinals: 'ordn',
}

export function normalizeFeatureTag(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const stylistic = trimmed.match(/^stylistic\s+sets?\s+(\d{1,2})$/i)
  if (stylistic) return `ss${stylistic[1]!.padStart(2, '0')}`
  const named = FIGURE_NAME_TO_TAG[trimmed.toLowerCase()]
  if (named) return named
  const compact = trimmed.toLowerCase().replace(/\s+/g, '')
  const ssShort = compact.match(/^ss(\d{1,2})$/)
  if (ssShort) return `ss${ssShort[1]!.padStart(2, '0')}`
  if (/^[a-z0-9]{4}$/.test(compact)) return compact
  return null
}

function isStylisticSet(tag: string): boolean {
  return /^ss\d{2}$/.test(tag)
}

export function groupOtFeatures(raw: string[]): OtFeatureGroup[] {
  const seen = new Set<string>()
  const stylistic: string[] = []
  const figures: string[] = []
  const rest: string[] = []
  for (const item of raw) {
    const tag = normalizeFeatureTag(item)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    if (isStylisticSet(tag)) stylistic.push(tag)
    else if (FIGURE_TAG_SET.has(tag)) figures.push(tag)
    else rest.push(tag)
  }
  stylistic.sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))
  figures.sort((a, b) => FIGURE_TAGS.indexOf(a as (typeof FIGURE_TAGS)[number]) - FIGURE_TAGS.indexOf(b as (typeof FIGURE_TAGS)[number]))
  const groups: OtFeatureGroup[] = [
    { id: 'stylistic', label: 'Stylistic sets', tags: stylistic },
    { id: 'figures', label: 'Figures', tags: figures },
    { id: 'rest', label: 'Rest', tags: rest },
  ]
  return groups.filter((group) => group.tags.length > 0)
}

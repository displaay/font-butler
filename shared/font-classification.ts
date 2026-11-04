/**
 * Small font classification from data the font already carries.
 * Order matches the non-model part of a type manager: the OS/2 family class
 * the font declares, then words in its name table, then PANOSE.
 * No shape model and no guess from an unrelated family name.
 * A font that says nothing stays unclassified.
 */

export const FONT_CLASSIFICATIONS = [
  'serif',
  'sans-serif',
  'monospaced',
  'script',
  'ornamental',
  'symbol',
] as const

export type FontClassification = (typeof FONT_CLASSIFICATIONS)[number]

export const FONT_CLASSIFICATION_LABELS: Record<FontClassification, string> = {
  serif: 'Serif',
  'sans-serif': 'Sans Serif',
  monospaced: 'Monospaced',
  script: 'Script',
  ornamental: 'Ornamental',
  symbol: 'Symbol',
}

const CLASSIFICATION_SET = new Set<string>(FONT_CLASSIFICATIONS)

export function isFontClassification(value: string): value is FontClassification {
  return CLASSIFICATION_SET.has(value)
}

export function fontClassificationId(value: string): FontClassification | null {
  const compact = value.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  if (isFontClassification(compact)) return compact
  for (const id of FONT_CLASSIFICATIONS) {
    if (FONT_CLASSIFICATION_LABELS[id].toLowerCase() === compact) return id
  }
  if (compact === 'sans' || compact === 'sans serif' || compact === 'sansserif') return 'sans-serif'
  if (compact === 'mono' || compact === 'monospace' || compact === 'monospaced') return 'monospaced'
  return null
}

export function fontNameTokens(value: string): string[] {
  return value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

const NAME_RULES: { tokens: readonly string[]; classification: FontClassification }[] = [
  { tokens: ['mono', 'monospace', 'monospaced', 'typewriter'], classification: 'monospaced' },
  { tokens: ['symbol', 'symbols', 'dingbat', 'dingbats'], classification: 'symbol' },
  { tokens: ['script', 'calligraphy', 'handwritten', 'handwriting'], classification: 'script' },
  { tokens: ['stencil', 'ornamental', 'ornament'], classification: 'ornamental' },
  { tokens: ['slab', 'serif'], classification: 'serif' },
  { tokens: ['sans', 'sansserif', 'grotesk', 'grotesque'], classification: 'sans-serif' },
]

export function classificationFromNames(names: readonly string[]): FontClassification | null {
  const tokens = names.flatMap((name) => fontNameTokens(name))
  for (const rule of NAME_RULES) {
    if (tokens.some((token) => rule.tokens.includes(token))) return rule.classification
  }
  return null
}

function ibmClass(sFamilyClass: number): FontClassification | null {
  const klass = (sFamilyClass >> 8) & 0xff
  if (klass === 1 || klass === 2 || klass === 3 || klass === 4 || klass === 5 || klass === 7) {
    return 'serif'
  }
  if (klass === 8) return 'sans-serif'
  if (klass === 9) return 'ornamental'
  if (klass === 10) return 'script'
  if (klass === 12) return 'symbol'
  return null
}

function panoseClass(panose: readonly number[]): FontClassification | null {
  if (panose.length < 4 || panose.every((value) => value === 0)) return null
  const family = panose[0] ?? 0
  const serifStyle = panose[1] ?? 0
  const proportion = panose[3] ?? 0
  if (proportion === 9) return 'monospaced'
  if (family === 3) return 'script'
  if (family === 4) return 'ornamental'
  if (family === 5) return 'symbol'
  if (family === 2) {
    if ((serifStyle >= 2 && serifStyle <= 10) || serifStyle === 14) return 'serif'
    if ((serifStyle >= 11 && serifStyle <= 13) || serifStyle === 15) return 'sans-serif'
  }
  return null
}

export function classifyFont(input: {
  sFamilyClass?: number | null
  panose?: readonly number[] | null
  names?: readonly (string | null | undefined)[]
}): FontClassification | null {
  if (typeof input.sFamilyClass === 'number' && Number.isFinite(input.sFamilyClass)) {
    const fromIbm = ibmClass(input.sFamilyClass)
    if (fromIbm) return fromIbm
  }
  const names = (input.names ?? []).filter((name): name is string => Boolean(name?.trim()))
  const fromNames = classificationFromNames(names)
  if (fromNames) return fromNames
  if (input.panose && input.panose.length > 0) {
    const fromPanose = panoseClass(input.panose)
    if (fromPanose) return fromPanose
  }
  return null
}

/** Manufacturer string from name ID 8, trimmed. Empty stays empty. */
export function foundryFromManufacturer(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.slice(0, 200)
}

/** Designer string from name ID 9, trimmed. Empty stays empty. */
export function designerFromName(value: unknown): string | null {
  return foundryFromManufacturer(value)
}

export type ClassifiableFace = {
  classification?: string | null
  familyName?: string | null
  styleName?: string | null
  fullName?: string | null
  postscriptName?: string | null
}

/**
 * Stored classification wins. A missing field falls back to name-table words
 * already on the face, so older catalog rows still classify when the name says.
 * `null` means the file was read and declared nothing.
 */
export function classificationOfFace(face: ClassifiableFace): FontClassification | null {
  if (face.classification === null) return null
  if (typeof face.classification === 'string') return fontClassificationId(face.classification)
  return classifyFont({
    names: [face.familyName, face.styleName, face.fullName, face.postscriptName],
  })
}

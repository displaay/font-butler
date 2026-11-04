/**
 * Library search in the Cicero sense: words combine, and a Filters token
 * both narrows the list and asks every preview to show that style.
 * A word that is a family tag matches that tag by name. "Trial" is the Trial
 * tag, not a generic "has a tag" trait, and "tag" itself is not a trait.
 * Traits come from face metadata already on the family. Foundry and designer
 * are the name-table strings, not a guess.
 */

import {
  classificationOfFace,
  fontNameTokens,
  type ClassifiableFace,
  type FontClassification,
} from './font-classification.ts'

export const SEARCH_TOKEN_IDS = [
  'thin',
  'extralight',
  'light',
  'regular',
  'medium',
  'semibold',
  'bold',
  'extrabold',
  'black',
  'italic',
  'condensed',
  'extended',
  'tabular',
  'oldstyle',
  'variable',
] as const

export type SearchTokenId = (typeof SEARCH_TOKEN_IDS)[number]

export type SearchTokenGroup = 'weight' | 'style' | 'figures' | 'kind'

export type SearchToken = {
  id: SearchTokenId
  label: string
  group: SearchTokenGroup
  weight?: number
}

export const SEARCH_TOKENS: readonly SearchToken[] = [
  { id: 'thin', label: 'Thin', group: 'weight', weight: 100 },
  { id: 'extralight', label: 'Extra Light', group: 'weight', weight: 200 },
  { id: 'light', label: 'Light', group: 'weight', weight: 300 },
  { id: 'regular', label: 'Regular', group: 'weight', weight: 400 },
  { id: 'medium', label: 'Medium', group: 'weight', weight: 500 },
  { id: 'semibold', label: 'Semibold', group: 'weight', weight: 600 },
  { id: 'bold', label: 'Bold', group: 'weight', weight: 700 },
  { id: 'extrabold', label: 'Extra Bold', group: 'weight', weight: 800 },
  { id: 'black', label: 'Black', group: 'weight', weight: 900 },
  { id: 'italic', label: 'Italic', group: 'style' },
  { id: 'condensed', label: 'Condensed', group: 'style' },
  { id: 'extended', label: 'Extended', group: 'style' },
  { id: 'tabular', label: 'Tabular Figures', group: 'figures' },
  { id: 'oldstyle', label: 'Old-Style Figures', group: 'figures' },
  { id: 'variable', label: 'Variable', group: 'kind' },
]

const TOKEN_BY_ID = new Map(SEARCH_TOKENS.map((token) => [token.id, token]))

export function searchTokenById(id: string): SearchToken | undefined {
  return TOKEN_BY_ID.get(id as SearchTokenId)
}

export type SearchFace = ClassifiableFace & {
  isVariable?: boolean
  italic?: boolean
  weight?: number
  foundry?: string | null
  designer?: string | null
  features?: readonly string[] | null
  widthClass?: number | null
  instanceNames?: readonly string[] | null
}

export type SearchFamily = {
  familyName: string
  faces: readonly SearchFace[]
  tagNames?: readonly string[]
}

export type PreviewRequest = {
  weight?: number
  italic?: boolean
  condensed?: boolean
  extended?: boolean
  tabular?: boolean
  oldstyle?: boolean
  variable?: boolean
}

const TRAIT_WORDS: Record<string, (family: SearchFamily) => boolean> = {
  variable: (family) => family.faces.some((face) => face.isVariable),
  vf: (family) => family.faces.some((face) => face.isVariable),
  mono: (family) => hasClass(family, 'monospaced') || nameHasToken(family, ['mono', 'monospace', 'monospaced']),
  monospaced: (family) => hasClass(family, 'monospaced') || nameHasToken(family, ['mono', 'monospace', 'monospaced']),
  monospace: (family) => hasClass(family, 'monospaced') || nameHasToken(family, ['mono', 'monospace', 'monospaced']),
  serif: (family) => hasClass(family, 'serif') || nameHasToken(family, ['serif', 'slab']),
  sans: (family) => hasClass(family, 'sans-serif') || nameHasToken(family, ['sans', 'sansserif', 'grotesk', 'grotesque']),
  script: (family) => hasClass(family, 'script') || nameHasToken(family, ['script']),
  ornamental: (family) => hasClass(family, 'ornamental'),
  symbol: (family) => hasClass(family, 'symbol'),
  condensed: (family) => familyIsCondensed(family),
  compressed: (family) => familyIsCondensed(family),
  narrow: (family) => familyIsCondensed(family),
  extended: (family) => familyIsExtended(family),
  expanded: (family) => familyIsExtended(family),
  wide: (family) => familyIsExtended(family),
  italic: (family) => family.faces.some((face) => face.italic || styleSaysItalic(face)),
}

export function addSearchToken(current: readonly SearchToken[], id: SearchTokenId): SearchToken[] {
  const token = TOKEN_BY_ID.get(id)
  if (!token) return [...current]
  const without = token.group === 'weight' ? current.filter((item) => item.group !== 'weight') : current.filter((item) => item.id !== id)
  if (without.some((item) => item.id === id)) return without
  return [...without, token]
}

export function suggestSearchTokens(typed: string): SearchToken[] {
  const needle = typed.trim().toLowerCase()
  if (!needle) return [...SEARCH_TOKENS]
  return SEARCH_TOKENS.filter((token) => {
    const label = token.label.toLowerCase()
    return (
      label.startsWith(needle) ||
      token.id.startsWith(needle) ||
      label.split(/\s+/).some((word) => word.startsWith(needle))
    )
  })
}

/** Drop a trailing word that was only there to pick the filter. */
export function textAfterTokenChoice(text: string, token: SearchToken): string {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  const last = parts[parts.length - 1]!.toLowerCase()
  const label = token.label.toLowerCase()
  if (label.startsWith(last) || token.id.startsWith(last) || label.split(/\s+/).some((word) => word.startsWith(last))) {
    return parts.slice(0, -1).join(' ')
  }
  return text
}

export function previewRequestFromTokens(tokens: readonly SearchToken[]): PreviewRequest {
  const request: PreviewRequest = {}
  for (const token of tokens) {
    if (token.weight) request.weight = token.weight
    if (token.id === 'italic') request.italic = true
    if (token.id === 'condensed') request.condensed = true
    if (token.id === 'extended') request.extended = true
    if (token.id === 'tabular') request.tabular = true
    if (token.id === 'oldstyle') request.oldstyle = true
    if (token.id === 'variable') request.variable = true
  }
  return request
}

export function previewRequestActive(request: PreviewRequest | null | undefined): boolean {
  if (!request) return false
  return (
    request.weight != null ||
    request.italic === true ||
    request.condensed === true ||
    request.extended === true ||
    request.tabular === true ||
    request.oldstyle === true
  )
}

export function familyMatchesLibrarySearch(
  family: SearchFamily,
  text: string,
  tokens: readonly SearchToken[] = [],
  knownTagNames: readonly string[] = [],
): boolean {
  const { tagPhrases, words } = splitSearchWords(text, knownTagNames)
  if (tagPhrases.length === 0 && words.length === 0 && tokens.length === 0) return true
  if (!tagPhrases.every((phrase) => familyHasExactTag(family, phrase))) return false
  if (!words.every((word) => wordMatches(word, family))) return false
  return tokens.every((token) => tokenMatches(token, family))
}

export type PreviewChoice = {
  weight?: number
  italic?: boolean
  variation?: string
  label: string
  featureSettings?: string
}

export type PreviewRow = {
  weight?: number
  italic?: boolean
  label: string
  variation?: string
  features?: readonly string[] | null
}

export function cardPreviewFromRequest(
  rows: readonly PreviewRow[],
  request: PreviewRequest | null | undefined,
): PreviewChoice | null {
  if (!previewRequestActive(request) || !request) return null
  let pool = rows.length > 0 ? [...rows] : []
  if (request.italic) {
    const italic = pool.filter((row) => row.italic || /\b(italic|oblique)\b/i.test(row.label))
    if (italic.length > 0) pool = italic
  }
  if (request.condensed) {
    const narrow = pool.filter((row) => isCondensedLabel(row.label))
    if (narrow.length > 0) pool = narrow
  }
  if (request.extended) {
    const wide = pool.filter((row) => isExtendedLabel(row.label))
    if (wide.length > 0) pool = wide
  }
  let chosen = pool[0]
  if (request.weight != null && pool.length > 0) {
    chosen = pool.reduce((best, row) => {
      const weight = row.weight ?? weightFromStyleName(row.label)
      const bestWeight = best.weight ?? weightFromStyleName(best.label)
      return Math.abs(weight - request.weight!) < Math.abs(bestWeight - request.weight!) ? row : best
    })
  }
  const weight = request.weight ?? chosen?.weight
  const italic = request.italic ? true : Boolean(chosen?.italic)
  const features: string[] = []
  if (request.tabular) features.push('"tnum" 1')
  if (request.oldstyle) features.push('"onum" 1')
  return {
    weight,
    italic,
    variation: chosen?.variation,
    label: chosen?.label ?? 'Regular',
    featureSettings: features.length > 0 ? features.join(', ') : undefined,
  }
}

/**
 * Pull known tag names out of the query as whole phrases, longest first.
 * "Licensed" is not found inside "Unlicensed". Whatever is left is a normal word.
 */
export function splitSearchWords(
  text: string,
  knownTagNames: readonly string[] = [],
): { tagPhrases: string[]; words: string[] } {
  let remaining = ` ${normalizeTagName(text)} `
  const tagPhrases: string[] = []
  const known = [...new Set(knownTagNames.map((name) => normalizeTagName(name)).filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  )
  for (const tag of known) {
    const needle = ` ${tag} `
    if (!remaining.includes(needle)) continue
    tagPhrases.push(tag)
    remaining = remaining.split(needle).join(' ')
  }
  return {
    tagPhrases,
    words: remaining.trim().split(/\s+/).filter(Boolean),
  }
}

function wordMatches(word: string, family: SearchFamily): boolean {
  const token = word.toLowerCase()
  if (familyHasExactTag(family, token)) return true
  const trait = TRAIT_WORDS[token]
  if (trait?.(family)) return true
  return textMatchesWord(haystack(family), token)
}

function normalizeTagName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function familyHasExactTag(family: SearchFamily, name: string): boolean {
  const wanted = normalizeTagName(name)
  if (!wanted) return false
  return (family.tagNames ?? []).some((tag) => normalizeTagName(tag) === wanted)
}

function tokenMatches(token: SearchToken, family: SearchFamily): boolean {
  if (token.id === 'variable') return family.faces.some((face) => face.isVariable)
  if (token.id === 'italic') return family.faces.some((face) => face.italic || styleSaysItalic(face))
  if (token.id === 'condensed') return familyIsCondensed(family)
  if (token.id === 'extended') return familyIsExtended(family)
  if (token.id === 'tabular') return familyHasFeature(family, 'tnum') || nameHasToken(family, ['tabular', 'tnum'])
  if (token.id === 'oldstyle') {
    return familyHasFeature(family, 'onum') || nameHasToken(family, ['oldstyle', 'osf'])
  }
  if (token.weight != null) return familyHasWeight(family, token.weight)
  return false
}

function hasClass(family: SearchFamily, id: FontClassification): boolean {
  return family.faces.some((face) => classificationOfFace(face) === id)
}

function nameHasToken(family: SearchFamily, tokens: readonly string[]): boolean {
  const have = fontNameTokens(haystack(family))
  return have.some((token) => tokens.includes(token))
}

function textMatchesWord(text: string, word: string): boolean {
  const tokens = fontNameTokens(text)
  if (tokens.some((token) => token.startsWith(word))) return true
  if (word.length >= 4 && text.toLowerCase().includes(word)) return true
  return false
}

function haystack(family: SearchFamily): string {
  const parts = [family.familyName]
  for (const face of family.faces) {
    if (face.familyName) parts.push(face.familyName)
    if (face.styleName) parts.push(face.styleName)
    if (face.fullName) parts.push(face.fullName)
    if (face.postscriptName) parts.push(face.postscriptName)
    if (face.foundry) parts.push(face.foundry)
    if (face.designer) parts.push(face.designer)
    for (const name of face.instanceNames ?? []) parts.push(name)
  }
  return parts.join(' ')
}

function familyIsCondensed(family: SearchFamily): boolean {
  return family.faces.some(
    (face) =>
      (typeof face.widthClass === 'number' && face.widthClass > 0 && face.widthClass <= 4) ||
      isCondensedLabel(face.styleName ?? '') ||
      (face.instanceNames ?? []).some((name) => isCondensedLabel(name)),
  )
}

function familyIsExtended(family: SearchFamily): boolean {
  return family.faces.some(
    (face) =>
      (typeof face.widthClass === 'number' && face.widthClass >= 6) ||
      isExtendedLabel(face.styleName ?? '') ||
      (face.instanceNames ?? []).some((name) => isExtendedLabel(name)),
  )
}

function familyHasFeature(family: SearchFamily, tag: string): boolean {
  return family.faces.some((face) => (face.features ?? []).includes(tag))
}

function familyHasWeight(family: SearchFamily, target: number): boolean {
  return family.faces.some((face) => faceWeightNear(face, target))
}

function faceWeightNear(face: SearchFace, target: number): boolean {
  if (typeof face.weight === 'number' && Math.abs(face.weight - target) <= 50) return true
  if (Math.abs(weightFromStyleName(face.styleName ?? '') - target) <= 50 && weightNamed(face.styleName ?? '')) {
    return true
  }
  return (face.instanceNames ?? []).some((name) => weightNamed(name) && Math.abs(weightFromStyleName(name) - target) <= 50)
}

function weightNamed(name: string): boolean {
  return /thin|light|regular|roman|book|medium|semibold|demibold|bold|black|heavy/i.test(name)
}

function styleSaysItalic(face: SearchFace): boolean {
  return /\b(italic|oblique)\b/i.test(`${face.styleName ?? ''} ${(face.instanceNames ?? []).join(' ')}`)
}

function isCondensedLabel(name: string): boolean {
  return /\b(condensed|compressed|narrow)\b/i.test(name)
}

function isExtendedLabel(name: string): boolean {
  return /\b(extended|expanded|wide)\b/i.test(name)
}

export function weightFromStyleName(name: string, fallback = 400): number {
  const compact = name.replace(/[\s\-_]/g, '').toLowerCase()
  if (/hairline|ultrathin|extrathin/.test(compact)) return 100
  if (/thin/.test(compact)) return 100
  if (/ultralight|extralight/.test(compact)) return 200
  if (/light/.test(compact)) return 300
  if (/medium/.test(compact)) return 500
  if (/semibold|demibold/.test(compact)) return 600
  if (/extrabold|ultrabold/.test(compact)) return 800
  if (/bold/.test(compact)) return 700
  if (/black|heavy/.test(compact)) return 900
  if (/book|roman|regular|normal/.test(compact)) return 400
  return fallback
}

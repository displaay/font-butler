export const GLYPH_CELL_KEY = 'font-butler-glyph-cell-size'
export const GLYPH_CELL_MIN = 40
export const GLYPH_CELL_MAX = 88
export const GLYPH_CELL_DEFAULT = 56
export const GLYPH_CELL_STEP = 4

const HANGUL_CHOSEONG = [
  'G',
  'GG',
  'N',
  'D',
  'DD',
  'R',
  'M',
  'B',
  'BB',
  'S',
  'SS',
  '',
  'J',
  'JJ',
  'C',
  'K',
  'T',
  'P',
  'H',
]
const HANGUL_JUNGSEONG = [
  'A',
  'AE',
  'YA',
  'YAE',
  'EO',
  'E',
  'YEO',
  'YE',
  'O',
  'WA',
  'WAE',
  'OE',
  'YO',
  'U',
  'WEO',
  'WE',
  'WI',
  'YU',
  'EU',
  'YI',
  'I',
]
const HANGUL_JONGSEONG = [
  '',
  'G',
  'GG',
  'GS',
  'N',
  'NJ',
  'NH',
  'D',
  'L',
  'LG',
  'LM',
  'LB',
  'LS',
  'LT',
  'LP',
  'LH',
  'M',
  'B',
  'BS',
  'S',
  'SS',
  'NG',
  'J',
  'C',
  'K',
  'T',
  'P',
  'H',
]
const DIGIT_NAMES = [
  'ZERO',
  'ONE',
  'TWO',
  'THREE',
  'FOUR',
  'FIVE',
  'SIX',
  'SEVEN',
  'EIGHT',
  'NINE',
]

export function displayableCodePoints(characterSet: number[] | undefined): number[] {
  if (!characterSet?.length) return []
  const seen = new Set<number>()
  const next: number[] = []
  for (const code of characterSet) {
    if (!Number.isInteger(code) || code < 32 || code === 127 || seen.has(code)) continue
    seen.add(code)
    next.push(code)
  }
  return next
}

export function codePointLabel(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
}

export function htmlCode(code: number): string {
  return `&#x${code.toString(16).toUpperCase()};`
}

export function glyphCharacter(code: number): string {
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

export function fallbackGlyphName(code: number): string {
  if (code === 32) return 'SPACE'
  if (code === 160) return 'NO-BREAK SPACE'
  if (isCjkIdeograph(code)) return `CJK UNIFIED IDEOGRAPH-${code.toString(16).toUpperCase()}`
  if (code >= 0xac00 && code <= 0xd7a3) return hangulSyllableName(code)
  const char = glyphCharacter(code)
  if (/^[A-Z]$/.test(char)) return `LATIN CAPITAL LETTER ${char}`
  if (/^[a-z]$/.test(char)) return `LATIN SMALL LETTER ${char.toUpperCase()}`
  if (/^[0-9]$/.test(char)) return `DIGIT ${DIGIT_NAMES[Number(char)]}`
  return codePointLabel(code)
}

export function glyphSearchFields(code: number): string[] {
  const hex = code.toString(16).toUpperCase()
  const unicode = codePointLabel(code)
  return [glyphCharacter(code), fallbackGlyphName(code), unicode, unicode.slice(2), hex, htmlCode(code)]
}

export function glyphMatchesQuery(code: number, query: string, contain: boolean): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return glyphSearchFields(code).some((field) => {
    const value = field.toLowerCase()
    return contain ? value.includes(needle) : value.startsWith(needle)
  })
}

export function filterGlyphs(points: number[], query: string, contain: boolean): number[] {
  if (!query.trim()) return points
  return points.filter((code) => glyphMatchesQuery(code, query, contain))
}

export function glyphFontSize(cell: number): number {
  return Math.round(cell * 0.43)
}

export const GLYPH_GROUP_HEADER_HEIGHT = 32
export const GLYPH_GROUP_GAP = 10

export type GlyphGroupId =
  | 'uppercase'
  | 'lowercase'
  | 'numbers'
  | 'punctuation'
  | 'currencies'
  | 'symbols'
  | 'marks'
  | 'spaces'
  | 'latin'
  | 'greek'
  | 'cyrillic'
  | 'arabic'
  | 'hebrew'
  | 'devanagari'
  | 'thai'
  | 'cjk'
  | 'hangul'
  | 'kana'
  | 'emoji'
  | 'private-use'
  | 'other'

export const GLYPH_GROUP_ORDER: GlyphGroupId[] = [
  'uppercase',
  'lowercase',
  'numbers',
  'punctuation',
  'currencies',
  'symbols',
  'marks',
  'spaces',
  'latin',
  'greek',
  'cyrillic',
  'arabic',
  'hebrew',
  'devanagari',
  'thai',
  'cjk',
  'hangul',
  'kana',
  'emoji',
  'private-use',
  'other',
]

export const GLYPH_GROUP_LABELS: Record<GlyphGroupId, string> = {
  uppercase: 'Uppercase',
  lowercase: 'Lowercase',
  numbers: 'Numbers',
  punctuation: 'Punctuation',
  currencies: 'Currencies',
  symbols: 'Symbols',
  marks: 'Marks',
  spaces: 'Spaces',
  latin: 'Latin',
  greek: 'Greek',
  cyrillic: 'Cyrillic',
  arabic: 'Arabic',
  hebrew: 'Hebrew',
  devanagari: 'Devanagari',
  thai: 'Thai',
  cjk: 'CJK',
  hangul: 'Hangul',
  kana: 'Kana',
  emoji: 'Emoji',
  'private-use': 'Private use',
  other: 'Other',
}

export type GlyphGroup = {
  id: GlyphGroupId
  label: string
  codes: number[]
}

export type GlyphLayoutRow =
  | { kind: 'header'; id: GlyphGroupId; label: string; count: number }
  | { kind: 'cells'; codes: number[] }

const PROP = {
  pictographic: /\p{Extended_Pictographic}/u,
  currency: /\p{Sc}/u,
  number: /\p{N}/u,
  punctuation: /\p{P}/u,
  symbol: /\p{S}/u,
  mark: /\p{M}/u,
  separator: /\p{Z}/u,
  uppercase: /\p{Lu}/u,
  titlecase: /\p{Lt}/u,
  lowercase: /\p{Ll}/u,
}

export function glyphGroupId(code: number): GlyphGroupId {
  const char = glyphCharacter(code)
  if (!char) return 'other'
  if (isPrivateUse(code)) return 'private-use'
  if (PROP.pictographic.test(char)) return 'emoji'
  if (PROP.currency.test(char)) return 'currencies'
  if (PROP.number.test(char)) return 'numbers'
  if (PROP.punctuation.test(char)) return 'punctuation'
  if (PROP.symbol.test(char)) return 'symbols'
  if (PROP.mark.test(char)) return 'marks'
  if (code === 32 || PROP.separator.test(char)) return 'spaces'
  if (inRange(code, 0x0370, 0x03ff) || inRange(code, 0x1f00, 0x1fff)) return 'greek'
  if (
    inRange(code, 0x0400, 0x052f) ||
    inRange(code, 0x2de0, 0x2dff) ||
    inRange(code, 0xa640, 0xa69f)
  ) {
    return 'cyrillic'
  }
  if (
    inRange(code, 0x0600, 0x06ff) ||
    inRange(code, 0x0750, 0x077f) ||
    inRange(code, 0x08a0, 0x08ff) ||
    inRange(code, 0xfb50, 0xfdff) ||
    inRange(code, 0xfe70, 0xfeff)
  ) {
    return 'arabic'
  }
  if (inRange(code, 0x0590, 0x05ff)) return 'hebrew'
  if (inRange(code, 0x0900, 0x097f)) return 'devanagari'
  if (inRange(code, 0x0e00, 0x0e7f)) return 'thai'
  if (
    inRange(code, 0x3040, 0x30ff) ||
    inRange(code, 0x31f0, 0x31ff) ||
    inRange(code, 0x1aff0, 0x1afff) ||
    inRange(code, 0x1b000, 0x1b16f)
  ) {
    return 'kana'
  }
  if (isHangulBlock(code)) return 'hangul'
  if (isCjkIdeograph(code) || inRange(code, 0x3000, 0x303f) || inRange(code, 0xf900, 0xfaff)) {
    return 'cjk'
  }
  if (PROP.uppercase.test(char) || PROP.titlecase.test(char)) return 'uppercase'
  if (PROP.lowercase.test(char)) return 'lowercase'
  if (isLatinBlock(code)) return 'latin'
  return 'other'
}

export function groupGlyphs(points: number[]): GlyphGroup[] {
  const buckets = new Map<GlyphGroupId, number[]>()
  for (const code of points) {
    const id = glyphGroupId(code)
    const list = buckets.get(id)
    if (list) list.push(code)
    else buckets.set(id, [code])
  }
  return GLYPH_GROUP_ORDER.flatMap((id) => {
    const codes = buckets.get(id)
    if (!codes?.length) return []
    return [{ id, label: GLYPH_GROUP_LABELS[id], codes: codes.sort((a, b) => a - b) }]
  })
}

export function glyphSectionRows(groups: GlyphGroup[], columns: number): GlyphLayoutRow[] {
  const cols = Math.max(1, columns)
  const rows: GlyphLayoutRow[] = []
  for (const group of groups) {
    rows.push({ kind: 'header', id: group.id, label: group.label, count: group.codes.length })
    for (let i = 0; i < group.codes.length; i += cols) {
      rows.push({ kind: 'cells', codes: group.codes.slice(i, i + cols) })
    }
  }
  return rows
}

export function glyphLayoutOffsets(
  rows: GlyphLayoutRow[],
  rowHeight: number,
  headerHeight = GLYPH_GROUP_HEADER_HEIGHT,
  sectionGap = GLYPH_GROUP_GAP,
): { tops: number[]; totalHeight: number } {
  const tops: number[] = []
  let y = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.kind === 'header' && i > 0) y += sectionGap
    tops.push(y)
    y += row.kind === 'header' ? headerHeight : rowHeight
  }
  return { tops, totalHeight: y }
}

export function visibleGlyphRowRange(
  rows: GlyphLayoutRow[],
  tops: number[],
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 3,
  headerHeight = GLYPH_GROUP_HEADER_HEIGHT,
): { start: number; end: number } {
  if (rows.length === 0) return { start: 0, end: 0 }
  const pad = overscan * rowHeight
  const from = scrollTop - pad
  const to = scrollTop + viewportHeight + pad
  let start = 0
  while (start < rows.length) {
    const height = rows[start]!.kind === 'header' ? headerHeight : rowHeight
    if (tops[start]! + height >= from) break
    start += 1
  }
  let end = start
  while (end < rows.length && tops[end]! < to) end += 1
  return { start, end }
}

export function glyphGridLayout(width: number, cell: number, gap: number): { columns: number; track: number } {
  const columns = Math.max(1, Math.floor((Math.max(width, 0) + gap) / (cell + gap)))
  const track = width > 0 ? Math.max(0, (width - gap * (columns - 1)) / columns) : cell
  return { columns, track }
}

export function clampGlyphCellSize(value: number): number {
  if (!Number.isFinite(value)) return GLYPH_CELL_DEFAULT
  const clamped = Math.min(GLYPH_CELL_MAX, Math.max(GLYPH_CELL_MIN, value))
  return Math.round(clamped / GLYPH_CELL_STEP) * GLYPH_CELL_STEP
}

export function readGlyphCellSize(): number {
  if (typeof localStorage === 'undefined') return GLYPH_CELL_DEFAULT
  const raw = localStorage.getItem(GLYPH_CELL_KEY)
  if (raw == null || raw === '') return GLYPH_CELL_DEFAULT
  return clampGlyphCellSize(Number(raw))
}

function isCjkIdeograph(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f) ||
    (code >= 0x2b740 && code <= 0x2b81f) ||
    (code >= 0x2b820 && code <= 0x2ceaf) ||
    (code >= 0x30000 && code <= 0x3134f)
  )
}

function hangulSyllableName(code: number): string {
  const sIndex = code - 0xac00
  const lIndex = Math.floor(sIndex / (21 * 28))
  const vIndex = Math.floor((sIndex % (21 * 28)) / 28)
  const tIndex = sIndex % 28
  return `HANGUL SYLLABLE ${HANGUL_CHOSEONG[lIndex]}${HANGUL_JUNGSEONG[vIndex]}${HANGUL_JONGSEONG[tIndex]}`
}

function inRange(code: number, start: number, end: number): boolean {
  return code >= start && code <= end
}

function isPrivateUse(code: number): boolean {
  return (
    inRange(code, 0xe000, 0xf8ff) ||
    inRange(code, 0xf0000, 0xffffd) ||
    inRange(code, 0x100000, 0x10fffd)
  )
}

function isLatinBlock(code: number): boolean {
  return (
    inRange(code, 0x0000, 0x024f) ||
    inRange(code, 0x1e00, 0x1eff) ||
    inRange(code, 0x2c60, 0x2c7f) ||
    inRange(code, 0xa720, 0xa7ff) ||
    inRange(code, 0xab30, 0xab6f)
  )
}

function isHangulBlock(code: number): boolean {
  return (
    inRange(code, 0x1100, 0x11ff) ||
    inRange(code, 0x3130, 0x318f) ||
    inRange(code, 0xa960, 0xa97f) ||
    inRange(code, 0xac00, 0xd7ff)
  )
}

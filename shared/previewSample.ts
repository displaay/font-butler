/**
 * Library-card preview samples, in the spirit of macOS Font Book’s My Fonts grid.
 *
 * Font Book / Core Text typically inspects cmap coverage (`coveredCharacterSet`),
 * not OS/2 code-page bits (those are often incomplete). This helper does the same
 * with a compact script table:
 *
 *   Latin        Aa  (AA if the font is caps-only)
 *   Hebrew       א
 *   Arabic       ع
 *   Hangul       동
 *   Kana         あ
 *   Han          永
 *   Thai         ก
 *   Devanagari   क
 *   Bengali      ক
 *   Emoji        😀
 *   Braille      ⠓
 *   Symbols      ☎☺ (or the first covered dingbat / PUA glyph)
 *
 * Selection rules:
 * 1. A non-Latin “distinct” script counts as supported when its representative
 *    is present and at least two core letters hit, or when three core letters hit.
 * 2. One distinct script → that script’s sample (so Arial Hebrew → א even though
 *    Latin is also present; incidental Latin fallbacks do not win).
 * 3. Three or more distinct scripts + Latin → pan-Unicode default Aa
 *    (Arial Unicode MS).
 * 4. Two distinct scripts → the better-covered one (Hangul before Kana before Han).
 * 5. No distinct script → Latin Aa/AA/aa when A or a exists; otherwise Greek or
 *    Cyrillic if those companions are the only letters; otherwise emoji / braille /
 *    symbols / first interesting glyph; otherwise Aa.
 *
 * Greek and Cyrillic travel with Latin in European fonts (Arial, Times), so they
 * do not override Latin when A/a is present.
 */

export const DEFAULT_PREVIEW_SAMPLE = 'Aa'

export type PreviewScriptKind = 'distinct' | 'companion' | 'emoji' | 'braille' | 'symbol'

export type PreviewScript = {
  id: string
  kind: PreviewScriptKind
  samples: string[]
  core: number[]
}

function range(start: number, end: number): number[] {
  const codes: number[] = []
  for (let code = start; code <= end; code += 1) codes.push(code)
  return codes
}

function codesOf(text: string): number[] {
  return [...text].flatMap((char) => {
    const code = char.codePointAt(0)
    return code === undefined ? [] : [code]
  })
}

const LATIN_A = 0x41
const LATIN_a = 0x61

export const PREVIEW_SCRIPTS: PreviewScript[] = [
  { id: 'hebrew', kind: 'distinct', samples: ['א'], core: range(0x05d0, 0x05ea) },
  {
    id: 'arabic',
    kind: 'distinct',
    samples: ['ع'],
    core: [0x0627, 0x0628, 0x062a, 0x062c, 0x062f, 0x0631, 0x0633, 0x0639, 0x0644, 0x0645, 0x0646, 0x064a],
  },
  { id: 'devanagari', kind: 'distinct', samples: ['क'], core: range(0x0915, 0x0939) },
  { id: 'bengali', kind: 'distinct', samples: ['ক'], core: range(0x0995, 0x09b9) },
  { id: 'gurmukhi', kind: 'distinct', samples: ['ਕ'], core: range(0x0a15, 0x0a39) },
  { id: 'gujarati', kind: 'distinct', samples: ['ક'], core: range(0x0a95, 0x0ab9) },
  { id: 'tamil', kind: 'distinct', samples: ['க'], core: [0x0b95, 0x0b99, 0x0b9a, 0x0b9c, 0x0b9e, 0x0b9f, 0x0ba3, 0x0ba4, 0x0ba8, 0x0baa] },
  { id: 'telugu', kind: 'distinct', samples: ['క'], core: range(0x0c15, 0x0c39) },
  { id: 'kannada', kind: 'distinct', samples: ['ಕ'], core: range(0x0c95, 0x0cb9) },
  { id: 'malayalam', kind: 'distinct', samples: ['ക'], core: range(0x0d15, 0x0d39) },
  { id: 'thai', kind: 'distinct', samples: ['ก'], core: range(0x0e01, 0x0e2e) },
  { id: 'lao', kind: 'distinct', samples: ['ກ'], core: range(0x0e81, 0x0eae) },
  { id: 'myanmar', kind: 'distinct', samples: ['က'], core: range(0x1000, 0x1021) },
  { id: 'georgian', kind: 'distinct', samples: ['ა'], core: range(0x10d0, 0x10f0) },
  { id: 'armenian', kind: 'distinct', samples: ['Աա'], core: range(0x0531, 0x0556) },
  { id: 'ethiopic', kind: 'distinct', samples: ['ሀ'], core: range(0x1200, 0x1248) },
  { id: 'khmer', kind: 'distinct', samples: ['ក'], core: range(0x1780, 0x17a2) },
  {
    id: 'hangul',
    kind: 'distinct',
    samples: ['동', '가'],
    core: [0xb3d9, 0xac00, 0xb098, 0xb2e4, 0xb77c, 0xb9c8, 0xbc14, 0xc0ac, 0xc544, 0xc790, 0xd558],
  },
  {
    id: 'kana',
    kind: 'distinct',
    samples: ['あ', 'ア'],
    core: [0x3042, 0x3044, 0x3046, 0x3048, 0x304a, 0x30a2, 0x30a4, 0x30a6, 0x30a8, 0x30aa],
  },
  {
    id: 'han',
    kind: 'distinct',
    samples: ['永', '漢', '一'],
    core: [0x6c38, 0x6f22, 0x4e00, 0x4e8c, 0x4e09, 0x4eba, 0x5927, 0x5c0f, 0x65e5, 0x6708, 0x6c34, 0x706b],
  },
  { id: 'braille', kind: 'braille', samples: ['⠓'], core: range(0x2800, 0x283f) },
  {
    id: 'emoji',
    kind: 'emoji',
    samples: ['😀'],
    core: [0x1f600, 0x1f602, 0x1f44d, 0x2764, 0x1f525, 0x2b50],
  },
  {
    id: 'greek',
    kind: 'companion',
    samples: ['Αα', 'Α', 'α'],
    core: [0x0391, 0x03b1, 0x0392, 0x03b2, 0x0393, 0x03b3, 0x039f, 0x03bf],
  },
  {
    id: 'cyrillic',
    kind: 'companion',
    samples: ['Аа', 'А', 'а'],
    core: [0x0410, 0x0430, 0x0411, 0x0431, 0x0412, 0x0432, 0x041e, 0x043e],
  },
  {
    id: 'symbols',
    kind: 'symbol',
    samples: ['☎☺', '☎', '☺', '★', '✦', '❧', '❦', '✿'],
    core: [0x260e, 0x263a, 0x263b, 0x2605, 0x2726, 0x2767, 0x2766, 0x273f, 0x2665, 0x2709, 0x2702],
  },
]

const PAN_UNICODE_DISTINCT = 3

export const PREVIEW_PROBE_CODE_POINTS: number[] = [
  ...new Set([
    LATIN_A,
    LATIN_a,
    ...PREVIEW_SCRIPTS.flatMap((script) => [...script.core, ...script.samples.flatMap(codesOf)]),
  ]),
]

function coverageSet(coverage: Iterable<number>): Set<number> {
  return coverage instanceof Set ? coverage : new Set(coverage)
}

function stringCovered(set: Set<number>, text: string): boolean {
  return codesOf(text).every((code) => set.has(code))
}

function coveredCount(set: Set<number>, codes: number[]): number {
  let hits = 0
  for (const code of codes) {
    if (set.has(code)) hits += 1
  }
  return hits
}

function sampleFor(set: Set<number>, script: PreviewScript): string {
  for (const sample of script.samples) {
    if (stringCovered(set, sample)) return sample
  }
  for (const code of script.core) {
    if (set.has(code)) return String.fromCodePoint(code)
  }
  return script.samples[0] ?? DEFAULT_PREVIEW_SAMPLE
}

function scriptSupported(set: Set<number>, script: PreviewScript): boolean {
  const hits = coveredCount(set, script.core)
  const hasSample = script.samples.some((sample) => stringCovered(set, sample))
  if (script.kind === 'emoji') return hasSample || hits >= 3
  if (script.kind === 'braille') return hasSample || hits >= 3
  if (script.kind === 'symbol') return hasSample || hits >= 2
  return hits >= 3 || (hasSample && hits >= 2)
}

function coverageRatio(set: Set<number>, script: PreviewScript): number {
  return script.core.length === 0 ? 0 : coveredCount(set, script.core) / script.core.length
}

function latinSample(set: Set<number>): string {
  const upper = set.has(LATIN_A)
  const lower = set.has(LATIN_a)
  if (upper && lower) return 'Aa'
  if (upper) return 'AA'
  if (lower) return 'aa'
  return DEFAULT_PREVIEW_SAMPLE
}

function hasLatin(set: Set<number>): boolean {
  return set.has(LATIN_A) || set.has(LATIN_a)
}

function bestScript(set: Set<number>, scripts: PreviewScript[]): PreviewScript | undefined {
  return [...scripts].sort((left, right) => {
    const ratio = coverageRatio(set, right) - coverageRatio(set, left)
    if (ratio !== 0) return ratio
    return PREVIEW_SCRIPTS.indexOf(left) - PREVIEW_SCRIPTS.indexOf(right)
  })[0]
}

const COMBINING = /\p{M}/u

function isInterestingFallback(code: number): boolean {
  if (!Number.isInteger(code) || code < 33 || code === 127) return false
  try {
    if (COMBINING.test(String.fromCodePoint(code))) return false
  } catch {
    return false
  }
  return (
    (code >= 0x2600 && code <= 0x27bf) ||
    (code >= 0x2b00 && code <= 0x2bff) ||
    (code >= 0xe000 && code <= 0xf8ff) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    code > 127
  )
}

function fallbackSample(set: Set<number>): string | null {
  for (const code of set) {
    if (
      (code >= 0x2600 && code <= 0x27bf) ||
      (code >= 0xe000 && code <= 0xf8ff) ||
      (code >= 0x1f300 && code <= 0x1f5ff)
    ) {
      if (isInterestingFallback(code)) return String.fromCodePoint(code)
    }
  }
  for (const code of set) {
    if (isInterestingFallback(code)) return String.fromCodePoint(code)
  }
  return null
}

/** Representative library-card glyph(s) for a font’s covered Unicode code points. */
export function previewSampleFromCoverage(coverage: Iterable<number> | undefined | null): string {
  if (!coverage) return DEFAULT_PREVIEW_SAMPLE
  const set = coverageSet(coverage)
  if (set.size === 0) return DEFAULT_PREVIEW_SAMPLE

  const distinct = PREVIEW_SCRIPTS.filter(
    (script) => script.kind === 'distinct' && scriptSupported(set, script),
  )
  const emoji = PREVIEW_SCRIPTS.find((script) => script.id === 'emoji')
  const braille = PREVIEW_SCRIPTS.find((script) => script.id === 'braille')
  const symbols = PREVIEW_SCRIPTS.find((script) => script.id === 'symbols')
  const companions = PREVIEW_SCRIPTS.filter(
    (script) => script.kind === 'companion' && scriptSupported(set, script),
  )
  const latin = hasLatin(set)

  if (emoji && scriptSupported(set, emoji)) {
    distinct.push(emoji)
  }
  if (braille && scriptSupported(set, braille)) {
    distinct.push(braille)
  }

  if (distinct.length >= PAN_UNICODE_DISTINCT && latin) {
    return latinSample(set)
  }
  if (distinct.length > 0) {
    const chosen = bestScript(set, distinct)
    if (chosen) return sampleFor(set, chosen)
  }
  if (latin) return latinSample(set)
  if (companions.length > 0) {
    const chosen = bestScript(set, companions)
    if (chosen) return sampleFor(set, chosen)
  }
  if (symbols && scriptSupported(set, symbols)) return sampleFor(set, symbols)
  return fallbackSample(set) ?? DEFAULT_PREVIEW_SAMPLE
}

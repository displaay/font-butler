/**
 * Which languages a font can set, from Hyperglot 0.8.1 the way Cicero reads it
 * (`LanguageRequirements.support` in Sources/CiceroCore/Coverage/Languages.swift).
 * A language is supported when any primary orthography's base characters and
 * required marks are all present. Auxiliary characters are the "fully
 * supported" extra and are not required. No shaping checks.
 */
import raw from './hyperglot/Languages.json' with { type: 'json' }

type LanguageFile = {
  version?: string
  languages: Array<{
    iso: string
    name: string
    speakers?: number
    autonym?: string
    orthographies?: Array<{ script?: string; base?: string; marks?: string }>
  }>
}

export type CoverageLanguage = {
  id: string
  name: string
  autonym?: string
  speakers: number
  scripts: readonly string[]
}

type CompiledOrthography = {
  script: string
  required: readonly number[]
}

type CompiledLanguage = CoverageLanguage & {
  orthographies: readonly CompiledOrthography[]
  terms: readonly string[]
}

const file = raw as LanguageFile

export const HYPERGLOT_VERSION = file.version ?? ''

function scalars(text: string | undefined): number[] {
  if (!text) return []
  const codes: number[] = []
  for (const char of text) {
    if (/\s/u.test(char)) continue
    const code = char.codePointAt(0)
    if (code === undefined) continue
    codes.push(code)
  }
  return codes
}

function requiredCodes(base: string | undefined, marks: string | undefined): number[] {
  const set = new Set<number>()
  for (const code of scalars(base)) set.add(code)
  for (const code of scalars(marks)) set.add(code)
  return [...set]
}

function searchTerm(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function compileLanguages(rows: LanguageFile['languages']): CompiledLanguage[] {
  const compiled: CompiledLanguage[] = []
  for (const row of [...rows].sort((a, b) => a.iso.localeCompare(b.iso))) {
    const orthographies: CompiledOrthography[] = []
    const scripts: string[] = []
    for (const orthography of row.orthographies ?? []) {
      const required = requiredCodes(orthography.base, orthography.marks)
      if (required.length === 0) continue
      const script = (orthography.script ?? '').trim()
      orthographies.push({ script, required })
      if (script && !scripts.includes(script)) scripts.push(script)
    }
    if (orthographies.length === 0 || !row.iso || !row.name?.trim()) continue
    const name = row.name.trim()
    const autonym = row.autonym?.trim() || undefined
    const terms = [searchTerm(name), searchTerm(autonym)].filter((term, index, all) => term && all.indexOf(term) === index)
    compiled.push({
      id: row.iso,
      name,
      ...(autonym ? { autonym } : {}),
      speakers: typeof row.speakers === 'number' && Number.isFinite(row.speakers) ? row.speakers : 0,
      scripts,
      orthographies,
      terms,
    })
  }
  return compiled
}

const COMPILED = compileLanguages(file.languages ?? [])
const BY_ID = new Map(COMPILED.map((language) => [language.id, language]))
const UNIVERSE = new Set<number>()
for (const language of COMPILED) {
  for (const orthography of language.orthographies) {
    for (const code of orthography.required) UNIVERSE.add(code)
  }
}

const TERM_TO_ID = new Map<string, string>()
const bySpeakers = [...COMPILED].sort(
  (a, b) => b.speakers - a.speakers || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
)
for (const language of bySpeakers) {
  for (const term of language.terms) {
    if (!TERM_TO_ID.has(term)) TERM_TO_ID.set(term, language.id)
  }
}

const SCRIPT_SET = new Set<string>()
for (const language of COMPILED) {
  for (const script of language.scripts) SCRIPT_SET.add(script)
}

export const COVERAGE_LANGUAGES: readonly CoverageLanguage[] = COMPILED.map((language) => ({
  id: language.id,
  name: language.name,
  ...(language.autonym ? { autonym: language.autonym } : {}),
  speakers: language.speakers,
  scripts: language.scripts,
}))

/** Most-spoken first, so a short prefix keeps the languages people ask for. */
export const COVERAGE_LANGUAGES_BY_SPEAKERS: readonly CoverageLanguage[] = bySpeakers.map((language) => ({
  id: language.id,
  name: language.name,
  ...(language.autonym ? { autonym: language.autonym } : {}),
  speakers: language.speakers,
  scripts: language.scripts,
}))

export const COVERAGE_SCRIPTS: readonly string[] = [...SCRIPT_SET].sort((a, b) => a.localeCompare(b))

export const LANGUAGE_SUGGESTION_LIMIT = 8

export function isCoverageLanguageId(value: string): boolean {
  return BY_ID.has(value)
}

export function isCoverageScript(value: string): boolean {
  return SCRIPT_SET.has(value)
}

export function languageFilterId(id: string): `language:${string}` {
  return `language:${id}`
}

export function scriptFilterId(script: string): `script:${string}` {
  return `script:${script}`
}

export function coverageFilterLabel(filter: string): string | null {
  if (filter.startsWith('language:')) {
    return BY_ID.get(filter.slice('language:'.length))?.name ?? null
  }
  if (filter.startsWith('script:')) {
    const script = filter.slice('script:'.length)
    return SCRIPT_SET.has(script) ? script : null
  }
  return null
}

/** Name and autonym, lowercased, for suggestion prefixes. */
export function languageSearchTerms(id: string): readonly string[] {
  return BY_ID.get(id)?.terms ?? []
}

/** Exact language name or autonym, for a typed search word. */
export function languageIdForSearchTerm(term: string): string | undefined {
  return TERM_TO_ID.get(searchTerm(term))
}

export function languageScripts(id: string): readonly string[] {
  return BY_ID.get(id)?.scripts ?? []
}

/** Code points one orthography requires. Tests build a font from this. */
export function orthographyRequirements(id: string): readonly (readonly number[])[] {
  return BY_ID.get(id)?.orthographies.map((orthography) => orthography.required) ?? []
}

export type SupportedCoverage = {
  /** ISO 639-3 ids, in catalog order. */
  languages: string[]
  /** Scripts of the orthographies that passed, not every script the language can use. */
  scripts: string[]
}

/**
 * Languages and scripts this character set supports.
 * `present` is the code points the font actually draws. U+0020 counts when
 * the caller put it here; this function does not special-case it.
 * A language with two orthographies counts a script only for the orthography
 * whose characters are all present.
 */
export function supportedCoverage(present: ReadonlySet<number>): SupportedCoverage {
  const languages: string[] = []
  const scripts = new Set<string>()
  for (const language of COMPILED) {
    let supported = false
    for (const orthography of language.orthographies) {
      if (!orthography.required.every((code) => present.has(code))) continue
      supported = true
      if (orthography.script) scripts.add(orthography.script)
    }
    if (supported) languages.push(language.id)
  }
  return { languages, scripts: [...scripts].sort((a, b) => a.localeCompare(b)) }
}

export function supportedLanguageIds(present: ReadonlySet<number>): string[] {
  return supportedCoverage(present).languages
}

/** Hyperglot characters worth reading out of a cmap. */
export function hyperglotCodePointSet(): ReadonlySet<number> {
  return UNIVERSE
}

export function mergeFaceLanguages<
  T extends { postscriptName?: string; languages?: string[]; scripts?: string[] },
>(
  faces: T[],
  parsed: readonly { postscriptName?: string; languages?: string[]; scripts?: string[] }[],
): boolean {
  const byName = new Map<string, { languages: string[]; scripts: string[] }>()
  for (const face of parsed) {
    if (!Array.isArray(face.languages)) continue
    const name = face.postscriptName?.trim()
    if (!name) continue
    byName.set(name, { languages: face.languages, scripts: face.scripts ?? [] })
  }
  let changed = false
  faces.forEach((face, index) => {
    if (Array.isArray(face.languages)) return
    const name = face.postscriptName?.trim()
    const fromName = name ? byName.get(name) : undefined
    const indexed = parsed.length === faces.length ? parsed[index] : undefined
    const languages = fromName?.languages ?? (Array.isArray(indexed?.languages) ? indexed.languages : undefined)
    if (!languages) return
    const scripts = fromName?.scripts ?? indexed?.scripts ?? []
    face.languages = [...languages]
    face.scripts = [...scripts]
    changed = true
  })
  return changed
}

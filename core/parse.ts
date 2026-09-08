import fs from 'node:fs'
import path from 'node:path'
import { create, openSync } from 'fontkit'
import type { Font, FontCollection } from 'fontkit'
import { FONT_EXTENSIONS, WEB_FONT_EXTENSIONS, type FontAxisInfo, type FontFaceInfo, type NamedInstanceInfo } from './types.ts'

export function isFontFile(filePath: string): boolean {
  return FONT_EXTENSIONS.includes(
    path.extname(filePath).toLowerCase() as (typeof FONT_EXTENSIONS)[number],
  )
}

export function isPreviewableFontFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return (
    isFontFile(filePath) ||
    WEB_FONT_EXTENSIONS.includes(ext as (typeof WEB_FONT_EXTENSIONS)[number])
  )
}

function isCollection(font: Font | FontCollection): font is FontCollection {
  return 'fonts' in font && Array.isArray((font as FontCollection).fonts)
}

function namedInstancesOf(font: Font): NamedInstanceInfo[] {
  const named =
    (font as Font & { namedVariations?: Record<string, Record<string, number>> }).namedVariations ??
    {}
  return Object.entries(named).map(([name, coordinates]) => ({
    name,
    coordinates: Object.fromEntries(
      Object.entries(coordinates ?? {}).map(([tag, value]) => [tag, Number(value)]),
    ),
  }))
}

function namedInstanceCount(font: Font): { count: number; names: string[] } {
  const names = namedInstancesOf(font).map((item) => item.name)
  return { count: Math.max(names.length, 1), names }
}

function englishOrFirst(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const map = value as Record<string, unknown>
  const preferred = map.en
  if (typeof preferred === 'string' && preferred.trim()) {
    return preferred
  }
  for (const item of Object.values(map)) {
    if (typeof item === 'string' && item.trim()) {
      return item
    }
  }
  return undefined
}

export function resolveFamilyNames(input: {
  familyName?: string | null
  subfamilyName?: string | null
  preferredFamily?: string
  preferredSubfamily?: string
}): { familyName: string; styleName: string } {
  return {
    familyName: input.preferredFamily?.trim() || input.familyName?.trim() || 'Unknown',
    styleName: input.preferredSubfamily?.trim() || input.subfamilyName?.trim() || 'Regular',
  }
}

function faceFromFont(font: Font): FontFaceInfo {
  const axes = font.variationAxes ?? {}
  const isVariable = Object.keys(axes).length > 0
  const instances = isVariable
    ? namedInstanceCount(font)
    : { count: 1, names: [] }
  const os2 = font['OS/2']
  const italicAngle = font.italicAngle ?? 0
  const records = (
    font as Font & { name?: { records?: Record<string, unknown> } }
  ).name?.records
  const { familyName, styleName } = resolveFamilyNames({
    familyName: font.familyName,
    subfamilyName: font.subfamilyName,
    preferredFamily: englishOrFirst(records?.preferredFamily),
    preferredSubfamily: englishOrFirst(records?.preferredSubfamily),
  })

  return {
    familyName,
    styleName,
    fullName: font.fullName || `${familyName} ${styleName}`,
    postscriptName: font.postscriptName || '',
    isVariable,
    instanceCount: isVariable ? instances.count : 1,
    instanceNames: instances.names,
    namedInstances: isVariable ? namedInstancesOf(font) : undefined,
    weight: os2?.usWeightClass ?? 400,
    italic: Math.abs(italicAngle) > 1 || /italic|oblique/i.test(styleName),
  }
}

export type ParsedFont = {
  faces: FontFaceInfo[]
  format: string
  axes?: FontAxisInfo[]
  namedInstances?: NamedInstanceInfo[]
  features?: string[]
  characterSet?: number[]
}

export type ParseFontOptions = {
  /** When true, also read cmap/features/axes. Catalog import only needs faces. */
  previewMeta?: boolean
}

export function parseFontFile(filePath: string, options?: ParseFontOptions): ParsedFont {
  const opened = openSync(filePath)
  return parseOpened(opened, path.extname(filePath).slice(1).toLowerCase(), options)
}

export function parseFontBuffer(buffer: Buffer, formatHint = 'ttf', options?: ParseFontOptions): ParsedFont {
  const opened = create(buffer)
  return parseOpened(opened, formatHint, options)
}

export function glyphNameForCodePoint(filePath: string, code: number): string | null {
  if (!Number.isInteger(code) || code < 0) return null
  const opened = openSync(filePath)
  const font = isCollection(opened) ? opened.fonts[0] : opened
  if (!font) return null
  const glyph = (
    font as Font & { glyphForCodePoint?: (value: number) => { name?: string } }
  ).glyphForCodePoint?.(code)
  const name = glyph?.name?.trim()
  if (!name || name === '.notdef') return null
  return name
}

function parseOpened(opened: Font | FontCollection, format: string, options?: ParseFontOptions): ParsedFont {
  const preview = options?.previewMeta
  if (isCollection(opened)) {
    const first = opened.fonts[0]
    return {
      format: format || 'ttc',
      faces: opened.fonts.map((font) => faceFromFont(font)),
      ...(preview ? previewMetaFromFont(first) : {}),
    }
  }
  const detected = opened.type?.toLowerCase()
  return {
    format: detected === 'woff' || detected === 'woff2' ? detected : format || 'ttf',
    faces: [faceFromFont(opened)],
    ...(preview ? previewMetaFromFont(opened) : {}),
  }
}

function previewMetaFromFont(font?: Font): Pick<ParsedFont, 'axes' | 'namedInstances' | 'features' | 'characterSet'> {
  if (!font) return {}
  const axes = Object.entries(font.variationAxes ?? {}).map(([tag, axis]) => ({
    tag,
    name: axis.name || tag,
    min: axis.min,
    default: axis.default,
    max: axis.max,
  }))
  const namedInstances = namedInstancesOf(font)
  const features = [...new Set((font.availableFeatures ?? []).map((tag) => String(tag)))]
  const characterSet = Array.isArray(font.characterSet) ? [...font.characterSet] : []
  return { axes, namedInstances, features, characterSet }
}

export function missingCodePoints(text: string, characterSet: number[] | undefined): number[] {
  if (!characterSet || characterSet.length === 0) return []
  const available = new Set(characterSet)
  const missing: number[] = []
  const seen = new Set<number>()
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code === undefined) continue
    if (code <= 32) continue
    if (available.has(code) || seen.has(code)) continue
    seen.add(code)
    missing.push(code)
  }
  return missing
}

export function readFileStat(filePath: string): { mtimeMs: number; size: number } {
  const stat = fs.statSync(filePath)
  return { mtimeMs: stat.mtimeMs, size: stat.size }
}

export function mimeForFont(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.otf':
      return 'font/otf'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttc':
    case '.otc':
      return 'font/collection'
    default:
      return 'font/ttf'
  }
}

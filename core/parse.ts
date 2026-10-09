import fs from 'node:fs'
import path from 'node:path'
import { create, openSync } from 'fontkit'
import type { Font, FontCollection } from 'fontkit'
import {
  DEFAULT_PREVIEW_SAMPLE,
  PREVIEW_PROBE_CODE_POINTS,
  previewSampleFromCoverage,
} from '../shared/previewSample.ts'
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

type FvarAxis = { axisTag?: string }
type FvarInstance = {
  name?: { en?: string } | string | null
  coord?: Array<number | undefined>
}

const WEIGHT_INSTANCE_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'Heavy',
  900: 'Black',
}

function instanceDisplayName(
  name: FvarInstance['name'],
  coordinates: Record<string, number>,
  index: number,
): string {
  if (typeof name === 'string' && name.trim()) return name.trim()
  if (name && typeof name === 'object') {
    const labeled = englishOrFirst(name)
    if (labeled) return labeled
  }
  const wght = coordinates.wght
  if (Number.isFinite(wght)) {
    const named = WEIGHT_INSTANCE_NAMES[Math.round(Number(wght) / 100) * 100]
    if (named) return named
  }
  return `Instance ${index + 1}`
}

function namedInstancesFromFvar(font: Font): NamedInstanceInfo[] | undefined {
  const fvar = (font as Font & { fvar?: { axis?: FvarAxis[]; instance?: FvarInstance[] } }).fvar
  if (!fvar?.instance) return undefined
  const axes = fvar.axis ?? []
  return fvar.instance.map((instance, index) => {
    const coordinates: Record<string, number> = {}
    for (let i = 0; i < axes.length; i++) {
      const tag = axes[i]?.axisTag?.trim()
      const value = instance.coord?.[i]
      if (tag && Number.isFinite(value)) coordinates[tag] = Number(value)
    }
    return {
      name: instanceDisplayName(instance.name, coordinates, index),
      coordinates,
    }
  })
}

function namedInstancesOf(font: Font): NamedInstanceInfo[] {
  const fromFvar = namedInstancesFromFvar(font)
  if (fromFvar) return fromFvar
  try {
    const named =
      (font as Font & { namedVariations?: Record<string, Record<string, number>> }).namedVariations ??
      {}
    return Object.entries(named).map(([name, coordinates]) => ({
      name,
      coordinates: Object.fromEntries(
        Object.entries(coordinates ?? {}).map(([tag, value]) => [tag, Number(value)]),
      ),
    }))
  } catch {
    // fontkit's namedVariations getter throws when an fvar instance has no name record.
    return []
  }
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
  previewSample?: string
}

export type ParseFontOptions = {
  /** When true, also read cmap/features/axes. Catalog import only needs faces. */
  previewMeta?: boolean
  /**
   * When false, skip cmap probing so callers can paint faces first and fill
   * `previewSample` in a second pass without reopening the file.
   */
  previewSample?: boolean
}

export type FontParseSession = {
  parsed: ParsedFont
  completePreview(): ParsedFont
}

export function beginParseFontFile(filePath: string, options?: ParseFontOptions): FontParseSession {
  const opened = openSync(filePath)
  const parsed = parseOpened(opened, path.extname(filePath).slice(1).toLowerCase(), {
    ...options,
    previewSample: false,
    previewMeta: false,
  })
  let completed = false
  return {
    parsed,
    completePreview() {
      if (completed) return parsed
      completed = true
      const font = isCollection(opened) ? opened.fonts[0] : opened
      parsed.previewSample = previewSampleFromFont(font)
      if (options?.previewMeta) Object.assign(parsed, previewMetaFromFont(font))
      return parsed
    },
  }
}

export function parseFontFile(filePath: string, options?: ParseFontOptions): ParsedFont {
  const session = beginParseFontFile(filePath, options)
  if (options?.previewSample === false && !options.previewMeta) {
    return session.parsed
  }
  return session.completePreview()
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

function fontCoversCodePoint(font: Font, code: number): boolean {
  const hasGlyph = (font as Font & { hasGlyphForCodePoint?: (value: number) => boolean }).hasGlyphForCodePoint
  if (typeof hasGlyph !== 'function') return false
  try {
    return Boolean(hasGlyph.call(font, code))
  } catch {
    return false
  }
}

function previewSampleFromFont(font?: Font): string {
  if (!font) return DEFAULT_PREVIEW_SAMPLE
  const probed = new Set<number>()
  for (const code of PREVIEW_PROBE_CODE_POINTS) {
    if (fontCoversCodePoint(font, code)) probed.add(code)
  }
  const sample = previewSampleFromCoverage(probed)
  if (sample !== DEFAULT_PREVIEW_SAMPLE || probed.has(0x41) || probed.has(0x61)) {
    return sample
  }
  const full = Array.isArray(font.characterSet) ? font.characterSet : []
  if (full.length === 0) return sample
  return previewSampleFromCoverage(full)
}

export function applyParsedFont(
  target: { faces: FontFaceInfo[]; format: string; previewSample?: string },
  parsed: ParsedFont,
): void {
  target.faces = parsed.faces
  target.format = parsed.format
  if (parsed.previewSample) target.previewSample = parsed.previewSample
}

function parseOpened(opened: Font | FontCollection, format: string, options?: ParseFontOptions): ParsedFont {
  const preview = options?.previewMeta
  const wantSample = options?.previewSample !== false
  if (isCollection(opened)) {
    const first = opened.fonts[0]
    return {
      format: format || 'ttc',
      faces: opened.fonts.map((font) => faceFromFont(font)),
      ...(wantSample ? { previewSample: previewSampleFromFont(first) } : {}),
      ...(preview && wantSample ? previewMetaFromFont(first) : {}),
    }
  }
  const detected = opened.type?.toLowerCase()
  return {
    format: detected === 'woff' || detected === 'woff2' ? detected : format || 'ttf',
    faces: [faceFromFont(opened)],
    ...(wantSample ? { previewSample: previewSampleFromFont(opened) } : {}),
    ...(preview && wantSample ? previewMetaFromFont(opened) : {}),
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

const SFNT_TRUE = 0x00010000
const SFNT_OTTO = 0x4f54544f
const SFNT_TRUE_TAG = 0x74727565
const SFNT_TYP1 = 0x74797031
const SFNT_TTCF = 0x74746366
const SFNT_HEAD = 0x68656164
/** Real fonts pad the last table to a 4-byte boundary, which can sit past EOF by up to 3 bytes. */
const SFNT_LAST_TABLE_EOF_SLACK = 3

export type SfntTableCheck =
  | { ok: true }
  | { ok: false; reason: string }

function sfntTagName(tag: number): string {
  return String.fromCharCode((tag >>> 24) & 0xff, (tag >>> 16) & 0xff, (tag >>> 8) & 0xff, tag & 0xff)
}

function isSfntFlavor(scaler: number): boolean {
  return (
    scaler === SFNT_TRUE ||
    scaler === SFNT_OTTO ||
    scaler === SFNT_TRUE_TAG ||
    scaler === SFNT_TYP1
  )
}

function readExact(fd: number, size: number, position: number): Buffer | undefined {
  if (size < 0 || position < 0) return undefined
  const buffer = Buffer.alloc(size)
  const read = fs.readSync(fd, buffer, 0, size, position)
  return read === size ? buffer : undefined
}

type SfntTableSpan = { tag: number; offset: number; length: number; end: number }

function rejectTables(fileSize: number, tables: SfntTableSpan[]): SfntTableCheck {
  let maxEnd = 0
  for (const table of tables) {
    if (table.length > 0 && table.end > maxEnd) maxEnd = table.end
  }
  for (const table of tables) {
    if (table.length === 0) continue
    const name = sfntTagName(table.tag)
    if (table.offset > fileSize) {
      return { ok: false, reason: `The ${name} table starts past the end of the file.` }
    }
    const overrun = table.end - fileSize
    if (overrun <= 0) continue
    if (table.end === maxEnd && overrun <= SFNT_LAST_TABLE_EOF_SLACK) continue
    return { ok: false, reason: `The ${name} table extends past the end of the file.` }
  }
  return { ok: true }
}

/** True when every sfnt table sits inside the file and `head` is not still zero-filled. */
function sfntDirectoryFits(fd: number, fileSize: number, offset: number): SfntTableCheck {
  if (offset < 0 || fileSize - offset < 12) {
    return { ok: false, reason: 'The font file is shorter than an sfnt header.' }
  }
  const header = readExact(fd, 12, offset)
  if (!header) return { ok: false, reason: 'The font file is shorter than an sfnt header.' }
  const scaler = header.readUInt32BE(0)
  if (!isSfntFlavor(scaler)) {
    return { ok: false, reason: 'The font file is not a complete sfnt.' }
  }
  const numTables = header.readUInt16BE(4)
  const directoryBytes = numTables * 16
  if (numTables === 0 || fileSize - offset < 12 + directoryBytes) {
    return { ok: false, reason: "The font's table directory extends past the end of the file." }
  }
  const directory = readExact(fd, directoryBytes, offset + 12)
  if (!directory) {
    return { ok: false, reason: "The font's table directory extends past the end of the file." }
  }
  const tables: SfntTableSpan[] = []
  for (let index = 0; index < numTables; index += 1) {
    const base = index * 16
    const tag = directory.readUInt32BE(base)
    const tableOffset = directory.readUInt32BE(base + 8)
    const length = directory.readUInt32BE(base + 12)
    tables.push({ tag, offset: tableOffset, length, end: tableOffset + length })
  }
  const bounds = rejectTables(fileSize, tables)
  if (!bounds.ok) return bounds
  for (const table of tables) {
    if (table.tag !== SFNT_HEAD || table.length < 16) continue
    const magic = readExact(fd, 4, table.offset + 12)
    if (!magic || magic.readUInt32BE(0) === 0) {
      return { ok: false, reason: 'The head table is still zero-filled.' }
    }
  }
  return { ok: true }
}

function collectionTablesFit(fd: number, fileSize: number): SfntTableCheck {
  const header = readExact(fd, 12, 0)
  if (!header) return { ok: false, reason: 'The font collection is shorter than its header.' }
  const numFonts = header.readUInt32BE(8)
  const offsetBytes = numFonts * 4
  if (numFonts === 0 || numFonts > 1024 || fileSize < 12 + offsetBytes) {
    return { ok: false, reason: 'The font collection directory extends past the end of the file.' }
  }
  const offsets = readExact(fd, offsetBytes, 12)
  if (!offsets) {
    return { ok: false, reason: 'The font collection directory extends past the end of the file.' }
  }
  for (let index = 0; index < numFonts; index += 1) {
    const fit = sfntDirectoryFits(fd, fileSize, offsets.readUInt32BE(index * 4))
    if (!fit.ok) return fit
  }
  return { ok: true }
}

/**
 * Why an sfnt file cannot be imported yet, or `ok` when it is not an sfnt container.
 * Web fonts are not sfnt containers and return ok so the normal parser decides.
 * The last table may extend up to 3 bytes past EOF for alignment padding.
 */
export function inspectSfntTables(filePath: string): SfntTableCheck {
  let fd: number | undefined
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size < 12) {
      return { ok: false, reason: 'The font file is shorter than an sfnt header.' }
    }
    fd = fs.openSync(filePath, 'r')
    const header = readExact(fd, 12, 0)
    if (!header) return { ok: false, reason: 'The font file is shorter than an sfnt header.' }
    const scaler = header.readUInt32BE(0)
    if (scaler === SFNT_TTCF) return collectionTablesFit(fd, stat.size)
    if (!isSfntFlavor(scaler)) return { ok: true }
    return sfntDirectoryFits(fd, stat.size, 0)
  } catch {
    return { ok: false, reason: 'Could not read the font file.' }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/** True when `inspectSfntTables` does not reject the file. */
export function sfntTablesFit(filePath: string): boolean {
  return inspectSfntTables(filePath).ok
}

export function existingFontPath(
  entry: {
    id?: string
    installedPath?: string
    disabledPath?: string
    sourcePath?: string
    status?: string
  },
  catalog: Array<{
    id?: string
    status?: string
    installedPath?: string
    disabledPath?: string
    installations?: Array<{ path?: string; parkedPath?: string }>
  }> = [],
): string | undefined {
  const live = entry.installedPath
  const liveOwned =
    live &&
    fs.existsSync(live) &&
    (entry.status === 'installed' || entry.status === 'outdated') &&
    !catalog.some((other) => {
      if (!entry.id || other.id === entry.id) return false
      if (other.status !== 'installed' && other.status !== 'outdated') return false
      const pathsToCheck = [
        other.installedPath,
        ...(other.installations ?? []).filter((copy) => !copy.parkedPath).map((copy) => copy.path),
      ]
      return pathsToCheck.some((candidate) => candidate && path.resolve(candidate) === path.resolve(live))
    })
  for (const file of [liveOwned ? live : undefined, entry.disabledPath, entry.sourcePath]) {
    if (file && fs.existsSync(file)) return file
  }
}

function isExistingFontFile(filePath?: string): boolean {
  if (!filePath) return false
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * True when catalog cards still paint a managed/parked file that exists on disk.
 * Catalog path fields alone are not enough: `verification: unavailable` or a missing
 * copy means `existingManagedFontPath()` falls through to source bytes.
 */
export function previewUsesInstalledBytes(entry: {
  installedPath?: string
  disabledPath?: string
  installations?: Array<{
    path?: string
    parkedPath?: string
    verification?: 'file-present' | 'unavailable'
  }>
}): boolean {
  if (isExistingFontFile(entry.installedPath) || isExistingFontFile(entry.disabledPath)) {
    return true
  }
  return Boolean(
    entry.installations?.some(
      (copy) =>
        isExistingFontFile(copy.parkedPath) ||
        (copy.verification !== 'unavailable' && isExistingFontFile(copy.path)),
    ),
  )
}

export function fillEntryPreviewSample(
  entry: {
    previewSample?: string
    installedPath?: string
    disabledPath?: string
    sourcePath?: string
  },
  options?: { refresh?: boolean; sample?: string },
): boolean {
  if (entry.previewSample && !options?.refresh) return false
  const file = existingFontPath(entry)
  if (!file) return false
  try {
    const sample = options?.sample ?? parseFontFile(file).previewSample
    if (!sample || sample === entry.previewSample) return false
    entry.previewSample = sample
    return true
  } catch {
    return false
  }
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

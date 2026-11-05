import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import type { CatalogEntry, FontFaceInfo } from './types.ts'

/**
 * Read font names from a PDF, IDML, InDesign, Illustrator, Photoshop, Word, or
 * PowerPoint file and classify each against the catalog. This does not create
 * or update projects.
 *
 * InDesign (.indd, .indt) uses the xmpTPg:Fonts list in the file's XMP.
 * Illustrator (.ai) uses that list plus the PDF font resources, when the file
 * was saved with PDF compatibility. Photoshop (.psd, .psb) uses the PostScript
 * names its text layers actually set. These are the readers in Cicero's
 * DocumentFonts.swift and PhotoshopFonts.swift. A font the file does not name
 * is left out.
 *
 * {@link documentProjectDraft} turns this report into project members.
 * Unique asset ids are the members, `installedFingerprint` is the pin when it
 * is present, and `missing` rows are unresolved names for `path` (never members).
 * `installedFingerprint` is set only when the matched face is the active copy and
 * the pin would be the cut named by the document's PostScript name. A family+style
 * fallback that lands on a different PostScript name stays unpinned.
 *
 * `.docx` and `.pptx` are zip packages. Names come from `w:rFonts` and from
 * `a:latin`, `a:cs`, and `a:ea` typefaces. Office usually stores a family name.
 * An exact PostScript name still pins that cut. A family with one style pins
 * that style. A family with several styles is listed as matched and is not pinned.
 */

export type DocumentFontStatus = 'on' | 'in-library-off' | 'missing'

export type DocumentFontMatchKind = 'postscript' | 'family-style' | 'family'

export type DocumentFontRequest = {
  /** Document PostScript name with a subset prefix removed. Empty when the file only named a family. */
  postscriptName: string
  /** Document family. Empty for PDF, which only stores BaseFont. */
  familyName: string
  /** Document style. Empty for PDF and for an Office family name. */
  styleName: string
  status: DocumentFontStatus
  /** Catalog entry id when one face matched. */
  assetId?: string
  /**
   * Every catalog asset when an Office family name matched several styles.
   * No single style is chosen, and `installedFingerprint` stays empty.
   */
  assetIds?: string[]
  /**
   * Installed fingerprint to pin, when the face is on and the pin is this cut.
   * Absent for missing names, library faces that are off, a family+style match
   * whose PostScript name is a different cut, and a multi-style family match.
   */
  installedFingerprint?: string
  matchedBy?: DocumentFontMatchKind
}

export type DocumentFontReport = {
  path: string
  kind: 'pdf' | 'idml' | 'docx' | 'pptx' | 'indd' | 'ai' | 'psd'
  fonts: DocumentFontRequest[]
}

type ParsedFont = {
  postscriptName: string
  familyName: string
  styleName: string
  /** Office typeface. Match the family, and do not pick a style when several exist. */
  officeFamily?: boolean
}

type FaceRef = {
  entry: CatalogEntry
  face: FontFaceInfo
  /** True when this row is indexed under `customFamilyName` rather than the face's own family. */
  alias: boolean
}

const MAX_INFLATE_BYTES = 32 * 1024 * 1024
const BASE_FONT = Buffer.from('/BaseFont')

export function reportDocumentFonts(
  filePath: string,
  entries: readonly CatalogEntry[] | (() => readonly CatalogEntry[]),
): DocumentFontReport {
  const resolved = path.resolve(filePath)
  const kind = documentKind(resolved)
  if (!fs.existsSync(resolved)) {
    throw new Error('File not found.')
  }
  const stat = fs.statSync(resolved)
  if (!stat.isFile()) {
    throw new Error('Path is not a file.')
  }
  const buffer = fs.readFileSync(resolved)
  const requests = fontRequests(kind, buffer)
  const catalog = typeof entries === 'function' ? entries() : entries
  return {
    path: resolved,
    kind,
    fonts: matchFonts(requests, catalog),
  }
}

function documentKind(filePath: string): DocumentFontReport['kind'] {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.ai') return 'ai'
  if (ext === '.idml') return 'idml'
  if (ext === '.indd' || ext === '.indt') return 'indd'
  if (ext === '.psd' || ext === '.psb') return 'psd'
  if (ext === '.docx') return 'docx'
  if (ext === '.pptx') return 'pptx'
  throw new Error(
    'Document fonts can be read from PDF, IDML, InDesign, Illustrator, Photoshop, Word, and PowerPoint files.',
  )
}

function fontRequests(kind: DocumentFontReport['kind'], buffer: Buffer): ParsedFont[] {
  switch (kind) {
    case 'pdf':
      return pdfFontRequests(buffer)
    case 'ai':
      return aiFontRequests(buffer)
    case 'idml':
      return idmlFontRequests(buffer)
    case 'indd':
      return inddFontRequests(buffer)
    case 'psd':
      return photoshopFontRequests(buffer)
    case 'docx':
    case 'pptx':
      return officeFontRequests(buffer, kind)
  }
}

function matchFonts(requests: readonly ParsedFont[], entries: readonly CatalogEntry[]): DocumentFontRequest[] {
  const index = buildIndex(entries)
  const seen = new Set<string>()
  const fonts: DocumentFontRequest[] = []
  for (const request of requests) {
    const key = requestKey(request)
    if (seen.has(key)) continue
    seen.add(key)
    fonts.push(...classifyRequest(request, index))
  }
  return fonts
}

function classifyRequest(request: ParsedFont, index: CatalogIndex): DocumentFontRequest[] {
  if (request.officeFamily) return classifyOfficeFamily(request.familyName, index)
  return [classify(request, index)]
}

function requestKey(request: ParsedFont): string {
  return [
    request.postscriptName.trim().toLowerCase(),
    normalizeName(request.familyName),
    normalizeName(request.styleName),
  ].join('\0')
}

function classify(request: ParsedFont, index: CatalogIndex): DocumentFontRequest {
  const postscriptName = request.postscriptName.trim()
  const familyName = request.familyName.trim()
  const styleName = request.styleName.trim()
  const byPostScript = postscriptName ? choosePostScript(postscriptName, index) : undefined
  if (byPostScript) {
    return toRequest({ postscriptName, familyName, styleName }, byPostScript, 'postscript')
  }
  const byFamily = familyName ? chooseFamilyStyle(familyName, styleName, index) : undefined
  if (byFamily) {
    return toRequest({ postscriptName, familyName, styleName }, byFamily, 'family-style')
  }
  return { postscriptName, familyName, styleName, status: 'missing' }
}

function toRequest(
  request: ParsedFont,
  ref: FaceRef,
  matchedBy: DocumentFontMatchKind,
): DocumentFontRequest {
  const result: DocumentFontRequest = {
    postscriptName: request.postscriptName,
    familyName: request.familyName,
    styleName: request.styleName,
    status: faceIsOn(ref.entry) ? 'on' : 'in-library-off',
    assetId: ref.entry.id,
    matchedBy,
  }
  const fingerprint = pinnableFingerprint(request, ref, matchedBy)
  if (fingerprint) result.installedFingerprint = fingerprint
  return result
}

function faceIsOn(entry: CatalogEntry): boolean {
  return entry.status === 'installed' || entry.status === 'outdated'
}

function pinnableFingerprint(
  request: ParsedFont,
  ref: FaceRef,
  matchedBy: DocumentFontMatchKind,
): string | undefined {
  if (!faceIsOn(ref.entry)) return undefined
  const fingerprint = ref.entry.installedFingerprint?.trim()
  if (!fingerprint) return undefined
  if (matchedBy === 'postscript') return fingerprint
  const requested = request.postscriptName.trim()
  if (!requested) return fingerprint
  if (requested.toLowerCase() === ref.face.postscriptName.trim().toLowerCase()) return fingerprint
  return undefined
}

type CatalogIndex = {
  byPostScript: Map<string, FaceRef[]>
  byFamilyStyle: Map<string, FaceRef[]>
  byFamily: Map<string, FaceRef[]>
}

function buildIndex(entries: readonly CatalogEntry[]): CatalogIndex {
  const index: CatalogIndex = {
    byPostScript: new Map(),
    byFamilyStyle: new Map(),
    byFamily: new Map(),
  }
  for (const entry of entries) {
    for (const face of entry.faces) {
      const ref: FaceRef = { entry, face, alias: false }
      const postscript = face.postscriptName.trim()
      if (postscript) pushRef(index.byPostScript, postscript.toLowerCase(), ref)
      const family = normalizeName(face.familyName)
      const style = normalizeName(face.styleName)
      if (family) {
        pushRef(index.byFamily, family, ref)
        pushRef(index.byFamilyStyle, familyStyleKey(family, style), ref)
      }
      const custom = normalizeName(entry.customFamilyName ?? '')
      if (custom && custom !== family) {
        const alias: FaceRef = { entry, face, alias: true }
        pushRef(index.byFamily, custom, alias)
        pushRef(index.byFamilyStyle, familyStyleKey(custom, style), alias)
      }
    }
  }
  return index
}

function pushRef(map: Map<string, FaceRef[]>, key: string, ref: FaceRef): void {
  const list = map.get(key)
  if (list) list.push(ref)
  else map.set(key, [ref])
}

function familyStyleKey(family: string, style: string): string {
  return `${family}\0${style}`
}

/**
 * An Office typeface is usually a family name. An exact PostScript name still
 * wins. One style in the family is that style. Several styles stay a family
 * match: every asset is listed, and none is pinned.
 */
function classifyOfficeFamily(name: string, index: CatalogIndex): DocumentFontRequest[] {
  const familyName = name.trim()
  if (!familyName) return []
  const byPostScript = choosePostScript(familyName, index)
  if (byPostScript) {
    return [toRequest({ postscriptName: familyName, familyName: '', styleName: '' }, byPostScript, 'postscript')]
  }
  const assets = familyAssets(familyName, index)
  if (assets.length === 0) {
    return [{ postscriptName: '', familyName, styleName: '', status: 'missing' }]
  }
  if (assets.length === 1) {
    const only = assets[0]
    if (!only) return [{ postscriptName: '', familyName, styleName: '', status: 'missing' }]
    return [toRequest({ postscriptName: '', familyName, styleName: '' }, only, 'family-style')]
  }
  const on: string[] = []
  const off: string[] = []
  for (const ref of assets) {
    const bucket = faceIsOn(ref.entry) ? on : off
    bucket.push(ref.entry.id)
  }
  const rows: DocumentFontRequest[] = []
  if (on.length > 0) {
    rows.push({
      postscriptName: '',
      familyName,
      styleName: '',
      status: 'on',
      assetIds: on,
      matchedBy: 'family',
    })
  }
  if (off.length > 0) {
    rows.push({
      postscriptName: '',
      familyName,
      styleName: '',
      status: 'in-library-off',
      assetIds: off,
      matchedBy: 'family',
    })
  }
  return rows
}

function familyAssets(family: string, index: CatalogIndex): FaceRef[] {
  const familyKey = normalizeName(family)
  if (!familyKey) return []
  const refs = index.byFamily.get(familyKey) ?? []
  const real = refs.filter((ref) => !ref.alias)
  const pool = real.length > 0 ? real : refs
  const byId = new Map<string, FaceRef>()
  for (const ref of pool) {
    const previous = byId.get(ref.entry.id)
    if (!previous || (faceIsOn(ref.entry) && !faceIsOn(previous.entry))) byId.set(ref.entry.id, ref)
  }
  return [...byId.values()]
}

function choosePostScript(name: string, index: CatalogIndex): FaceRef | undefined {
  const refs = index.byPostScript.get(name.toLowerCase())
  if (!refs?.length) return undefined
  return choose(refs, (ref) => ref.face.postscriptName === name)
}

function chooseFamilyStyle(family: string, style: string, index: CatalogIndex): FaceRef | undefined {
  const familyKey = normalizeName(family)
  if (!familyKey) return undefined
  const styleKey = normalizeName(style)
  if (!styleKey) {
    const only = index.byFamily.get(familyKey) ?? []
    return only.length === 1 ? only[0] : undefined
  }
  const refs = index.byFamilyStyle.get(familyStyleKey(familyKey, styleKey))
  if (!refs?.length) return undefined
  return choose(refs, (ref) => normalizeName(ref.face.familyName) === familyKey && !ref.alias)
}

function choose(refs: readonly FaceRef[], exact: (ref: FaceRef) => boolean): FaceRef | undefined {
  const exactRefs = refs.filter(exact)
  const pool = exactRefs.length > 0 ? exactRefs : refs
  const real = pool.filter((ref) => !ref.alias)
  const narrowed = real.length > 0 ? real : pool
  return narrowed.find((ref) => faceIsOn(ref.entry)) ?? narrowed[0]
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function pdfFontRequests(buffer: Buffer): ParsedFont[] {
  const names: string[] = []
  const seen = new Set<string>()
  const visit = (chunk: Buffer, depth: number): void => {
    for (const name of baseFontNames(chunk)) {
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      names.push(name)
    }
    if (depth >= 2) return
    for (const inflated of flatePayloads(chunk)) visit(inflated, depth + 1)
  }
  visit(buffer, 0)
  return names.map((postscriptName) => ({ postscriptName, familyName: '', styleName: '' }))
}

function baseFontNames(buffer: Buffer): string[] {
  const names: string[] = []
  let from = 0
  while (from < buffer.length) {
    const at = buffer.indexOf(BASE_FONT, from)
    if (at < 0) break
    let cursor = at + BASE_FONT.length
    while (cursor < buffer.length && isPdfWhitespace(buffer[cursor]!)) cursor += 1
    if (buffer[cursor] !== 0x2f) {
      from = at + BASE_FONT.length
      continue
    }
    cursor += 1
    const start = cursor
    while (cursor < buffer.length && isPdfNameByte(buffer[cursor]!)) cursor += 1
    const decoded = stripSubsetPrefix(decodePdfName(buffer.toString('latin1', start, cursor))).trim()
    if (isFontToken(decoded)) names.push(decoded)
    from = Math.max(cursor, at + BASE_FONT.length)
  }
  return names
}

/** Adobe subset tags are six uppercase letters and a plus: `ABCDEF+Family-Bold`. */
function stripSubsetPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '')
}

function decodePdfName(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
}

function isFontToken(name: string): boolean {
  return name.length > 0 && name.length <= 127 && /^[\u0020-\u007e]+$/.test(name)
}

function isPdfWhitespace(byte: number): boolean {
  return byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20
}

function isPdfDelimiter(byte: number): boolean {
  return (
    byte === 0x28 ||
    byte === 0x29 ||
    byte === 0x3c ||
    byte === 0x3e ||
    byte === 0x5b ||
    byte === 0x5d ||
    byte === 0x7b ||
    byte === 0x7d ||
    byte === 0x2f ||
    byte === 0x25
  )
}

function isPdfNameByte(byte: number): boolean {
  return byte > 0x20 && byte < 0x7f && !isPdfDelimiter(byte)
}

function flatePayloads(buffer: Buffer): Buffer[] {
  const payloads: Buffer[] = []
  let from = 0
  while (from + 6 < buffer.length) {
    const at = buffer.indexOf('stream', from)
    if (at < 0) break
    if (!isStreamKeyword(buffer, at)) {
      from = at + 6
      continue
    }
    const dict = dictBefore(buffer, at)
    const dataStart = streamDataStart(buffer, at)
    if (!dict || dataStart === null || !isSoleFlate(dict)) {
      from = at + 6
      continue
    }
    const length = directLength(dict)
    let dataEnd = dataStart
    if (length !== null && dataStart + length <= buffer.length) {
      dataEnd = dataStart + length
    } else {
      const end = buffer.indexOf('endstream', dataStart)
      if (end < 0) break
      dataEnd = trimStreamEnd(buffer, dataStart, end)
    }
    const inflated = inflateZlib(buffer.subarray(dataStart, dataEnd))
    if (inflated) payloads.push(inflated)
    from = dataEnd
  }
  return payloads
}

function isStreamKeyword(buffer: Buffer, at: number): boolean {
  if (buffer.toString('latin1', at, at + 6) !== 'stream') return false
  const next = buffer[at + 6]
  if (next !== 0x0a && next !== 0x0d) return false
  let cursor = at - 1
  while (cursor >= 0 && isPdfWhitespace(buffer[cursor]!)) cursor -= 1
  return cursor > 0 && buffer[cursor] === 0x3e && buffer[cursor - 1] === 0x3e
}

function dictBefore(buffer: Buffer, streamAt: number): string {
  const start = Math.max(0, streamAt - 1500)
  const text = buffer.toString('latin1', start, streamAt)
  const close = text.lastIndexOf('>>')
  if (close < 0) return ''
  const open = text.lastIndexOf('<<', close)
  if (open < 0) return ''
  return text.slice(open, close + 2)
}

function streamDataStart(buffer: Buffer, streamAt: number): number | null {
  let cursor = streamAt + 6
  if (buffer[cursor] === 0x0d && buffer[cursor + 1] === 0x0a) return cursor + 2
  if (buffer[cursor] === 0x0a || buffer[cursor] === 0x0d) return cursor + 1
  return null
}

function directLength(dict: string): number | null {
  const match = /\/Length\s+(\d+)\b/.exec(dict)
  if (!match) return null
  const after = dict.slice((match.index ?? 0) + match[0].length)
  if (/^\s+\d+\s+R\b/.test(after)) return null
  const length = Number(match[1])
  return Number.isSafeInteger(length) ? length : null
}

function isSoleFlate(dict: string): boolean {
  if (!/\/FlateDecode\b/.test(dict)) return false
  return !/\/(?:ASCII85Decode|ASCIIHexDecode|LZWDecode|RunLengthDecode|CCITTFaxDecode|JBIG2Decode|DCTDecode|JPXDecode|Crypt)\b/.test(
    dict,
  )
}

function trimStreamEnd(buffer: Buffer, dataStart: number, end: number): number {
  let dataEnd = end
  if (dataEnd > dataStart && buffer[dataEnd - 1] === 0x0a) dataEnd -= 1
  if (dataEnd > dataStart && buffer[dataEnd - 1] === 0x0d) dataEnd -= 1
  return dataEnd
}

function inflateZlib(data: Buffer): Buffer | null {
  try {
    return zlib.inflateSync(data, { maxOutputLength: MAX_INFLATE_BYTES })
  } catch {
    try {
      return zlib.inflateRawSync(data, { maxOutputLength: MAX_INFLATE_BYTES })
    } catch {
      return null
    }
  }
}

function idmlFontRequests(buffer: Buffer): ParsedFont[] {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    return readZipXml(buffer, 'IDML file').flatMap((xml) => fontElements(xml))
  }
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
  if (text.includes('<Font')) return fontElements(text)
  throw new Error('Could not read that IDML file.')
}

const FONT_TAG = /<Font\b([^>]*)>/g

function fontElements(xml: string): ParsedFont[] {
  const fonts: ParsedFont[] = []
  for (const match of xml.matchAll(FONT_TAG)) {
    const attrs = match[1] ?? ''
    const postscriptName = cleanIdmlValue(xmlAttr(attrs, 'PostScriptName'))
    const familyName = cleanIdmlValue(xmlAttr(attrs, 'FontFamily'))
    const styleName = cleanIdmlValue(xmlAttr(attrs, 'FontStyleName'))
    if (!postscriptName && !familyName) continue
    fonts.push({ postscriptName, familyName, styleName })
  }
  return fonts
}

function cleanIdmlValue(value: string): string {
  const trimmed = value.trim()
  return trimmed === '$ID/' ? '' : trimmed
}

function xmlAttr(source: string, name: string): string {
  const match = new RegExp(`(?:^|[\\s])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(source)
  if (!match) return ''
  return decodeXml(match[1] ?? match[2] ?? '')
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const OFFICE_RFONTS = /<(?:[\w.-]+:)?rFonts\b([^>]*)>/g
const OFFICE_RUN_FACE =
  /(?:^|[\s])(?:[\w.-]+:)?(?:ascii|hAnsi|eastAsia|cs)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const OFFICE_DRAWING = /<(?:[\w.-]+:)?(?:latin|ea|cs)\b([^>]*)>/g

function officeFontRequests(buffer: Buffer, kind: 'docx' | 'pptx'): ParsedFont[] {
  const label = kind === 'docx' ? 'Word document' : 'PowerPoint file'
  if (!(buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50)) {
    throw new Error(`Could not read that ${label}.`)
  }
  const fonts: ParsedFont[] = []
  for (const xml of readZipXml(buffer, label)) {
    for (const familyName of officeTypefaces(xml)) {
      fonts.push({ postscriptName: '', familyName, styleName: '', officeFamily: true })
    }
  }
  return fonts
}

function officeTypefaces(xml: string): string[] {
  const names: string[] = []
  for (const match of xml.matchAll(OFFICE_RFONTS)) {
    const attrs = match[1] ?? ''
    for (const attr of attrs.matchAll(OFFICE_RUN_FACE)) {
      const name = officeFaceName(decodeXml(attr[1] ?? attr[2] ?? ''))
      if (name) names.push(name)
    }
  }
  for (const match of xml.matchAll(OFFICE_DRAWING)) {
    const name = officeFaceName(xmlAttr(match[1] ?? '', 'typeface'))
    if (name) names.push(name)
  }
  return names
}

/** Theme slots (`+mn-lt`) and blank typefaces are not font names. */
function officeFaceName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('+')) return ''
  return trimmed
}

function readZipXml(buffer: Buffer, label: string): string[] {
  const eocd = findEocd(buffer)
  if (eocd < 0) throw new Error(`Could not read that ${label}.`)
  const count = buffer.readUInt16LE(eocd + 10)
  let cursor = buffer.readUInt32LE(eocd + 16)
  if (count === 0xffff || cursor === 0xffffffff) {
    throw new Error(`Could not read that ${label}.`)
  }
  const texts: string[] = []
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Could not read that ${label}.`)
    }
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const nameStart = cursor + 46
    const name = buffer.toString('utf8', nameStart, nameStart + nameLength)
    cursor = nameStart + nameLength + extraLength + commentLength
    if (!name.toLowerCase().endsWith('.xml')) continue
    texts.push(readZipEntry(buffer, localOffset, method, compressedSize, label).toString('utf8'))
  }
  return texts
}

function findEocd(buffer: Buffer): number {
  if (buffer.length < 22) return -1
  const min = Math.max(0, buffer.length - 22 - 0xffff)
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return -1
}

function readZipEntry(
  buffer: Buffer,
  offset: number,
  method: number,
  compressedSize: number,
  label: string,
): Buffer {
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`Could not read that ${label}.`)
  }
  const flags = buffer.readUInt16LE(offset + 6)
  if ((flags & 0x1) !== 0) throw new Error(`Could not read that ${label}.`)
  const nameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + nameLength + extraLength
  const dataEnd = dataStart + compressedSize
  if (dataEnd > buffer.length) throw new Error(`Could not read that ${label}.`)
  const compressed = buffer.subarray(dataStart, dataEnd)
  if (method === 0) return Buffer.from(compressed)
  if (method === 8) {
    try {
      return zlib.inflateRawSync(compressed, { maxOutputLength: MAX_INFLATE_BYTES })
    } catch {
      throw new Error(`Could not read that ${label}.`)
    }
  }
  throw new Error(`Could not read that ${label}.`)
}

const XMP_START = Buffer.from('<x:xmpmeta')
const XMP_END = Buffer.from('</x:xmpmeta>')
const XMP_FONTS = Buffer.from('xmpTPg:Fonts')
const XMP_LI = /<rdf:li\b([^>]*?)(?:\/>|>([\s\S]*?)<\/rdf:li>)/g
const XMP_ATTR = /\bstFnt:(fontName|fontFamily|fontFace)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const XMP_ELEMENT = /<stFnt:(fontName|fontFamily|fontFace)\b[^>]*>([\s\S]*?)<\/stFnt:\1>/g

/** Illustrator: PDF font resources, then the XMP font list. One row per font. */
function aiFontRequests(buffer: Buffer): ParsedFont[] {
  const fromPdf = pdfFontRequests(buffer).map((font) => pdfNamedFont(font.postscriptName))
  return uniqueParsedFonts([...fromPdf, ...xmpFontRequests(buffer)])
}

/** InDesign and InDesign templates: the first XMP packet that lists fonts. */
function inddFontRequests(buffer: Buffer): ParsedFont[] {
  return uniqueParsedFonts(xmpFontRequests(buffer))
}

/**
 * Fonts in an XMP packet's xmpTPg:Fonts list. The first packet that has any wins.
 * Later packets, including fonts from a placed image, are left out.
 */
function xmpFontRequests(buffer: Buffer): ParsedFont[] {
  let from = 0
  while (from < buffer.length) {
    const open = buffer.indexOf(XMP_START, from)
    if (open < 0) break
    const close = buffer.indexOf(XMP_END, open + XMP_START.length)
    if (close < 0) break
    const packet = buffer.subarray(open, close + XMP_END.length)
    from = close + XMP_END.length
    if (!packet.includes(XMP_FONTS)) continue
    const fonts = xmpPacketFonts(packet.toString('utf8'))
    if (fonts.length > 0) return fonts
  }
  return []
}

function xmpPacketFonts(xml: string): ParsedFont[] {
  const sections = [...xml.matchAll(/<xmpTPg:Fonts\b[^>]*>([\s\S]*?)<\/xmpTPg:Fonts>/g)]
  const body = sections.map((section) => section[1] ?? '').join('\n')
  const fonts: ParsedFont[] = []
  for (const match of body.matchAll(XMP_LI)) {
    const fields = new Map<string, string>()
    for (const attr of (match[1] ?? '').matchAll(XMP_ATTR)) {
      fields.set(attr[1] ?? '', decodeXml(attr[2] ?? attr[3] ?? ''))
    }
    for (const element of (match[2] ?? '').matchAll(XMP_ELEMENT)) {
      fields.set(element[1] ?? '', decodeXml(element[2] ?? ''))
    }
    const postscriptName = trimmed(fields.get('fontName'))
    const familyName = trimmed(fields.get('fontFamily'))
    const styleName = trimmed(fields.get('fontFace'))
    if (!postscriptName && !familyName) continue
    fonts.push({ postscriptName, familyName, styleName })
  }
  return fonts
}

/** "MinionPro-Regular-Identity-H" is the composite font's name plus its encoding. */
function pdfNamedFont(name: string): ParsedFont {
  let base = name
  for (const suffix of ['-Identity-H', '-Identity-V']) {
    if (base.endsWith(suffix)) base = base.slice(0, -suffix.length)
  }
  const comma = base.indexOf(',')
  if (comma > 0) {
    return {
      postscriptName: base,
      familyName: base.slice(0, comma),
      styleName: base.slice(comma + 1),
    }
  }
  return { postscriptName: base, familyName: '', styleName: '' }
}

/** One row per PostScript name, or family and style when there is no PostScript name. */
function uniqueParsedFonts(fonts: readonly ParsedFont[]): ParsedFont[] {
  const result: ParsedFont[] = []
  const index = new Map<string, number>()
  for (const font of fonts) {
    const postscriptName = font.postscriptName.trim()
    const familyName = font.familyName.trim()
    const styleName = font.styleName.trim()
    const key = (postscriptName || `${familyName}|${styleName}`).toLowerCase()
    if (key === '|') continue
    const at = index.get(key)
    if (at === undefined) {
      index.set(key, result.length)
      result.push({
        postscriptName,
        familyName,
        styleName,
        officeFamily: font.officeFamily,
      })
      continue
    }
    const existing = result[at]
    if (!existing) continue
    if (!existing.familyName && familyName) existing.familyName = familyName
    if (!existing.styleName && styleName) existing.styleName = styleName
  }
  return result
}

function trimmed(value: string | undefined): string {
  return (value ?? '').trim()
}

const PSD_LONG_LAYER_KEYS = new Set([
  'LMsk',
  'Lr16',
  'Lr32',
  'Layr',
  'Mt16',
  'Mt32',
  'Mtrn',
  'Alph',
  'FMsk',
  'lnk2',
  'FEid',
  'FXid',
  'PxSD',
])

/** A Photoshop length that cannot be an offset in the file is ignored. */
const PSD_MAX_LENGTH = 2_147_483_647 * 1024

/**
 * Fonts a Photoshop text layer sets, by PostScript name. Reads layer records
 * only. Text inside a placed smart object is left out. AdobeInvisFont is not
 * a font the text is set in.
 */
function photoshopFontRequests(buffer: Buffer): ParsedFont[] {
  const reader = { buffer, offset: 0 }
  const signature = readBytes(reader, 4)
  const version = readUint(reader, 2)
  if (!signature || signature.toString('ascii') !== '8BPS' || (version !== 1 && version !== 2)) {
    throw new Error('Could not read that Photoshop file.')
  }
  const isLarge = version === 2
  skipBytes(reader, 20)
  for (let section = 0; section < 2; section += 1) {
    const length = readUint(reader, 4)
    if (length === null) throw new Error('Could not read that Photoshop file.')
    skipBytes(reader, length)
  }
  const sectionLength = readUint(reader, isLarge ? 8 : 4)
  const layerInfo = readUint(reader, isLarge ? 8 : 4)
  const count = readInt16(reader)
  if (sectionLength === null || layerInfo === null || layerInfo <= 0 || count === null) return []
  const fonts: ParsedFont[] = []
  for (let layer = 0; layer < Math.abs(count); layer += 1) {
    skipBytes(reader, 16)
    const channels = readUint(reader, 2)
    if (channels === null) break
    skipBytes(reader, channels * (2 + (isLarge ? 8 : 4)))
    skipBytes(reader, 12)
    const extra = readUint(reader, 4)
    if (extra === null) break
    const end = reader.offset + extra
    for (let block = 0; block < 2; block += 1) {
      const length = readUint(reader, 4)
      skipBytes(reader, length ?? extra)
    }
    const nameLength = readUint(reader, 1)
    if (nameLength === null) break
    skipBytes(reader, Math.floor((nameLength + 1 + 3) / 4) * 4 - 1)
    while (reader.offset + 12 <= end && reader.offset + 12 <= buffer.length) {
      const mark = readBytes(reader, 4)
      const keyBytes = readBytes(reader, 4)
      if (!mark || !keyBytes) break
      const markText = mark.toString('ascii')
      if (markText !== '8BIM' && markText !== '8B64') break
      const key = keyBytes.toString('ascii')
      const length = readUint(reader, isLarge && PSD_LONG_LAYER_KEYS.has(key) ? 8 : 4)
      if (length === null) break
      const start = reader.offset
      if (key === 'TySh' && start + length <= Math.min(end, buffer.length)) {
        fonts.push(...textLayerFonts(buffer.subarray(start, start + length)))
      }
      reader.offset = start + length
    }
    reader.offset = Math.min(end, buffer.length)
  }
  return uniqueParsedFonts(fonts)
}

function textLayerFonts(bytes: Buffer): ParsedFont[] {
  const resources = findAscii(bytes, '/ResourceDict')
  if (resources < 0) return []
  const fontSet = findAscii(bytes, '/FontSet', resources)
  if (fontSet < 0) return []
  const names = photoshopFontNames(bytes, fontSet)
  const used = new Set<number>()
  const runs = findAscii(bytes, '/StyleRun')
  if (runs >= 0 && runs < resources) {
    const region = bytes.subarray(runs, resources)
    const named = numbersAfter(region, '/Font')
    for (const index of named) used.add(index)
    if (named.length < occurrences(region, '/RunLength')) {
      const sheets = findAscii(bytes, '/StyleSheetSet', resources)
      if (sheets >= 0 && sheets < fontSet) {
        const fallback = numbersAfter(bytes.subarray(sheets, fontSet), '/Font')[0]
        if (fallback !== undefined) used.add(fallback)
      }
    }
  }
  const fonts: ParsedFont[] = []
  for (const index of [...used].sort((left, right) => left - right)) {
    const name = names[index]
    if (!name || name === 'AdobeInvisFont') continue
    fonts.push({ postscriptName: name, familyName: '', styleName: '' })
  }
  return fonts
}

function photoshopFontNames(bytes: Buffer, start: number): string[] {
  const names: string[] = []
  let at = start
  const close = findAscii(bytes, ']', start)
  const limit = close < 0 ? bytes.length : close
  while (at < limit) {
    const nameAt = findAscii(bytes, '/Name', at)
    if (nameAt < 0 || nameAt >= limit) break
    at = nameAt + 5
    while (at < bytes.length && isPhotoshopSpace(bytes[at]!)) at += 1
    if (at >= bytes.length || bytes[at] !== 0x28) continue
    at += 1
    const raw: number[] = []
    while (at < bytes.length && bytes[at] !== 0x29) {
      if (bytes[at] === 0x5c && at + 1 < bytes.length) at += 1
      raw.push(bytes[at]!)
      at += 1
    }
    names.push(photoshopString(Buffer.from(raw)))
  }
  return names
}

function photoshopString(raw: Buffer): string {
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    const swapped = Buffer.alloc(raw.length - (raw.length % 2) - 2)
    for (let index = 0; index < swapped.length; index += 2) {
      swapped[index] = raw[index + 3]!
      swapped[index + 1] = raw[index + 2]!
    }
    return swapped.toString('utf16le')
  }
  return raw.toString('latin1')
}

function numbersAfter(bytes: Buffer, key: string): number[] {
  const found: number[] = []
  const needle = Buffer.from(key)
  let at = 0
  while (at <= bytes.length - needle.length) {
    const match = bytes.indexOf(needle, at)
    if (match < 0) break
    at = match + needle.length
    let digits = at
    while (digits < bytes.length && (bytes[digits] === 0x20 || bytes[digits] === 0x09)) digits += 1
    if (digits <= at) continue
    let value = 0
    let any = false
    while (digits < bytes.length && bytes[digits]! >= 0x30 && bytes[digits]! <= 0x39 && value < 1_000_000) {
      value = value * 10 + (bytes[digits]! - 0x30)
      any = true
      digits += 1
    }
    if (any) found.push(value)
  }
  return found
}

function occurrences(bytes: Buffer, key: string): number {
  let count = 0
  let at = 0
  while (at < bytes.length) {
    const match = findAscii(bytes, key, at)
    if (match < 0) break
    count += 1
    at = match + 1
  }
  return count
}

function findAscii(bytes: Buffer, key: string, from = 0): number {
  if (from < 0 || from > bytes.length) return -1
  return bytes.indexOf(key, from)
}

function isPhotoshopSpace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d
}

type ByteReader = { buffer: Buffer; offset: number }

function skipBytes(reader: ByteReader, count: number): void {
  if (!Number.isFinite(count) || count <= 0) return
  const room = reader.buffer.length - reader.offset
  reader.offset = count > room ? reader.buffer.length : reader.offset + count
}

function readBytes(reader: ByteReader, count: number): Buffer | null {
  if (count < 0 || reader.offset + count > reader.buffer.length) return null
  const start = reader.offset
  reader.offset += count
  return reader.buffer.subarray(start, reader.offset)
}

function readUint(reader: ByteReader, count: number): number | null {
  const bytes = readBytes(reader, count)
  if (!bytes) return null
  let value = 0
  for (const byte of bytes) {
    value = value * 256 + byte
    if (value > PSD_MAX_LENGTH) return null
  }
  return value
}

function readInt16(reader: ByteReader): number | null {
  const value = readUint(reader, 2)
  if (value === null) return null
  return value > 0x7fff ? value - 0x10000 : value
}

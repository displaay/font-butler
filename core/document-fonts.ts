import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import type { CatalogEntry, FontFaceInfo } from './types.ts'

/**
 * Read font names from a PDF or IDML file and classify each against the catalog.
 * This does not create or update projects.
 *
 * {@link documentProjectDraft} turns this report into project members.
 * Unique `assetId`s are the members, `installedFingerprint` is the pin when it
 * is present, and `missing` rows are unresolved names for `path` (never members).
 * `installedFingerprint` is set only when the matched face is the active copy and
 * the pin would be the cut named by the document's PostScript name. A family+style
 * fallback that lands on a different PostScript name stays unpinned.
 */

export type DocumentFontStatus = 'on' | 'in-library-off' | 'missing'

export type DocumentFontMatchKind = 'postscript' | 'family-style'

export type DocumentFontRequest = {
  /** Document PostScript name with a subset prefix removed. Empty when the file only named a family. */
  postscriptName: string
  /** Document family. Empty for PDF, which only stores BaseFont. */
  familyName: string
  /** Document style. Empty for PDF. */
  styleName: string
  status: DocumentFontStatus
  /** Catalog entry id when a face matched. */
  assetId?: string
  /**
   * Installed fingerprint to pin, when the face is on and the pin is this cut.
   * Absent for missing names, library faces that are off, and a family+style
   * match whose PostScript name is a different cut.
   */
  installedFingerprint?: string
  matchedBy?: DocumentFontMatchKind
}

export type DocumentFontReport = {
  path: string
  kind: 'pdf' | 'idml'
  fonts: DocumentFontRequest[]
}

type ParsedFont = {
  postscriptName: string
  familyName: string
  styleName: string
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
  const requests = kind === 'pdf' ? pdfFontRequests(buffer) : idmlFontRequests(buffer)
  const catalog = typeof entries === 'function' ? entries() : entries
  return {
    path: resolved,
    kind,
    fonts: matchFonts(requests, catalog),
  }
}

function documentKind(filePath: string): 'pdf' | 'idml' {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.idml') return 'idml'
  throw new Error('Document fonts can be read from PDF and IDML files.')
}

function matchFonts(requests: readonly ParsedFont[], entries: readonly CatalogEntry[]): DocumentFontRequest[] {
  const index = buildIndex(entries)
  const seen = new Set<string>()
  const fonts: DocumentFontRequest[] = []
  for (const request of requests) {
    const key = requestKey(request)
    if (seen.has(key)) continue
    seen.add(key)
    fonts.push(classify(request, index))
  }
  return fonts
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
    return readZipXml(buffer).flatMap((xml) => fontElements(xml))
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

function readZipXml(buffer: Buffer): string[] {
  const eocd = findEocd(buffer)
  if (eocd < 0) throw new Error('Could not read that IDML file.')
  const count = buffer.readUInt16LE(eocd + 10)
  let cursor = buffer.readUInt32LE(eocd + 16)
  if (count === 0xffff || cursor === 0xffffffff) {
    throw new Error('Could not read that IDML file.')
  }
  const texts: string[] = []
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Could not read that IDML file.')
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
    texts.push(readZipEntry(buffer, localOffset, method, compressedSize).toString('utf8'))
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

function readZipEntry(buffer: Buffer, offset: number, method: number, compressedSize: number): Buffer {
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error('Could not read that IDML file.')
  }
  const flags = buffer.readUInt16LE(offset + 6)
  if ((flags & 0x1) !== 0) throw new Error('Could not read that IDML file.')
  const nameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + nameLength + extraLength
  const dataEnd = dataStart + compressedSize
  if (dataEnd > buffer.length) throw new Error('Could not read that IDML file.')
  const compressed = buffer.subarray(dataStart, dataEnd)
  if (method === 0) return Buffer.from(compressed)
  if (method === 8) {
    try {
      return zlib.inflateRawSync(compressed, { maxOutputLength: MAX_INFLATE_BYTES })
    } catch {
      throw new Error('Could not read that IDML file.')
    }
  }
  throw new Error('Could not read that IDML file.')
}

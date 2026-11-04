/**
 * Stage D — import library organisation from other font managers.
 *
 * Discovery spike (2026-11-04). No Mac with either app was available in the
 * build environment, so formats were verified from Cicero's importers
 * (github.com/opr-inzn/cicero at bd25d2a, read 2026-11-04), which read the
 * same real files, plus a runtime check that Node's built-in SQLite reader
 * (`node:sqlite`, verified working in this repo's Node 22) can open them.
 * Nothing here invents a column, key, or format:
 *
 * Font Book — VERIFIED, imported.
 * - `.collection` files in `~/Library/FontCollections` are NSKeyedArchiver
 *   archives (usually binary plists), not plain font lists
 *   (`FontBookImport.collection(at:)`): the root dictionary's
 *   `NSFontCollectionFontDescriptors` are font descriptors whose attributes
 *   are `NSFontNameAttribute` (PostScript name), `NSFontFamilyAttribute`,
 *   `NSFontFaceAttribute`, and `NSFontDescriptorNegativeAttribute` for a
 *   style left out of a family. A collection whose descriptors ask for
 *   traits/languages, or which carries other keys, is a smart collection:
 *   it is named in the report and not translated. Built-ins (Fixed Width,
 *   Fun, Modern, PDF, Traditional, Web) start unchecked.
 * - Font Book stores no labels, ratings, or comments in these files.
 *
 * FontExplorer X — VERIFIED from Cicero's reader, imported.
 * - The library is SQLite: `FontExplorer X.fexdb` on disk,
 *   `FontDatabase.db` inside a `.fexconfig` folder (File → Local Backup),
 *   or that database inside a `.fexbackup` ZIP (`FontExplorerImport.read`,
 *   `fileExtensions`, `backupDatabase`). Schema used here, exactly as
 *   Cicero selects it: `containers(containerID, path, labelColorID,
 *   comment)`, `fonts(containerID, psName, familyName, style, rating,
 *   labelColorID, comment)`, `sourceItems(serialID, type, title,
 *   parentSerialID, specialFlag)`, `setContainers(serialID, containerID)`,
 *   `smartGroupRules(serialID, baseCriteria, subCriteria, value)`,
 *   `applicationSetPaths(serialID, path)`. Sidebar types: 6 smart set,
 *   7 set, 8 folder, 31 application set, 32/33 its activate/deactivate
 *   children. Built-in smart sets 1, 3, 4, 5, 6 are skipped as Cicero does.
 * - Labels are colours 1–7 with no names, imported as family tags named
 *   Red, Orange, Yellow, Green, Blue, Purple, Gray (`FontExplorerImport
 *   .labels` / `labelName`), collected per face and per file and applied
 *   to each matched family. An existing tag of that name is reused.
 * - Ratings (per style, 1–5) and comments (per face and per file) are
 *   imported onto the family (decision 1A): the family gets its highest
 *   style rating and the joined comments, unless it already has a
 *   rating/comment, which is kept (Cicero's rule).
 *
 * Apply rules follow Cicero's `LibraryImport.apply`: a set whose name
 * already exists gains members (merged, not skipped); a smart set with
 * any untranslatable rule is shown disabled and skipped whole. No font
 * files are read or copied by this import.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { loadCatalog, saveCatalog } from './catalog.ts'
import type { AppPaths } from './paths.ts'
import { createProject, loadProjects, saveProjects } from './projects.ts'
import type { CatalogEntry, ProjectSet } from './types.ts'
import {
  detailForFamily,
  setFamilyComment,
  setFamilyRating,
  type FamilyDetail,
} from '../shared/family-details.ts'
import {
  addFamilyTag,
  ensureSeedTags,
  familyTagKey,
  setFamilyTagPresent,
  type FamilyTag,
} from '../shared/family-tags.ts'
import { createSmartRule, isSmartProject, type SmartRule, type SmartRuleSet } from '../shared/smart-projects.ts'
import type {
  LibraryImportApplyResult,
  LibraryImportFileInput,
  LibraryImportLabelPlan,
  LibraryImportPlan,
  LibraryImportSetChoice,
  LibraryImportSetPlan,
  LibraryImportUnsupported,
  LibraryImportUnresolved,
  ParsedLibrary,
  ParsedLibrarySet,
} from '../shared/library-import.ts'

export type {
  LibraryImportApplyResult,
  LibraryImportFileInput,
  LibraryImportPlan,
} from '../shared/library-import.ts'
export type { ParsedLibrary } from '../shared/library-import.ts'

const MAX_IMPORT_FILES = 50
const MAX_IMPORT_FILE_BYTES = 64_000_000

function baseName(fileName: string): string {
  return fileName.split(/[\\/]/).pop() ?? fileName
}

// ---------------------------------------------------------------------------
// Binary property lists (the container of every Font Book keyed archive).

type PlistValue = string | number | boolean | Uint8Array | PlistValue[] | { [key: string]: PlistValue }

export function parseBinaryPlist(buffer: Buffer): PlistValue {
  if (buffer.subarray(0, 6).toString('latin1') !== 'bplist') {
    throw new Error('Not a binary property list.')
  }
  const trailer = buffer.subarray(buffer.length - 32)
  const offsetSize = trailer[6]!
  const refSize = trailer[7]!
  const count = Number(trailer.readBigUInt64BE(8))
  const topIndex = Number(trailer.readBigUInt64BE(16))
  const offsetsAt = Number(trailer.readBigUInt64BE(24))
  const offsets: number[] = []
  for (let i = 0; i < count; i++) {
    offsets.push(Number(readSizedInt(buffer, offsetsAt + i * offsetSize, offsetSize)))
  }
  const readInt = (at: number, size: number) => Number(readSizedInt(buffer, at, size))
  function readSizedInt(buf: Buffer, at: number, size: number): bigint {
    let value = 0n
    for (let i = 0; i < size; i++) value = (value << 8n) | BigInt(buf[at + i]!)
    return value
  }
  function readObject(index: number): PlistValue {
    const at = offsets[index]!
    const marker = buffer[at]!
    const type = marker >> 4
    let info = marker & 0x0f
    let cursor = at + 1
    let length = info
    if (info === 0x0f) {
      const intMarker = buffer[cursor]!
      const intSize = 1 << (intMarker & 0x0f)
      length = readInt(cursor + 1, intSize)
      cursor += 1 + intSize
    }
    switch (type) {
      case 0x0:
        return info === 0x09
      case 0x1:
        return readInt(cursor, 1 << info)
      case 0x2: {
        if (length === 8) return buffer.readDoubleBE(cursor)
        return buffer.readFloatBE(cursor)
      }
      case 0x3: {
        // Dates are not used by the archives read here; keep the raw number.
        return buffer.readDoubleBE(cursor)
      }
      case 0x4:
        return buffer.subarray(cursor, cursor + length)
      case 0x5:
        return buffer.toString('latin1', cursor, cursor + length)
      case 0x6: {
        let text = ''
        for (let i = 0; i < length; i++) text += String.fromCharCode(buffer.readUInt16BE(cursor + i * 2))
        return text
      }
      case 0x8:
        // UID: kept in the XML archive's CF$UID shape for the resolver.
        return { 'CF$UID': readInt(cursor, length + 1) }
      case 0xa: {
        const array: PlistValue[] = []
        for (let i = 0; i < length; i++) array.push(readObject(readInt(cursor + i * refSize, refSize)))
        return array
      }
      case 0xd: {
        const dict: { [key: string]: PlistValue } = {}
        for (let i = 0; i < length; i++) {
          const key = readObject(readInt(cursor + i * refSize, refSize))
          const value = readObject(readInt(cursor + (length + i) * refSize, refSize))
          if (typeof key === 'string') dict[key] = value
        }
        return dict
      }
      default:
        throw new Error(`Unsupported binary plist element (type ${type}).`)
    }
  }
  return readObject(topIndex)
}

// ---------------------------------------------------------------------------
// XML property lists (same keyed-archive graph, text form).

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Parse an XML plist into plain values. Throws on anything else. */
export function parseXmlPlist(xml: string): PlistValue {
  let index = 0
  const fail = (reason: string): never => {
    throw new Error(`Not a readable property list (${reason}).`)
  }
  const skipMisc = () => {
    for (;;) {
      while (index < xml.length && /\s/.test(xml[index]!)) index++
      if (xml.startsWith('<?', index)) {
        const end = xml.indexOf('?>', index)
        if (end === -1) fail('unterminated processing instruction')
        index = end + 2
      } else if (xml.startsWith('<!', index)) {
        const end = xml.indexOf('>', index)
        if (end === -1) fail('unterminated declaration')
        index = end + 1
      } else return
    }
  }
  const readTag = (): { name: string; closing: boolean; selfClosing: boolean } => {
    skipMisc()
    if (xml[index] !== '<') fail(`expected tag at offset ${index}`)
    const end = xml.indexOf('>', index)
    if (end === -1) fail('unterminated tag')
    let inner = xml.slice(index + 1, end).trim()
    index = end + 1
    const closing = inner.startsWith('/')
    if (closing) inner = inner.slice(1).trim()
    const selfClosing = inner.endsWith('/')
    if (selfClosing) inner = inner.slice(0, -1).trim()
    return { name: inner.split(/\s/)[0] ?? '', closing, selfClosing }
  }
  const readText = (): string => {
    const end = xml.indexOf('<', index)
    if (end === -1) fail('unterminated value')
    const text = xml.slice(index, end)
    index = end
    return decodeEntities(text)
  }
  const readTextThenClose = (): string => {
    const text = readText()
    readTag()
    return text
  }
  const readValue = (): PlistValue => {
    const tag = readTag()
    if (tag.closing) fail(`unexpected closing tag ${tag.name}`)
    switch (tag.name) {
      case 'plist':
        return readValue()
      case 'dict': {
        const dict: { [key: string]: PlistValue } = {}
        for (;;) {
          skipMisc()
          if (xml.startsWith('</', index)) {
            readTag()
            return dict
          }
          const keyTag = readTag()
          if (keyTag.name !== 'key') fail(`expected <key> in dict, got <${keyTag.name}>`)
          const key = readText()
          readTag()
          dict[key] = readValue()
        }
      }
      case 'array': {
        const array: PlistValue[] = []
        for (;;) {
          skipMisc()
          if (xml.startsWith('</', index)) {
            readTag()
            return array
          }
          array.push(readValue())
        }
      }
      case 'string':
        return tag.selfClosing ? '' : readTextThenClose()
      case 'integer':
      case 'real': {
        const text = tag.selfClosing ? '0' : readTextThenClose()
        const value = Number(text)
        return Number.isFinite(value) ? value : text
      }
      case 'true':
        return true
      case 'false':
        return false
      case 'data': {
        const text = tag.selfClosing ? '' : readTextThenClose()
        return Buffer.from(text.replace(/\s/g, ''), 'base64')
      }
      case 'date':
        return tag.selfClosing ? '' : readTextThenClose()
      default:
        return fail(`unsupported plist element <${tag.name}>`)
    }
  }
  skipMisc()
  return readValue()
}

// ---------------------------------------------------------------------------
// NSKeyedArchiver resolution: $objects graph with UID references.

function isDict(value: PlistValue): value is { [key: string]: PlistValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array)
}

function uidOf(value: PlistValue): number | null {
  if (!isDict(value)) return null
  const uid = value['CF$UID']
  return typeof uid === 'number' ? uid : null
}

/** Resolve a keyed archive to the object stored under `topKey`. */
export function unarchiveKeyed(root: PlistValue, topKey: string): { [key: string]: PlistValue } | null {
  if (!isDict(root) || !Array.isArray(root.$objects)) return null
  const objects = root.$objects as PlistValue[]
  const resolve = (value: PlistValue, seen: Set<number>): PlistValue => {
    const uid = uidOf(value)
    if (uid !== null) {
      if (seen.has(uid)) return {}
      const next = new Set(seen).add(uid)
      return resolve(objects[uid] ?? {}, next)
    }
    if (Array.isArray(value)) return value.map((item) => resolve(item, seen))
    if (isDict(value)) {
      const out: { [key: string]: PlistValue } = {}
      for (const [key, item] of Object.entries(value)) {
        if (key === '$class') continue
        out[key] = resolve(item, seen)
      }
      return out
    }
    return value
  }
  const top = isDict(root.$top) ? root.$top : {}
  const target = top[topKey]
  if (target === undefined) return null
  const resolved = resolve(target, new Set())
  return isDict(resolved) ? resolved : null
}

// ---------------------------------------------------------------------------
// Font Book.

const FONT_BOOK_BUILT_INS = new Set(['Fixed Width', 'Fun', 'Modern', 'PDF', 'Traditional', 'Web'])
const FONT_BOOK_NAMING_ATTRIBUTES = new Set([
  'NSFontNameAttribute',
  'NSFontFamilyAttribute',
  'NSFontFaceAttribute',
  'NSFontVisibleNameAttribute',
  'NSFontSizeAttribute',
  'NSFontDescriptorNegativeAttribute',
])

const FONT_BOOK_NO_LABELS: LibraryImportUnsupported = {
  concept: 'labels',
  reason: 'Font Book collections have no labels; nothing to map to family tags.',
  count: null,
}

function nonEmptyString(value: PlistValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseFontBookCollectionBuffer(fileName: string, buffer: Buffer): ParsedLibrary {
  const name = baseName(fileName).replace(/\.collection$/i, '')
  const displayName = name === 'com.apple.Favorites' ? 'Favorites' : name
  const fail = (reason: string): ParsedLibrary => ({
    sourceApp: 'font-book',
    sourceName: baseName(fileName),
    sets: [],
    labels: [],
    ratings: [],
    comments: [],
    unsupported: [
      { concept: 'file', reason },
      FONT_BOOK_NO_LABELS,
    ],
    warnings: [],
  })
  let root: PlistValue
  try {
    root = buffer.subarray(0, 6).toString('latin1') === 'bplist'
      ? parseBinaryPlist(buffer)
      : parseXmlPlist(buffer.toString('utf8'))
  } catch {
    return fail(`The Font Book collection “${baseName(fileName)}” could not be read.`)
  }
  const dictionary = unarchiveKeyed(root, 'NSFontCollectionDictionary')
  if (!dictionary) return fail(`The Font Book collection “${baseName(fileName)}” could not be read.`)
  const rawDescriptors = Array.isArray(dictionary.NSFontCollectionFontDescriptors)
    ? dictionary.NSFontCollectionFontDescriptors
    : []
  const descriptors = rawDescriptors.flatMap((item) => {
    if (!isDict(item)) return []
    const attributes = isDict(item.NSFontDescriptorAttributes) ? item.NSFontDescriptorAttributes : item
    return [attributes]
  })
  const hasRules =
    Object.keys(dictionary).some(
      (key) => key !== 'NSFontCollectionFontDescriptors' && key !== 'NSFontCollectionAttributes',
    ) ||
    descriptors.some((attributes) =>
      Object.keys(attributes).some((key) => !FONT_BOOK_NAMING_ATTRIBUTES.has(key)),
    ) ||
    descriptors.some(
      (attributes) => !nonEmptyString(attributes.NSFontNameAttribute) && !nonEmptyString(attributes.NSFontFamilyAttribute),
    )
  if (hasRules) {
    return {
      sourceApp: 'font-book',
      sourceName: baseName(fileName),
      sets: [],
      labels: [],
      ratings: [],
      comments: [],
      unsupported: [
        {
          concept: 'smart-sets',
          reason: `The Font Book smart collection “${displayName}” was not imported: smart collections are named here, not translated.`,
          detail: displayName,
        },
        FONT_BOOK_NO_LABELS,
      ],
      warnings: [],
    }
  }
  const members: string[] = []
  const excluded: string[] = []
  const seenFamilies = new Set<string>()
  for (const attributes of descriptors) {
    const postScript = nonEmptyString(attributes.NSFontNameAttribute)
    const family = nonEmptyString(attributes.NSFontFamilyAttribute)
    const face = nonEmptyString(attributes.NSFontFaceAttribute)
    if (attributes.NSFontDescriptorNegativeAttribute === true) {
      if (postScript) excluded.push(postScript)
      continue
    }
    if (postScript || face) members.push(postScript ?? `${family ?? ''} ${face ?? ''}`.trim())
    else if (family && !seenFamilies.has(family)) {
      seenFamilies.add(family)
      members.push(family)
    }
  }
  return {
    sourceApp: 'font-book',
    sourceName: baseName(fileName),
    sets: [
      {
        name: displayName,
        kind: 'set',
        members: [...new Set(members)],
        ...(excluded.length > 0 ? { excluded } : {}),
        ...(FONT_BOOK_BUILT_INS.has(name) ? { isBuiltIn: true } : {}),
      },
    ],
    labels: [],
    ratings: [],
    comments: [],
    unsupported: [FONT_BOOK_NO_LABELS],
    warnings: [],
  }
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader for `.fexbackup` (stored or deflated entries only).

function zipEntry(buffer: Buffer, wanted: string): Buffer | null {
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 65536; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd === -1) return null
  const total = buffer.readUInt16LE(eocd + 10)
  let cursor = buffer.readUInt32LE(eocd + 16)
  for (let entry = 0; entry < total; entry++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) return null
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localAt = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    cursor += 46 + nameLength + extraLength + commentLength
    if (baseName(name) !== wanted) continue
    const localName = buffer.readUInt16LE(localAt + 26)
    const localExtra = buffer.readUInt16LE(localAt + 28)
    const dataAt = localAt + 30 + localName + localExtra
    const data = buffer.subarray(dataAt, dataAt + compressedSize)
    if (method === 0) return Buffer.from(data)
    if (method === 8) return zlib.inflateRawSync(data)
    return null
  }
  return null
}

// ---------------------------------------------------------------------------
// FontExplorer X (SQLite, schema verified from Cicero's reader).

const FEX_LABEL_NAMES: Record<number, string> = {
  1: 'Red',
  2: 'Orange',
  3: 'Yellow',
  4: 'Green',
  5: 'Blue',
  6: 'Purple',
  7: 'Gray',
}
const FEX_BUILT_IN_SMART_SETS = new Set([1, 3, 4, 5, 6])
const FEX_TEXT_COMPARISONS = [
  'is',
  'is not',
  'ends with',
  'doesn’t end with',
  'begins with',
  'doesn’t begin with',
  'contains',
  'doesn’t contain',
]

function fexFieldName(code: number): string {
  switch (code) {
    case 0: return 'Name'
    case 1: return 'PostScript Name'
    case 3: return 'Path'
    case 4: return 'Family Name'
    case 5: return 'Style'
    case 6: return 'Copyright'
    case 7: return 'Version'
    case 8: return 'Trademark'
    case 9: return 'Manufacturer'
    case 10: return 'Comment'
    case 11: return 'Designer'
    case 12: return 'Description'
    case 100: return 'Is Activated'
    case 101: return 'Is in Conflict'
    case 102: return 'Is in System Folder'
    case 105: return 'Is System Font'
    case 200: return 'Format'
    case 300: return 'Vendor'
    case 400: return 'Rating'
    case 500: return 'Contained In'
    case 501: return 'Not Contained In'
    case 600: return 'Label'
    case 700: return 'Number of Activations'
    case 701: return 'Last Activated'
    case 702: return 'Number of Last Activated Fonts'
    case 800: return 'Import Date'
    case 801: return 'Number of Last Imported Fonts'
    case 900: return 'Embedding Rights'
    case 1100: return 'Language'
    case 1200: return 'OpenType Features'
    case 1300: return 'SkyFonts'
    case 1301: return 'Monotype'
    case 1302: return 'Adobe Fonts'
    case 1500: return 'Classification'
    case 1600: return 'Last Deactivated'
    default: return 'a kind of rule from another version of FontExplorer X'
  }
}

type SqliteRow = Record<string, string | number | null>

function openSqlite(buffer: Buffer): {
  columns(table: string): Set<string>
  rows(sql: string): SqliteRow[]
  close(): void
} | null {
  let DatabaseSync: typeof import('node:sqlite').DatabaseSync
  try {
    DatabaseSync = createRequire(import.meta.url)('node:sqlite').DatabaseSync
  } catch {
    return null
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-import-'))
  const file = path.join(dir, 'library.db')
  fs.writeFileSync(file, buffer)
  const db = new DatabaseSync(file, { readOnly: true })
  return {
    columns(table) {
      try {
        const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
      } catch {
        return new Set()
      }
    },
    rows(sql) {
      return db.prepare(sql).all() as SqliteRow[]
    },
    close() {
      try {
        db.close()
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    },
  }
}

function selectRows(
  sqlite: NonNullable<ReturnType<typeof openSqlite>>,
  wanted: string[],
  table: string,
  orderedBy?: string,
): SqliteRow[] {
  const columns = sqlite.columns(table)
  const present = wanted.filter((column) => columns.has(column))
  if (present.length === 0) return []
  const list = present.map((column) => `"${column}"`).join(', ')
  try {
    return sqlite.rows(`SELECT ${list} FROM "${table}"${orderedBy ? ` ORDER BY ${orderedBy}` : ''}`)
  } catch {
    return []
  }
}

const text = (row: SqliteRow, key: string): string | null =>
  typeof row[key] === 'string' && row[key].trim() ? (row[key] as string) : null
const int = (row: SqliteRow, key: string): number =>
  typeof row[key] === 'number' ? row[key] : 0

export function parseFontExplorerDatabase(sourceName: string, buffer: Buffer): ParsedLibrary {
  const notALibrary = (): ParsedLibrary => ({
    sourceApp: 'font-explorer-x',
    sourceName,
    sets: [],
    labels: [],
    ratings: [],
    comments: [],
    unsupported: [
      {
        concept: 'file',
        reason: `“${sourceName}” is not a readable FontExplorer X library database.`,
      },
    ],
    warnings: [],
  })
  const sqlite = openSqlite(buffer)
  if (!sqlite) {
    return {
      sourceApp: 'font-explorer-x',
      sourceName,
      sets: [],
      labels: [],
      ratings: [],
      comments: [],
      unsupported: [
        {
          concept: 'file',
          reason: 'FontExplorer X databases could not be opened here (no SQLite reader).',
        },
      ],
      warnings: [],
    }
  }
  try {
    if (!sqlite.columns('containers').has('path') || !sqlite.columns('sourceItems').has('type')) {
      return notALibrary()
    }
    const containerRows = selectRows(
      sqlite,
      ['containerID', 'path', 'labelColorID', 'comment'],
      'containers',
    )
    const fontRows = selectRows(
      sqlite,
      ['containerID', 'psName', 'familyName', 'style', 'rating', 'labelColorID', 'comment'],
      'fonts',
    )
    const items = selectRows(
      sqlite,
      ['serialID', 'type', 'title', 'parentSerialID', 'specialFlag'],
      'sourceItems',
      'rowid',
    )
    const memberRows = selectRows(sqlite, ['serialID', 'containerID'], 'setContainers')
    const ruleRows = selectRows(
      sqlite,
      ['serialID', 'baseCriteria', 'subCriteria', 'value'],
      'smartGroupRules',
      'rowid',
    )

    const containerPath = new Map<number, string>()
    for (const row of containerRows) {
      const filePath = text(row, 'path')
      if (filePath) containerPath.set(int(row, 'containerID'), filePath)
    }
    type Face = { psName: string | null; family: string | null }
    const facesByContainer = new Map<number, Face[]>()
    const labelled = new Map<number, string[]>()
    const parsedRatings: { member: string; stars: number }[] = []
    const parsedComments: { member: string; text: string }[] = []
    const pushLabel = (color: number, identifier: string) => {
      if (!FEX_LABEL_NAMES[color]) return
      const list = labelled.get(color) ?? []
      if (!list.includes(identifier)) list.push(identifier)
      labelled.set(color, list)
    }
    for (const row of fontRows) {
      const containerId = int(row, 'containerID')
      if (!containerPath.has(containerId)) continue
      const face: Face = { psName: text(row, 'psName'), family: text(row, 'familyName') }
      const faces = facesByContainer.get(containerId) ?? []
      faces.push(face)
      facesByContainer.set(containerId, faces)
      const identifier = face.psName ?? face.family ?? containerPath.get(containerId)!
      pushLabel(int(row, 'labelColorID'), identifier)
      const rating = int(row, 'rating')
      if (rating >= 1 && rating <= 5) parsedRatings.push({ member: identifier, stars: rating })
      const faceComment = text(row, 'comment')
      if (faceComment) parsedComments.push({ member: identifier, text: faceComment })
    }
    const fontsOf = (containerId: number): string[] => {
      const faces = facesByContainer.get(containerId)
      if (!faces || faces.length === 0) return [containerPath.get(containerId)!]
      return faces.map((face) => face.psName ?? face.family ?? containerPath.get(containerId)!)
    }
    for (const row of containerRows) {
      const containerId = int(row, 'containerID')
      if (!containerPath.has(containerId)) continue
      const color = int(row, 'labelColorID')
      if (FEX_LABEL_NAMES[color]) for (const identifier of fontsOf(containerId)) pushLabel(color, identifier)
      const fileComment = text(row, 'comment')
      if (fileComment) parsedComments.push({ member: containerPath.get(containerId)!, text: fileComment })
    }

    const byId = new Map(items.map((item) => [int(item, 'serialID'), item]))
    const nameOf = (item: SqliteRow): string => {
      const parts = [text(item, 'title') ?? 'Untitled']
      let parent = byId.get(int(item, 'parentSerialID'))
      const seen = new Set([int(item, 'serialID')])
      while (parent && int(parent, 'type') === 8 && seen.add(int(parent, 'serialID'))) {
        parts.unshift(text(parent, 'title') ?? 'Untitled')
        parent = byId.get(int(parent, 'parentSerialID'))
      }
      return parts.join(' / ')
    }
    const membersBySet = new Map<number, number[]>()
    for (const row of memberRows) {
      const list = membersBySet.get(int(row, 'serialID')) ?? []
      list.push(int(row, 'containerID'))
      membersBySet.set(int(row, 'serialID'), list)
    }
    const setFonts = (serial: number): string[] => [
      ...new Set((membersBySet.get(serial) ?? []).flatMap((id) => (containerPath.has(id) ? fontsOf(id) : []))),
    ]
    const setSerialByName = new Map<string, number>()

    const sets: ParsedLibrarySet[] = []
    const warnings: string[] = []
    let deactivating = 0
    for (const item of items) {
      const serial = int(item, 'serialID')
      const type = int(item, 'type')
      if (type === 7) {
        const name = nameOf(item)
        setSerialByName.set(name, serial)
        sets.push({ name, kind: 'set', members: setFonts(serial) })
      } else if (type === 31) {
        const children = items.filter((child) => int(child, 'parentSerialID') === serial)
        const fonts: string[] = []
        for (const child of children) {
          if (int(child, 'type') === 32) {
            for (const identifier of setFonts(int(child, 'serialID'))) {
              if (!fonts.includes(identifier)) fonts.push(identifier)
            }
          } else if (int(child, 'type') === 33 && (membersBySet.get(int(child, 'serialID')) ?? []).length > 0) {
            deactivating++
          }
        }
        const name = nameOf(item)
        setSerialByName.set(name, serial)
        sets.push({ name, kind: 'set', members: fonts })
        warnings.push(`The application set “${name}” was imported as a plain project; its linked applications were not imported.`)
      }
    }
    if (deactivating > 0) {
      warnings.push(
        `${deactivating} application set${deactivating === 1 ? '' : 's'} turn fonts off (Autodeactivate); those were not imported.`,
      )
    }

    const rulesBySet = new Map<number, SqliteRow[]>()
    for (const row of ruleRows) {
      const list = rulesBySet.get(int(row, 'serialID')) ?? []
      list.push(row)
      rulesBySet.set(int(row, 'serialID'), list)
    }
    const importedLabelColors = new Set(labelled.keys())
    for (const item of items) {
      if (int(item, 'type') !== 6 || FEX_BUILT_IN_SMART_SETS.has(int(item, 'serialID'))) continue
      const serial = int(item, 'serialID')
      const rules: SmartRule[] = []
      const unsupportedRules: string[] = []
      for (const row of rulesBySet.get(serial) ?? []) {
        const result = translateFexRule(
          int(row, 'baseCriteria'),
          int(row, 'subCriteria'),
          text(row, 'value') ?? '',
          { setSerialByName, importedLabelColors },
        )
        if ('rule' in result) rules.push(result.rule)
        else if (!unsupportedRules.includes(result.description)) unsupportedRules.push(result.description)
      }
      sets.push({
        name: nameOf(item),
        kind: 'smart',
        members: [],
        ...(unsupportedRules.length === 0 && rules.length > 0
          ? { rules: { match: int(item, 'specialFlag') !== 0 ? 'all' : 'any', rules } as SmartRuleSet }
          : {}),
        unsupportedRules:
          unsupportedRules.length > 0
            ? unsupportedRules
            : rules.length === 0
              ? ['no readable rules']
              : [],
      })
    }

    const labels = [...labelled.entries()]
      .sort(([a], [b]) => a - b)
      .map(([color, members]) => ({ label: FEX_LABEL_NAMES[color]!, members }))

    return {
      sourceApp: 'font-explorer-x',
      sourceName,
      sets,
      labels,
      ratings: parsedRatings,
      comments: parsedComments,
      unsupported: [],
      warnings,
    }
  } finally {
    sqlite.close()
  }
}

/**
 * One FontExplorer smart rule onto a Cuttler smart rule, following Cicero's
 * `FontExplorerImport.rule` for the fields Cuttler has. Everything else is
 * returned as the verbatim description Cicero would list.
 */
function translateFexRule(
  field: number,
  comparison: number,
  value: string,
  context: { setSerialByName: Map<string, number>; importedLabelColors: Set<number> },
): { rule: SmartRule } | { description: string } {
  const unsupported = (): { description: string } => ({
    description: [fexFieldName(field), FEX_TEXT_COMPARISONS[comparison]].filter(Boolean).join(' '),
  })
  const query = (operator: 'contains' | 'notContains', ruleValue = value) =>
    ({ rule: createSmartRule({ field: 'query', operator, value: ruleValue }) }) as { rule: SmartRule }
  switch (field) {
    case 0:
      // Name: only "begins with" picks the same families (Cicero); query is a substring match.
      return comparison === 4 ? query('contains') : unsupported()
    case 4: {
      if (comparison === 0 || comparison === 4 || comparison === 6) return query('contains')
      if (comparison === 7) return query('notContains')
      return unsupported()
    }
    case 100: {
      if (comparison !== 0 && comparison !== 1) return unsupported()
      const yes = (Number.parseInt(value, 10) || 1) !== 0
      const positive = yes === (comparison === 0)
      return {
        rule: createSmartRule({ field: 'status', operator: positive ? 'is' : 'isNot', value: 'installed' }),
      }
    }
    case 600: {
      const color = Number.parseInt(value, 10)
      if ((comparison !== 0 && comparison !== 1) || !FEX_LABEL_NAMES[color]) return unsupported()
      if (!context.importedLabelColors.has(color)) {
        return { description: `${fexFieldName(field)} — the label was not imported` }
      }
      return {
        rule: createSmartRule({
          field: 'tag',
          operator: comparison === 0 ? 'is' : 'isNot',
          value: FEX_LABEL_NAMES[color]!,
        }),
      }
    }
    default:
      void context.setSerialByName
      return unsupported()
  }
}

// ---------------------------------------------------------------------------
// File dispatch.

export function parseLibraryImportBuffer(input: LibraryImportFileInput): ParsedLibrary {
  const buffer = input.contentBase64
    ? Buffer.from(input.contentBase64, 'base64')
    : Buffer.from(input.content, 'utf8')
  if (buffer.length > MAX_IMPORT_FILE_BYTES) throw new Error(`"${baseName(input.name)}" is too large to import.`)
  const lower = baseName(input.name).toLowerCase()
  if (buffer.subarray(0, 6).toString('latin1') === 'bplist' || lower.endsWith('.collection')) {
    return parseFontBookCollectionBuffer(input.name, buffer)
  }
  if (buffer.subarray(0, 15).toString('latin1') === 'SQLite format 3') {
    return parseFontExplorerDatabase(baseName(input.name), buffer)
  }
  if (buffer.subarray(0, 2).toString('latin1') === 'PK') {
    const database = zipEntry(buffer, 'FontDatabase.db')
    if (database) return parseFontExplorerDatabase(baseName(input.name), database)
    return {
      sourceApp: 'font-explorer-x',
      sourceName: baseName(input.name),
      sets: [],
      labels: [],
      ratings: [],
      comments: [],
      unsupported: [
        { concept: 'file', reason: `The backup “${baseName(input.name)}” had no FontDatabase.db to read.` },
      ],
      warnings: [],
    }
  }
  if (lower.endsWith('.fexconfig') || lower.endsWith('.fexdb') || lower.endsWith('.fexbackup')) {
    return {
      sourceApp: 'font-explorer-x',
      sourceName: baseName(input.name),
      sets: [],
      labels: [],
      ratings: [],
      comments: [],
      unsupported: [
        {
          concept: 'file',
          reason:
            'Choose the FontExplorer X.fexdb database, the FontDatabase.db inside a .fexconfig folder, or a .fexbackup file.',
        },
      ],
      warnings: [],
    }
  }
  if (buffer.toString('utf8', 0, 256).trimStart().startsWith('<')) {
    return parseFontBookCollectionBuffer(input.name, buffer)
  }
  return {
    sourceApp: 'unknown',
    sourceName: baseName(input.name),
    sets: [],
    labels: [],
    ratings: [],
    comments: [],
    unsupported: [
      {
        concept: 'file',
        reason: 'Choose a Font Book .collection file or a FontExplorer X database (.fexdb / FontDatabase.db / .fexbackup).',
      },
    ],
    warnings: [],
  }
}

export function parseLibraryImportFiles(inputs: LibraryImportFileInput[]): ParsedLibrary[] {
  if (inputs.length === 0) throw new Error('Choose a library file to import.')
  if (inputs.length > MAX_IMPORT_FILES) throw new Error(`Choose at most ${MAX_IMPORT_FILES} files at once.`)
  return inputs.map(parseLibraryImportBuffer)
}

// ---------------------------------------------------------------------------
// Matching: fingerprint, then face identity, then path, then family.

function normPath(value: string): string {
  return path.resolve(value)
}

function identifierKind(raw: string): 'path' | 'postscript' | 'family' {
  if (raw.includes('/') || /\.(ttf|otf|ttc|otc|woff2?)$/i.test(raw)) return 'path'
  if (!/\s/.test(raw) && raw.includes('-')) return 'postscript'
  return 'family'
}

export function unresolvedFor(raw: string): LibraryImportUnresolved {
  const kind = identifierKind(raw)
  if (kind === 'path') {
    const file = baseName(raw).replace(/\.(ttf|otf|ttc|otc|woff2?)$/i, '')
    return { raw, postscriptName: '', familyName: file, sourceFile: raw }
  }
  if (kind === 'postscript') {
    return { raw, postscriptName: raw, familyName: raw.split('-')[0] ?? raw, sourceFile: '' }
  }
  return { raw, postscriptName: '', familyName: raw, sourceFile: '' }
}

function matchIdentifier(raw: string, entries: readonly CatalogEntry[]): CatalogEntry[] {
  const wanted = raw.trim()
  if (!wanted) return []
  const byFingerprint = entries.filter(
    (entry) => entry.sourceFingerprint === wanted || entry.installedFingerprint === wanted,
  )
  if (byFingerprint.length > 0) return byFingerprint.slice(0, 1)
  const byPostscript = entries.filter((entry) =>
    entry.faces.some((face) => face.postscriptName === wanted),
  )
  if (byPostscript.length > 0) return byPostscript.slice(0, 1)
  if (identifierKind(wanted) === 'path') {
    const resolved = normPath(wanted)
    const file = baseName(wanted)
    const byPath = entries.filter(
      (entry) =>
        [entry.sourcePath, entry.installedPath, entry.disabledPath].some(
          (value) => value && normPath(value) === resolved,
        ) ||
        [entry.sourcePath, entry.installedPath, entry.disabledPath].some(
          (value) => value && baseName(value) === file,
        ),
    )
    if (byPath.length > 0) return byPath.slice(0, 1)
  }
  const family = wanted.toLowerCase()
  return entries.filter(
    (entry) =>
      familyTagKey(entry).toLowerCase() === family ||
      entry.faces.some((face) => face.familyName.toLowerCase() === family),
  )
}

function resolveMembers(
  identifiers: readonly string[],
  entries: readonly CatalogEntry[],
  excluded: readonly string[] = [],
): { assetIds: string[]; unresolved: LibraryImportUnresolved[] } {
  const assetIds: string[] = []
  const unresolved: LibraryImportUnresolved[] = []
  for (const raw of identifiers) {
    const matched = matchIdentifier(raw, entries).filter(
      (entry) => !entry.faces.every((face) => excluded.includes(face.postscriptName)),
    )
    if (matched.length === 0) {
      if (!excluded.includes(raw)) unresolved.push(unresolvedFor(raw))
      continue
    }
    for (const entry of matched) if (!assetIds.includes(entry.id)) assetIds.push(entry.id)
  }
  return { assetIds, unresolved }
}

// ---------------------------------------------------------------------------
// Plan.

export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function buildLibraryImportPlan(
  parsedList: readonly ParsedLibrary[],
  entries: readonly CatalogEntry[],
  projects: readonly ProjectSet[],
  tags: readonly FamilyTag[],
  details: readonly FamilyDetail[] = [],
): LibraryImportPlan {
  const sets: LibraryImportSetPlan[] = []
  const labels: LibraryImportLabelPlan[] = []
  const unsupported: LibraryImportUnsupported[] = []
  const warnings: string[] = []
  const seenUnsupported = new Set<string>()

  for (const parsed of parsedList) {
    warnings.push(...parsed.warnings)
    for (const item of parsed.unsupported) {
      const key = `${item.concept}\0${item.reason}`
      if (seenUnsupported.has(key)) continue
      seenUnsupported.add(key)
      unsupported.push(item)
    }
    for (const set of parsed.sets) {
      const existing = projects.find(
        (project) => project.name.trim().toLowerCase() === set.name.trim().toLowerCase(),
      )
      const id = `set-${sets.length}`
      if (set.kind === 'smart') {
        const disabled = !set.rules || (set.unsupportedRules ?? []).length > 0
        sets.push({
          id,
          name: set.name,
          kind: disabled ? 'manual' : 'smart',
          collision: Boolean(existing),
          ...(existing ? { existingProjectId: existing.id, existingIsSmart: isSmartProject(existing) } : {}),
          ...(disabled ? { disabled: true } : {}),
          memberAssetIds: [],
          alreadyMemberAssetIds: [],
          unresolved: [],
          ...(set.rules && !disabled ? { rules: set.rules } : {}),
          untranslatableRules: set.unsupportedRules ?? [],
          defaultChoice: disabled ? 'skip' : existing ? 'skip' : 'create',
        })
        continue
      }
      const resolved = resolveMembers(set.members, entries, set.excluded ?? [])
      const already = existing
        ? resolved.assetIds.filter((assetId) => existing.members.some((member) => member.assetId === assetId))
        : []
      sets.push({
        id,
        name: set.name,
        kind: 'manual',
        collision: Boolean(existing),
        ...(existing ? { existingProjectId: existing.id, existingIsSmart: isSmartProject(existing) } : {}),
        ...(set.isBuiltIn ? { isBuiltIn: true } : {}),
        memberAssetIds: resolved.assetIds,
        alreadyMemberAssetIds: already,
        unresolved: resolved.unresolved,
        untranslatableRules: [],
        // Cicero: a same-named set gains members; Font Book built-ins start unchecked.
        defaultChoice: set.isBuiltIn ? 'skip' : existing && !isSmartProject(existing) ? 'merge' : 'create',
      })
    }
    for (const label of parsed.labels) {
      const resolved = resolveMembers(label.members, entries)
      const familyKeys = [
        ...new Set(
          resolved.assetIds.flatMap((assetId) => {
            const entry = entries.find((item) => item.id === assetId)
            return entry ? [familyTagKey(entry)] : []
          }),
        ),
      ]
      const existingTag = tags.find((tag) => normalizeTagName(tag.name) === normalizeTagName(label.label))
      const clean = label.label.trim().replace(/\s+/g, ' ')
      labels.push({
        id: `label-${labels.length}`,
        name: clean || label.label,
        existingTagId: existingTag?.id ?? null,
        familyKeys,
        unresolvedCount: resolved.unresolved.length,
        ...(!clean
          ? { skipReason: 'The label name is empty.' }
          : clean.length > 40
            ? { skipReason: 'Tag names can be 40 characters.' }
            : {}),
      })
    }
  }

  const familyKeysFor = (identifiers: readonly string[]): string[] => [
    ...new Set(
      resolveMembers(identifiers, entries).assetIds.flatMap((assetId) => {
        const entry = entries.find((item) => item.id === assetId)
        return entry ? [familyTagKey(entry)] : []
      }),
    ),
  ]
  const ratingByFamily = new Map<string, number>()
  const commentsByFamily = new Map<string, string[]>()
  for (const parsed of parsedList) {
    for (const rating of parsed.ratings) {
      for (const familyKey of familyKeysFor([rating.member])) {
        ratingByFamily.set(familyKey, Math.max(ratingByFamily.get(familyKey) ?? 0, rating.stars))
      }
    }
    for (const comment of parsed.comments) {
      const text = comment.text.trim()
      if (!text) continue
      for (const familyKey of familyKeysFor([comment.member])) {
        const list = commentsByFamily.get(familyKey) ?? []
        if (!list.includes(text)) list.push(text)
        commentsByFamily.set(familyKey, list)
      }
    }
  }
  const ratings = [...ratingByFamily.entries()].map(([familyKey, stars]) => ({
    familyKey,
    stars,
    existingRating: detailForFamily(details, familyKey)?.rating ?? null,
  }))
  const comments = [...commentsByFamily.entries()].map(([familyKey, texts]) => ({
    familyKey,
    text: texts.join('\n'),
    existingComment: detailForFamily(details, familyKey)?.comment ?? null,
  }))

  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    sourceApp: parsedList[0]?.sourceApp ?? 'unknown',
    sourceName: parsedList.map((parsed) => parsed.sourceName).join(', '),
    sets,
    labels,
    ratings,
    comments,
    unsupported,
    warnings,
    summary: {
      sets: sets.filter((set) => set.kind === 'manual' && !set.disabled).length,
      smartSets: sets.filter((set) => set.kind === 'smart').length,
      labels: labels.length,
      reusedLabels: labels.filter((label) => label.existingTagId).length,
      unresolvedFonts: sets.reduce((total, set) => total + set.unresolved.length, 0),
      ratings: ratings.length,
      comments: comments.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Apply. Re-checks names against the current library so preview = applied.

function importedName(name: string, projects: readonly ProjectSet[]): string {
  const taken = new Set(projects.map((project) => project.name.trim().toLowerCase()))
  const base = `${name} (imported)`
  if (!taken.has(base.toLowerCase())) return base
  for (let index = 2; ; index++) {
    const candidate = `${base} ${index}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

export function applyLibraryImportPlan(
  paths: AppPaths,
  plan: LibraryImportPlan,
  choices: Readonly<Record<string, LibraryImportSetChoice>> = {},
): LibraryImportApplyResult {
  const projects = loadProjects(paths)
  const catalog = loadCatalog(paths)
  catalog.tags = ensureSeedTags(catalog.tags)
  const result: LibraryImportApplyResult = {
    createdProjects: [],
    mergedProjects: [],
    skippedSets: [],
    createdTags: [],
    reusedTags: [],
    assignedFamilies: 0,
    ratedFamilies: 0,
    commentedFamilies: 0,
    unresolvedFonts: 0,
  }
  const saveProject = (project: ProjectSet) => {
    const index = projects.findIndex((item) => item.id === project.id)
    if (index === -1) projects.unshift(project)
    else projects[index] = project
  }

  for (const set of plan.sets) {
    const choice = set.disabled ? 'skip' : (choices[set.id] ?? set.defaultChoice)
    result.unresolvedFonts += set.unresolved.length
    if (choice === 'skip') {
      result.skippedSets.push(set.name)
      continue
    }
    if (choice === 'merge') {
      const existing = projects.find((project) => project.id === set.existingProjectId)
      if (!existing || isSmartProject(existing)) {
        result.skippedSets.push(set.name)
        continue
      }
      const have = new Set(existing.members.map((member) => member.assetId))
      for (const assetId of set.memberAssetIds) {
        if (!have.has(assetId)) existing.members.push({ assetId })
      }
      existing.unresolved = [...(existing.unresolved ?? []), ...set.unresolved.map(toProjectUnresolved)]
      saveProject(existing)
      result.mergedProjects.push(existing.name)
      continue
    }
    const name = choice === 'imported-name' ? importedName(set.name, projects) : set.name
    const project =
      set.kind === 'smart' && set.rules
        ? createProject(name, [], { kind: 'smart', rules: set.rules, unresolved: [] })
        : createProject(name, set.memberAssetIds, { unresolved: set.unresolved.map(toProjectUnresolved) })
    saveProject(project)
    result.createdProjects.push(project.name)
  }

  for (const label of plan.labels) {
    if (label.skipReason || label.familyKeys.length === 0) continue
    let tag: FamilyTag | undefined
    if (label.existingTagId) {
      tag = (catalog.tags ?? []).find((item) => item.id === label.existingTagId)
      if (tag) result.reusedTags.push(tag.name)
    }
    if (!tag) {
      tag = addFamilyTag(catalog, label.name, crypto.randomUUID())
      result.createdTags.push(tag.name)
    }
    setFamilyTagPresent(catalog, label.familyKeys, tag.id, true)
    result.assignedFamilies += label.familyKeys.length
  }

  // Cicero: a family keeps a rating/comment it already has. Imported ratings
  // are the family's highest style rating; comments are joined only into an
  // empty family comment.
  for (const rating of plan.ratings) {
    if (rating.existingRating !== null) continue
    if (detailForFamily(catalog.familyDetails, rating.familyKey)?.rating) continue
    setFamilyRating(catalog, rating.familyKey, rating.stars)
    result.ratedFamilies++
  }
  for (const comment of plan.comments) {
    if (comment.existingComment) continue
    if (detailForFamily(catalog.familyDetails, comment.familyKey)?.comment) continue
    setFamilyComment(catalog, comment.familyKey, comment.text)
    result.commentedFamilies++
  }

  saveProjects(paths, projects)
  saveCatalog(paths, catalog)
  return result
}

function toProjectUnresolved(item: LibraryImportUnresolved) {
  return {
    postscriptName: item.postscriptName,
    familyName: item.familyName,
    styleName: '',
    sourceFile: item.sourceFile || item.raw,
  }
}

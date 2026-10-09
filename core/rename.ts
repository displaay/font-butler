import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { assertSafeShellPath } from './auth.ts'
import {
  pythonScriptArgv,
  pythonSpawnEnv,
  resolvePythonRuntime,
  type PythonRuntime,
} from './python-runtime.ts'

const execFileAsync = promisify(execFile)

function checksum(buffer: Buffer): number {
  const padded = Buffer.alloc(Math.ceil(buffer.length / 4) * 4)
  buffer.copy(padded)
  let sum = 0
  for (let i = 0; i < padded.length; i += 4) {
    sum = (sum + padded.readUInt32BE(i)) >>> 0
  }
  return sum
}

function decodeNameString(platformID: number, buf: Buffer): string {
  if (platformID === 0 || platformID === 3) {
    return buf.swap16().toString('utf16le')
  }
  return buf.toString('latin1')
}

function encodeNameString(platformID: number, value: string): Buffer {
  if (platformID === 0 || platformID === 3) {
    const encoded = Buffer.from(value, 'utf16le')
    return encoded.swap16()
  }
  return Buffer.from(value, 'latin1')
}

type NameRecord = {
  platformID: number
  encodingID: number
  languageID: number
  nameID: number
  text: string
}

function readNameTable(buf: Buffer): NameRecord[] {
  const format = buf.readUInt16BE(0)
  if (format !== 0 && format !== 1) {
    throw new Error('Unsupported name table format')
  }
  const count = buf.readUInt16BE(2)
  const stringOffset = buf.readUInt16BE(4)
  const records: NameRecord[] = []
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12
    const platformID = buf.readUInt16BE(o)
    const encodingID = buf.readUInt16BE(o + 2)
    const languageID = buf.readUInt16BE(o + 4)
    const nameID = buf.readUInt16BE(o + 6)
    const length = buf.readUInt16BE(o + 8)
    const offset = buf.readUInt16BE(o + 10)
    const slice = buf.subarray(stringOffset + offset, stringOffset + offset + length)
    records.push({
      platformID,
      encodingID,
      languageID,
      nameID,
      text: decodeNameString(platformID, Buffer.from(slice)),
    })
  }
  return records
}

function buildNameTable(records: NameRecord[]): Buffer {
  const strings: Buffer[] = []
  const offsets: number[] = []
  let cursor = 0
  for (const record of records) {
    const encoded = encodeNameString(record.platformID, record.text)
    offsets.push(cursor)
    strings.push(encoded)
    cursor += encoded.length
  }
  const headerSize = 6 + records.length * 12
  const table = Buffer.alloc(headerSize + cursor)
  table.writeUInt16BE(0, 0)
  table.writeUInt16BE(records.length, 2)
  table.writeUInt16BE(headerSize, 4)
  records.forEach((record, i) => {
    const o = 6 + i * 12
    const encoded = strings[i]
    table.writeUInt16BE(record.platformID, o)
    table.writeUInt16BE(record.encodingID, o + 2)
    table.writeUInt16BE(record.languageID, o + 4)
    table.writeUInt16BE(record.nameID, o + 6)
    table.writeUInt16BE(encoded.length, o + 8)
    table.writeUInt16BE(offsets[i], o + 10)
  })
  Buffer.concat(strings).copy(table, headerSize)
  return table
}

type SfntTable = { tag: string; buffer: Buffer }

const TTC_TAG = 0x74746366

/** Byte offsets of each sfnt in a TTC/OTC. A standalone font is a single face at 0. */
function collectionFaceStarts(file: Buffer): number[] {
  if (file.length < 12 || file.readUInt32BE(0) !== TTC_TAG) return [0]
  const numFonts = file.readUInt32BE(8)
  if (numFonts <= 0 || numFonts > 1024) return [0]
  const starts: number[] = []
  for (let i = 0; i < numFonts; i++) {
    const offsetPos = 12 + i * 4
    if (offsetPos + 4 > file.length) break
    starts.push(file.readUInt32BE(offsetPos))
  }
  return starts.length > 0 ? starts : [0]
}

/**
 * Table offsets in a collection are absolute from the start of the file, not from the face header.
 */
function parseSfntAt(file: Buffer, start: number): { sfntVersion: number; tables: SfntTable[] } {
  if (start < 0 || start + 12 > file.length) {
    throw new Error('Font face is outside the file')
  }
  const sfntVersion = file.readUInt32BE(start)
  const numTables = file.readUInt16BE(start + 4)
  const tables: SfntTable[] = []
  for (let i = 0; i < numTables; i++) {
    const o = start + 12 + i * 16
    if (o + 16 > file.length) throw new Error('Font table directory is truncated')
    const tag = file.subarray(o, o + 4).toString('ascii')
    const offset = file.readUInt32BE(o + 8)
    const length = file.readUInt32BE(o + 12)
    if (offset < 0 || length < 0 || offset + length > file.length) {
      throw new Error('Font table is truncated')
    }
    tables.push({ tag, buffer: Buffer.from(file.subarray(offset, offset + length)) })
  }
  return { sfntVersion, tables }
}

function parseSfnt(file: Buffer): { sfntVersion: number; tables: SfntTable[] } {
  return parseSfntAt(file, 0)
}

function preferredName(records: NameRecord[], nameID: number): string {
  const matches = records.filter((record) => record.nameID === nameID && record.text.trim())
  const preferred =
    matches.find((record) => record.platformID === 3 && record.languageID === 0x409) ||
    matches.find((record) => record.platformID === 1 && record.languageID === 0) ||
    matches[0]
  return preferred?.text.trim() ?? ''
}

/** Name IDs of fvar instance PostScript names. Absent when the instance record has no PS name. */
function fvarInstancePostScriptNameIds(buf: Buffer): number[] {
  if (buf.length < 16) return []
  const axesArrayOffset = buf.readUInt16BE(4)
  const axisCount = buf.readUInt16BE(8)
  const axisSize = buf.readUInt16BE(10)
  const instanceCount = buf.readUInt16BE(12)
  const instanceSize = buf.readUInt16BE(14)
  if (axisCount <= 0 || axisSize <= 0 || instanceCount <= 0 || instanceSize <= 0) return []
  // Instance coords are 16.16 Fixed (4 bytes each), after the name ID and flags.
  const postScriptOffset = 4 + axisCount * 4
  if (instanceSize < postScriptOffset + 2) return []
  const ids: number[] = []
  for (let i = 0; i < instanceCount; i++) {
    const record = axesArrayOffset + axisCount * axisSize + i * instanceSize
    if (record + postScriptOffset + 2 > buf.length) break
    const nameID = buf.readUInt16BE(record + postScriptOffset)
    if (nameID > 0) ids.push(nameID)
  }
  return ids
}

function faceStart(file: Buffer, faceIndex: number): number {
  const starts = collectionFaceStarts(file)
  return starts[faceIndex] ?? starts[0] ?? 0
}

/** Name-table string (name ID 5 is the version). Empty when the font has no such record. */
export function readFontName(filePath: string, nameID: number, faceIndex = 0): string {
  try {
    const file = fs.readFileSync(filePath)
    const { tables } = parseSfntAt(file, faceStart(file, faceIndex))
    const nameTable = tables.find((table) => table.tag === 'name')
    if (!nameTable) return ''
    return preferredName(readNameTable(nameTable.buffer), nameID)
  } catch {
    return ''
  }
}

/**
 * Default name ID 6 plus any fvar named-instance PostScript names.
 * Core Text may report an instance name for a variable font.
 */
export function readAcceptablePostScriptNames(filePath: string, faceIndex = 0): string[] {
  try {
    const file = fs.readFileSync(filePath)
    const { tables } = parseSfntAt(file, faceStart(file, faceIndex))
    const nameTable = tables.find((table) => table.tag === 'name')
    if (!nameTable) return []
    const records = readNameTable(nameTable.buffer)
    const names = new Set<string>()
    const fallback = preferredName(records, 6)
    if (fallback) names.add(fallback)
    const fvar = tables.find((table) => table.tag === 'fvar')
    if (fvar) {
      for (const nameID of fvarInstancePostScriptNameIds(fvar.buffer)) {
        const text = preferredName(records, nameID)
        if (text) names.add(text)
      }
    }
    return [...names]
  } catch {
    return []
  }
}

function packSfnt(sfntVersion: number, tables: SfntTable[]): Buffer {
  const numTables = tables.length
  const searchRange = 16 * 2 ** Math.floor(Math.log2(numTables))
  const entrySelector = Math.floor(Math.log2(numTables))
  const rangeShift = numTables * 16 - searchRange
  const headerSize = 12 + numTables * 16
  const padded = tables.map((table) => {
    const length = table.buffer.length
    const paddedLength = Math.ceil(length / 4) * 4
    const buf = Buffer.alloc(paddedLength)
    table.buffer.copy(buf)
    return { ...table, padded: buf, length }
  })
  let offset = headerSize
  const offsets: number[] = []
  for (const table of padded) {
    offsets.push(offset)
    offset += table.padded.length
  }
  const out = Buffer.alloc(offset)
  out.writeUInt32BE(sfntVersion, 0)
  out.writeUInt16BE(numTables, 4)
  out.writeUInt16BE(searchRange, 6)
  out.writeUInt16BE(entrySelector, 8)
  out.writeUInt16BE(rangeShift, 10)
  padded.forEach((table, i) => {
    const o = 12 + i * 16
    out.write(table.tag.padEnd(4, ' '), o, 4, 'ascii')
    out.writeUInt32BE(checksum(table.padded), o + 4)
    out.writeUInt32BE(offsets[i], o + 8)
    out.writeUInt32BE(table.length, o + 12)
    table.padded.copy(out, offsets[i])
  })
  const head = padded.find((table) => table.tag === 'head')
  if (head) {
    const headOffset = offsets[padded.indexOf(head)]
    out.writeUInt32BE(0, headOffset + 8)
    const adjustment = (0xb1b0afba - checksum(out)) >>> 0
    out.writeUInt32BE(adjustment, headOffset + 8)
  }
  return out
}

function rewriteNameTable(file: Buffer, family: string): Buffer {
  const { sfntVersion, tables } = parseSfnt(file)
  const nameTable = tables.find((table) => table.tag === 'name')
  if (!nameTable) {
    throw new Error('Font has no name table')
  }
  const records = readNameTable(nameTable.buffer)
  const style =
    records.find((record) => record.nameID === 17)?.text ||
    records.find((record) => record.nameID === 2)?.text ||
    'Regular'
  const psFamily = family.replace(/\s+/g, '')
  const psStyle = style.replace(/\s+/g, '')
  const full = `${family} ${style}`.trim()
  const postscript = `${psFamily}-${psStyle}`
  const unique = `${postscript};FontButler;${style}`
  const replacements: Record<number, string> = {
    1: family,
    3: unique,
    4: full,
    6: postscript,
    16: family,
    18: full,
    21: family,
    25: psFamily,
  }
  const next = records.map((record) => {
    const value = replacements[record.nameID]
    return value ? { ...record, text: value } : record
  })
  const present = new Set(next.map((record) => record.nameID))
  if (!present.has(1)) {
    next.push({
      platformID: 3,
      encodingID: 1,
      languageID: 0x409,
      nameID: 1,
      text: family,
    })
  }
  nameTable.buffer = buildNameTable(next)
  return packSfnt(sfntVersion, tables)
}

export type RenameRuntime = PythonRuntime

export function resolveRenameRuntime(options?: {
  resourcesPath?: string
  root?: string
}): RenameRuntime | null {
  return resolvePythonRuntime('rename_family.py', options)
}

export function renamePythonArgv(
  runtime: RenameRuntime,
  sourcePath: string,
  destPath: string,
  family: string,
): string[] {
  return pythonScriptArgv(runtime, [
    assertSafeShellPath(sourcePath),
    assertSafeShellPath(destPath),
    family,
  ])
}

async function renameWithPython(
  sourcePath: string,
  destPath: string,
  family: string,
): Promise<{ ok: true; source: RenameRuntime['source'] } | { ok: false; reason: string }> {
  const runtime = resolveRenameRuntime()
  if (!runtime) {
    return { ok: false, reason: 'Bundled fonttools runtime was not found.' }
  }
  try {
    await execFileAsync(runtime.command, renamePythonArgv(runtime, sourcePath, destPath, family), {
      timeout: 30_000,
      env: pythonSpawnEnv(),
    })
    if (!fs.existsSync(destPath)) {
      return { ok: false, reason: 'Python rename finished but no output file was written.' }
    }
    return { ok: true, source: runtime.source }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Python rename failed',
    }
  }
}

export async function renameFamilyCopy(
  sourcePath: string,
  family: string,
): Promise<string> {
  const ext = path.extname(sourcePath) || '.ttf'
  const destPath = path.join(
    os.tmpdir(),
    `font-butler-rename-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`,
  )
  const python = await renameWithPython(sourcePath, destPath, family)
  if (python.ok === true) {
    return destPath
  }
  const pythonReason = python.reason
  const original = fs.readFileSync(sourcePath)
  const tag = original.subarray(0, 4).toString('ascii')
  if (tag === 'wOFF' || tag === 'wOF2' || tag === 'ttcf') {
    throw new Error(`Renaming this format needs fonttools (${pythonReason}).`)
  }
  try {
    const rewritten = rewriteNameTable(original, family)
    fs.writeFileSync(destPath, rewritten)
    return destPath
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'rewrite failed'
    throw new Error(`Could not rename font (${pythonReason}; ${detail}).`)
  }
}

export function postscriptPreview(family: string, style: string): string {
  return `${family.replace(/\s+/g, '')}-${style.replace(/\s+/g, '')}`
}

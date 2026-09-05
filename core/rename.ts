import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { projectRoot } from './paths.ts'

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

function parseSfnt(file: Buffer): { sfntVersion: number; tables: SfntTable[] } {
  const sfntVersion = file.readUInt32BE(0)
  const numTables = file.readUInt16BE(4)
  const tables: SfntTable[] = []
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16
    const tag = file.subarray(o, o + 4).toString('ascii')
    const offset = file.readUInt32BE(o + 8)
    const length = file.readUInt32BE(o + 12)
    tables.push({ tag, buffer: Buffer.from(file.subarray(offset, offset + length)) })
  }
  return { sfntVersion, tables }
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

export type RenameRuntime = {
  command: string
  script: string
  source: 'bundled' | 'system'
}

function processResourcesPath(): string {
  const value = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return typeof value === 'string' ? value : ''
}

export function resolveRenameRuntime({
  resourcesPath = processResourcesPath(),
  root = projectRoot,
}: {
  resourcesPath?: string
  root?: string
} = {}): RenameRuntime | null {
  const projectScript = path.join(root, 'scripts/rename_family.py')
  const candidates: RenameRuntime[] = [
    {
      command: path.join(resourcesPath, 'python', 'bin', 'python3'),
      script: path.join(resourcesPath, 'python', 'rename_family.py'),
      source: 'bundled',
    },
    {
      command: path.join(root, 'vendor/python/bin/python3'),
      script: path.join(root, 'vendor/python/rename_family.py'),
      source: 'bundled',
    },
    {
      command: 'python3',
      script: projectScript,
      source: 'system',
    },
  ]
  for (const candidate of candidates) {
    const commandReady =
      candidate.command === 'python3' || fs.existsSync(candidate.command)
    if (commandReady && fs.existsSync(candidate.script)) {
      return candidate
    }
  }
  return null
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
    const isolated = runtime.source === 'bundled' ? ['-I'] : []
    await execFileAsync(
      runtime.command,
      [...isolated, runtime.script, sourcePath, destPath, family],
      { timeout: 30_000 },
    )
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

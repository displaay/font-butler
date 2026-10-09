import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { readAcceptablePostScriptNames, readFontName, renamePythonArgv, resolveRenameRuntime } from './rename.ts'
import { writeTestCollection, writeTestFont } from './test-util.ts'

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-rename-'))
}

test('resolveRenameRuntime prefers a packaged Python over a vendor or system runtime', () => {
  const resources = tempRoot()
  const root = tempRoot()
  const packagedPython = path.join(resources, 'python', 'bin', 'python3')
  const packagedScript = path.join(resources, 'python', 'rename_family.py')
  fs.mkdirSync(path.dirname(packagedPython), { recursive: true })
  fs.writeFileSync(packagedPython, '')
  fs.writeFileSync(packagedScript, '')
  fs.mkdirSync(path.join(root, 'vendor/python/bin'), { recursive: true })
  fs.writeFileSync(path.join(root, 'vendor/python/bin/python3'), '')
  fs.writeFileSync(path.join(root, 'vendor/python/rename_family.py'), '')
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'scripts/rename_family.py'), '')

  const runtime = resolveRenameRuntime({ resourcesPath: resources, root })
  assert.deepEqual(runtime, {
    command: packagedPython,
    script: packagedScript,
    source: 'bundled',
  })
})

test('resolveRenameRuntime uses vendor/python when the app is not packaged', () => {
  const root = tempRoot()
  const vendorPython = path.join(root, 'vendor/python/bin/python3')
  const vendorScript = path.join(root, 'vendor/python/rename_family.py')
  fs.mkdirSync(path.dirname(vendorPython), { recursive: true })
  fs.writeFileSync(vendorPython, '')
  fs.writeFileSync(vendorScript, '')
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'scripts/rename_family.py'), '')

  const runtime = resolveRenameRuntime({ resourcesPath: '', root })
  assert.deepEqual(runtime, {
    command: vendorPython,
    script: vendorScript,
    source: 'bundled',
  })
})

test('resolveRenameRuntime falls back to system python3 and the project script', () => {
  const root = tempRoot()
  const script = path.join(root, 'scripts/rename_family.py')
  fs.mkdirSync(path.dirname(script), { recursive: true })
  fs.writeFileSync(script, '')

  const runtime = resolveRenameRuntime({ resourcesPath: '', root })
  assert.deepEqual(runtime, {
    command: 'python3',
    script,
    source: 'system',
  })
})

test('rename Python argv uses -I -B for bundled runtimes and a -- separator before paths', () => {
  const script = '/tmp/rename_family.py'
  const source = '/tmp/Source.ttf'
  const dest = '/tmp/Dest.ttf'
  assert.deepEqual(
    renamePythonArgv({ command: '/runtime/python3', script, source: 'bundled' }, source, dest, 'New Family'),
    ['-I', '-B', script, '--', source, dest, 'New Family'],
  )
  assert.deepEqual(
    renamePythonArgv({ command: 'python3', script, source: 'system' }, source, dest, 'New Family'),
    ['-B', script, '--', source, dest, 'New Family'],
  )
})

test('readFontName reads name IDs from each face of a TTC or OTC', () => {
  const root = tempRoot()
  const ttc = path.join(root, 'Family.ttc')
  const otc = path.join(root, 'Family.otc')
  const single = path.join(root, 'Solo.ttf')
  try {
    writeTestCollection(ttc, [
      { family: 'Collect', psName: 'Collect-Regular', version: '2.500' },
      { family: 'Collect', psName: 'Collect-Bold', style: 'Bold', version: '9.125', weight: 700 },
    ])
    writeTestCollection(otc, [
      { family: 'CollectCFF', psName: 'CollectCFF-Regular', version: '4.000' },
      { family: 'CollectCFF', psName: 'CollectCFF-Bold', style: 'Bold', version: '4.500', weight: 700 },
    ])
    writeTestFont(single, 'Solo', 'Solo-Regular', { version: '3.250' })
    assert.match(readFontName(ttc, 5, 0), /2\.500/)
    assert.match(readFontName(ttc, 5, 1), /9\.125/)
    assert.match(readFontName(ttc, 6, 0), /Collect-Regular/)
    assert.match(readFontName(ttc, 6, 1), /Collect-Bold/)
    assert.match(readFontName(otc, 5, 0), /4\.000/)
    assert.match(readFontName(otc, 5, 1), /4\.500/)
    assert.match(readFontName(single, 5), /3\.250/)
    assert.equal(readFontName(ttc, 5), readFontName(ttc, 5, 0))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('readAcceptablePostScriptNames includes fvar named-instance PostScript names', () => {
  const root = tempRoot()
  const filePath = path.join(root, 'Variable.ttf')
  try {
    fs.writeFileSync(filePath, variableFontWithInstance('TestVF-Regular', 'TestVF-Bold'))
    const names = readAcceptablePostScriptNames(filePath)
    assert.ok(names.includes('TestVF-Regular'))
    assert.ok(names.includes('TestVF-Bold'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function variableFontWithInstance(defaultName: string, instanceName: string): Buffer {
  const strings = [
    { nameID: 6, text: defaultName },
    { nameID: 256, text: instanceName },
  ]
  const encoded = strings.map((item) => Buffer.from(item.text, 'utf16le').swap16())
  const headerSize = 6 + strings.length * 12
  const name = Buffer.alloc(headerSize + encoded.reduce((sum, item) => sum + item.length, 0))
  name.writeUInt16BE(0, 0)
  name.writeUInt16BE(strings.length, 2)
  name.writeUInt16BE(headerSize, 4)
  let cursor = 0
  strings.forEach((item, index) => {
    const o = 6 + index * 12
    name.writeUInt16BE(3, o)
    name.writeUInt16BE(1, o + 2)
    name.writeUInt16BE(0x409, o + 4)
    name.writeUInt16BE(item.nameID, o + 6)
    name.writeUInt16BE(encoded[index]!.length, o + 8)
    name.writeUInt16BE(cursor, o + 10)
    encoded[index]!.copy(name, headerSize + cursor)
    cursor += encoded[index]!.length
  })
  const axis = Buffer.alloc(20)
  axis.write('wght', 0, 4, 'ascii')
  const fvar = Buffer.alloc(16 + 20 + 8)
  fvar.writeUInt16BE(1, 0)
  fvar.writeUInt16BE(0, 2)
  fvar.writeUInt16BE(16, 4)
  fvar.writeUInt16BE(0, 6)
  fvar.writeUInt16BE(1, 8)
  fvar.writeUInt16BE(20, 10)
  fvar.writeUInt16BE(1, 12)
  fvar.writeUInt16BE(8, 14)
  axis.copy(fvar, 16)
  const instance = 16 + 20
  fvar.writeUInt16BE(2, instance)
  fvar.writeUInt16BE(0, instance + 2)
  fvar.writeInt16BE(0, instance + 4)
  fvar.writeUInt16BE(256, instance + 6)
  const tables = [
    { tag: 'fvar', buffer: fvar },
    { tag: 'name', buffer: name },
  ]
  const numTables = tables.length
  const headerSizeSfnt = 12 + numTables * 16
  let offset = headerSizeSfnt
  const out = Buffer.alloc(headerSizeSfnt + fvar.length + name.length + 8)
  out.writeUInt32BE(0x00010000, 0)
  out.writeUInt16BE(numTables, 4)
  tables.forEach((table, index) => {
    const o = 12 + index * 16
    out.write(table.tag, o, 4, 'ascii')
    out.writeUInt32BE(0, o + 4)
    out.writeUInt32BE(offset, o + 8)
    out.writeUInt32BE(table.buffer.length, o + 12)
    table.buffer.copy(out, offset)
    offset += table.buffer.length
  })
  return out.subarray(0, offset)
}

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  glyphNameForCodePoint,
  inspectSfntTables,
  parseFontFile,
  previewUsesInstalledBytes,
  resolveFamilyNames,
  sfntTablesFit,
} from './parse.ts'
import { loadCatalog, saveCatalog } from './catalog.ts'
import { writeTestCollection, writeTestFont, withService } from './test-util.ts'

test('resolveFamilyNames prefers typographic family and style', () => {
  assert.deepEqual(
    resolveFamilyNames({
      familyName: 'Booton ExtraLight',
      subfamilyName: 'Italic',
      preferredFamily: 'Booton',
      preferredSubfamily: 'ExtraLight Italic',
    }),
    { familyName: 'Booton', styleName: 'ExtraLight Italic' },
  )
})

test('resolveFamilyNames falls back to name ID 1/2', () => {
  assert.deepEqual(
    resolveFamilyNames({
      familyName: 'Booton',
      subfamilyName: 'Bold',
    }),
    { familyName: 'Booton', styleName: 'Bold' },
  )
})

test('parseFontFile survives a VF named instance with no name record', (t) => {
  const file = '/Users/danielquisek/Library/Fonts/AguzzoVF.ttf'
  if (!fs.existsSync(file)) {
    t.skip('Aguzzo VF is not installed on this machine')
    return
  }
  const parsed = parseFontFile(file)
  assert.ok(parsed.previewSample)
  assert.equal(parsed.faces[0]?.isVariable, true)
  assert.ok((parsed.faces[0]?.instanceNames.length ?? 0) > 1)
  assert.ok(parsed.faces[0]?.postscriptName)
})

test('parseFontFile reads every face from a synthetic TTC and OTC', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-ttc-parse-'))
  try {
    const ttc = path.join(dir, 'Pack.ttc')
    writeTestCollection(ttc, [
      { family: 'Pack', psName: 'Pack-Regular', style: 'Regular' },
      { family: 'Pack', psName: 'Pack-Bold', style: 'Bold' },
    ])
    const parsedTtc = parseFontFile(ttc)
    assert.equal(parsedTtc.format, 'ttc')
    assert.equal(parsedTtc.faces.length, 2)
    assert.deepEqual(
      parsedTtc.faces.map((face) => face.postscriptName).sort(),
      ['Pack-Bold', 'Pack-Regular'],
    )
    assert.equal(parsedTtc.faces.find((face) => face.styleName === 'Bold')?.weight, 700)

    const otc = path.join(dir, 'Pack.otc')
    writeTestCollection(otc, [
      { family: 'Pack', psName: 'Pack-Regular', style: 'Regular', format: 'otf' },
      { family: 'Pack', psName: 'Pack-Bold', style: 'Bold', format: 'otf' },
    ])
    const parsedOtc = parseFontFile(otc, { previewMeta: true })
    assert.equal(parsedOtc.format, 'otc')
    assert.equal(parsedOtc.faces.length, 2)
    assert.ok(parsedOtc.characterSet?.includes(65))
    const catalogParse = parseFontFile(otc)
    assert.equal(catalogParse.characterSet, undefined)
    assert.equal(catalogParse.features, undefined)
    assert.equal(catalogParse.previewSample, 'AA')
    const facesOnly = parseFontFile(otc, { previewSample: false })
    assert.equal(facesOnly.previewSample, undefined)
    assert.equal(facesOnly.faces.length, 2)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('parseFontFile groups Booton OTFs under the typographic family', (t) => {
  const dir =
    '/Users/danielquisek/git/ms-office-safe-export/artifacts/test-fonts/Booton/Desktop package (OTF, TTF)/OTF'
  if (!fs.existsSync(dir)) {
    t.skip('Booton test fonts are not on this machine')
    return
  }
  const files = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.otf'))
  assert.equal(files.length, 16)
  const parsed = files.map((name) => ({
    name,
    ...parseFontFile(path.join(dir, name)).faces[0],
  }))
  assert.deepEqual([...new Set(parsed.map((face) => face.familyName))], ['Booton'])
  assert.deepEqual(
    parsed
      .map((face) => face.styleName)
      .sort((a, b) => a.localeCompare(b)),
    [
      'Bold',
      'Bold Italic',
      'ExtraLight',
      'ExtraLight Italic',
      'Heavy',
      'Heavy Italic',
      'Italic',
      'Light',
      'Light Italic',
      'Medium',
      'Medium Italic',
      'Regular',
      'SemiBold',
      'SemiBold Italic',
      'Thin',
      'Thin Italic',
    ],
  )
})

test('parseFontFile picks a Font Book-style preview sample from cmap coverage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-preview-sample-'))
  try {
    const latin = path.join(dir, 'Latin.ttf')
    writeTestFont(latin, 'Latin', 'Latin-Regular', {
      codePoints: [65, 66, 67, 97, 98, 99],
    })
    assert.equal(parseFontFile(latin).previewSample, 'Aa')

    const hebrew = path.join(dir, 'Hebrew.ttf')
    writeTestFont(hebrew, 'Hebrew', 'Hebrew-Regular', {
      codePoints: [65, 97, 0x05d0, 0x05d1, 0x05d2, 0x05d3, 0x05d4, 0x05d5],
    })
    assert.equal(parseFontFile(hebrew).previewSample, 'א')

    const noto = path.join(dir, 'Noto.ttf')
    writeTestFont(noto, 'Noto', 'Noto-Regular', {
      codePoints: [
        65, 97,
        0x0391, 0x03b1, 0x0392, 0x03b2, 0x0393, 0x03b3,
        0x0410, 0x0430, 0x0411, 0x0431, 0x0412, 0x0432,
        0x0915, 0x0916, 0x0917, 0x0918, 0x0919,
      ],
    })
    assert.equal(parseFontFile(noto).previewSample, 'Aa')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('previewUsesInstalledBytes requires a live managed or parked file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-preview-bytes-'))
  try {
    const live = path.join(dir, 'Live.ttf')
    const missing = path.join(dir, 'Gone.ttf')
    fs.writeFileSync(live, 'font')
    assert.equal(previewUsesInstalledBytes({}), false)
    assert.equal(previewUsesInstalledBytes({ installedPath: missing }), false)
    assert.equal(previewUsesInstalledBytes({ disabledPath: missing }), false)
    assert.equal(
      previewUsesInstalledBytes({
        installations: [{ path: missing, verification: 'unavailable' }],
      }),
      false,
    )
    assert.equal(previewUsesInstalledBytes({ installedPath: live }), true)
    assert.equal(previewUsesInstalledBytes({ disabledPath: live }), true)
    assert.equal(
      previewUsesInstalledBytes({
        installations: [{ path: live, verification: 'file-present' }],
      }),
      true,
    )
    assert.equal(
      previewUsesInstalledBytes({
        installations: [{ path: missing, parkedPath: live, verification: 'unavailable' }],
      }),
      true,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('glyphNameForCodePoint reads the PostScript glyph name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-glyph-name-'))
  try {
    const file = path.join(dir, 'Pack-Regular.ttf')
    writeTestFont(file, 'Pack', 'Pack-Regular')
    assert.equal(glyphNameForCodePoint(file, 65), 'A')
    assert.equal(glyphNameForCodePoint(file, 66), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('import persists the cmap preview sample on the catalog entry', async () => {
  await withService(async (service, paths) => {
    const file = path.join(paths.uploadsDir, 'Hebrew.ttf')
    writeTestFont(file, 'Hebrew', 'Hebrew-Regular', {
      codePoints: [65, 97, 0x05d0, 0x05d1, 0x05d2, 0x05d3, 0x05d4, 0x05d5],
    })
    const result = await service.importPaths([file])
    assert.equal(result.entries[0]?.previewSample, 'א')
  })
})

test('source cmap change does not overwrite preview sample while installed bytes are shown', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'Live.ttf')
    writeTestFont(source, 'Live', 'Live-Regular', {
      codePoints: [65, 66, 67, 97, 98, 99],
    })
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    assert.equal(installed.previewSample, 'Aa')
    assert.equal(previewUsesInstalledBytes(installed), true)
    assert.ok(installed.installedPath)
    assert.notEqual(installed.installedPath, source)

    writeTestFont(source, 'Live', 'Live-Regular', {
      codePoints: [65, 97, 0x05d0, 0x05d1, 0x05d2, 0x05d3, 0x05d4, 0x05d5],
    })
    const later = Date.now() / 1000 + 2
    fs.utimesSync(source, later, later)
    assert.equal(parseFontFile(source).previewSample, 'א')
    assert.equal(parseFontFile(installed.installedPath!).previewSample, 'Aa')

    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'outdated')
    assert.equal(previewUsesInstalledBytes(entry), true)
    assert.equal(entry.previewSample, 'Aa')
  })
})

test('unavailable or missing managed copies follow the source preview sample', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'Stale.ttf')
    writeTestFont(source, 'Stale', 'Stale-Regular', {
      codePoints: [65, 66, 67, 97, 98, 99],
    })
    const imported = await service.importPaths([source])
    const catalog = loadCatalog(paths)
    const stale = catalog.entries.find((item) => item.id === imported.entries[0]!.id)
    assert.ok(stale)
    stale.previewSample = 'Aa'
    stale.installations = [
      {
        destinationId: 'adobe-shared',
        path: path.join(paths.adobeFontsDir, 'missing', 'Stale.ttf'),
        verification: 'unavailable',
      },
    ]
    saveCatalog(paths, catalog)
    assert.equal(previewUsesInstalledBytes(stale), false)

    writeTestFont(source, 'Stale', 'Stale-Regular', {
      codePoints: [65, 97, 0x05d0, 0x05d1, 0x05d2, 0x05d3, 0x05d4, 0x05d5],
    })
    const later = Date.now() / 1000 + 2
    fs.utimesSync(source, later, later)
    assert.equal(parseFontFile(source).previewSample, 'א')

    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(previewUsesInstalledBytes(entry), false)
    assert.equal(entry.previewSample, 'א')
  })
})

test('uninstalled source cmap change updates the preview sample', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'Idle.ttf')
    writeTestFont(source, 'Idle', 'Idle-Regular', {
      codePoints: [65, 66, 67, 97, 98, 99],
    })
    const imported = await service.importPaths([source])
    assert.equal(imported.entries[0]?.status, 'uninstalled')
    assert.equal(imported.entries[0]?.previewSample, 'Aa')
    assert.equal(previewUsesInstalledBytes(imported.entries[0]!), false)

    writeTestFont(source, 'Idle', 'Idle-Regular', {
      codePoints: [65, 97, 0x05d0, 0x05d1, 0x05d2, 0x05d3, 0x05d4, 0x05d5],
    })
    const later = Date.now() / 1000 + 2
    fs.utimesSync(source, later, later)

    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'uninstalled')
    assert.equal(previewUsesInstalledBytes(entry), false)
    assert.equal(entry.previewSample, 'א')
  })
})

test('sfntTablesFit rejects tables past the end of the file and a zero-filled head', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-sfnt-'))
  try {
    const font = path.join(root, 'Fit.ttf')
    writeTestFont(font, 'Fit', 'Fit-Regular')
    const bytes = fs.readFileSync(font)
    assert.equal(sfntTablesFit(font), true)

    const truncated = path.join(root, 'Truncated.ttf')
    fs.writeFileSync(truncated, bytes.subarray(0, 32))
    assert.equal(sfntTablesFit(truncated), false)

    const overrun = Buffer.from(bytes)
    overrun.writeUInt32BE(bytes.length + 64, 12 + 12)
    const overrunPath = path.join(root, 'Overrun.ttf')
    fs.writeFileSync(overrunPath, overrun)
    const overrunCheck = inspectSfntTables(overrunPath)
    assert.equal(overrunCheck.ok, false)
    if (!overrunCheck.ok) assert.match(overrunCheck.reason, /extends past the end/)

    const numTables = bytes.readUInt16BE(4)
    let lastIndex = 0
    let lastEnd = -1
    for (let index = 0; index < numTables; index += 1) {
      const base = 12 + index * 16
      const end = bytes.readUInt32BE(base + 8) + bytes.readUInt32BE(base + 12)
      if (end > lastEnd) {
        lastEnd = end
        lastIndex = index
      }
    }
    const slack = Buffer.from(bytes)
    const offsetAt = 12 + lastIndex * 16 + 8
    const lengthAt = offsetAt + 4
    const tableOffset = bytes.readUInt32BE(offsetAt)
    slack.writeUInt32BE(bytes.length + 3 - tableOffset, lengthAt)
    const slackPath = path.join(root, 'Slack.ttf')
    fs.writeFileSync(slackPath, slack)
    const slackCheck = inspectSfntTables(slackPath)
    assert.equal(slackCheck.ok, false)
    if (!slackCheck.ok) assert.match(slackCheck.reason, /extends past the end/)
    slack.writeUInt32BE(bytes.length + 4 - tableOffset, lengthAt)
    fs.writeFileSync(slackPath, slack)
    const slackOver = inspectSfntTables(slackPath)
    assert.equal(slackOver.ok, false)
    if (!slackOver.ok) assert.match(slackOver.reason, /extends past the end/)

    const truncatedCheck = inspectSfntTables(truncated)
    assert.equal(truncatedCheck.ok, false)
    if (!truncatedCheck.ok) assert.match(truncatedCheck.reason, /table directory|sfnt header/)

    const blankHead = Buffer.from(bytes)
    let zeroedHead = false
    for (let index = 0; index < numTables; index += 1) {
      const base = 12 + index * 16
      if (blankHead.subarray(base, base + 4).toString('ascii') !== 'head') continue
      const offset = blankHead.readUInt32BE(base + 8)
      const length = blankHead.readUInt32BE(base + 12)
      blankHead.fill(0, offset, offset + length)
      zeroedHead = true
    }
    assert.equal(zeroedHead, true)
    const blankHeadPath = path.join(root, 'BlankHead.ttf')
    fs.writeFileSync(blankHeadPath, blankHead)
    const blankCheck = inspectSfntTables(blankHeadPath)
    assert.equal(blankCheck.ok, false)
    if (!blankCheck.ok) assert.match(blankCheck.reason, /head table is still zero-filled/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

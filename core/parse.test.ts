import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { glyphNameForCodePoint, parseFontFile, previewUsesInstalledBytes, resolveFamilyNames } from './parse.ts'
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

test('previewUsesInstalledBytes is true when catalog cards paint installed bytes', () => {
  assert.equal(previewUsesInstalledBytes({}), false)
  assert.equal(previewUsesInstalledBytes({ installedPath: '/tmp/installed.ttf' }), true)
  assert.equal(previewUsesInstalledBytes({ disabledPath: '/tmp/disabled.ttf' }), true)
  assert.equal(previewUsesInstalledBytes({ installations: [{ path: '/tmp/adobe.ttf' }] }), true)
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

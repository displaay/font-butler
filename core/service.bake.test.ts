import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { isExternalSource } from './catalog.ts'
import { parseFontFile } from './parse.ts'
import { withService } from './test-util.ts'

function writeSs01Font(dest: string, family: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const script = `
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

def rect(width):
    pen = TTGlyphPen(None)
    pen.moveTo((50, 0))
    pen.lineTo((width - 50, 0))
    pen.lineTo((width - 50, 700))
    pen.lineTo((50, 700))
    pen.closePath()
    return pen.glyph()

builder = FontBuilder(1000, isTTF=True)
builder.setupGlyphOrder([".notdef", "space", "a", "a.ss01"])
builder.setupCharacterMap({0x0020: "space", 0x0061: "a"})
builder.setupGlyf({
    ".notdef": rect(500),
    "space": TTGlyphPen(None).glyph(),
    "a": rect(200),
    "a.ss01": rect(300),
})
builder.setupHorizontalMetrics({
    ".notdef": (500, 0),
    "space": (300, 0),
    "a": (200, 0),
    "a.ss01": (300, 10),
})
builder.setupHorizontalHeader(ascent=800, descent=-200)
builder.setupNameTable({
    "familyName": ${JSON.stringify(family)},
    "styleName": "Regular",
    "uniqueFontIdentifier": ${JSON.stringify(`${family.replace(/\s+/g, '')}-Regular`)},
    "fullName": ${JSON.stringify(`${family} Regular`)},
    "psName": ${JSON.stringify(`${family.replace(/\s+/g, '')}-Regular`)},
    "version": "Version 1.0",
})
builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
builder.setupPost()
font = builder.font
addOpenTypeFeaturesFromString(font, """
languagesystem DFLT dflt;
feature ss01 {
    sub a by a.ss01;
} ss01;
""")
font.save(${JSON.stringify(dest)})
`
  execFileSync('python3', ['-c', script], { stdio: 'pipe' })
}

function glyphMetrics(filePath: string): { width: number; lsb: number; tags: string[] } {
  const script = `
from fontTools.ttLib import TTFont
font = TTFont(${JSON.stringify(filePath)})
width, lsb = font["hmtx"].metrics["a"]
tags = []
if "GSUB" in font:
    tags = [record.FeatureTag for record in font["GSUB"].table.FeatureList.FeatureRecord]
print(width, lsb, ",".join(tags))
`
  const stdout = execFileSync('python3', ['-c', script], { encoding: 'utf8' }).trim()
  const [width, lsb, tags] = stdout.split(' ')
  return {
    width: Number(width),
    lsb: Number(lsb),
    tags: tags ? tags.split(',').filter(Boolean) : [],
  }
}

test('bake reinstall swaps default glyphs in the current font', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const font = path.join(paths.dataRoot, 'BakeFace.ttf')
    writeSs01Font(font, 'BakeFace')
    const imported = await service.importPaths([font])
    const original = imported.entries[0]
    assert.ok(original)
    const installed = await service.install(original.id)
    const before = glyphMetrics(installed.sourcePath)
    assert.equal(before.width, 200)
    assert.ok(before.tags.includes('ss01'))

    const baked = await service.bakeFeatures(installed.id, ['ss01'], 'reinstall')
    assert.equal(baked.entry.id, installed.id)
    assert.equal(baked.report.changed, true)
    assert.ok(baked.report.appliedFeatures.includes('ss01'))
    const after = glyphMetrics(baked.entry.sourcePath)
    assert.equal(after.width, 300)
    assert.equal(after.lsb, 10)
    assert.equal(after.tags.includes('ss01'), false)
    const preview = parseFontFile(baked.entry.sourcePath, { previewMeta: true })
    assert.equal((preview.features ?? []).includes('ss01'), false)
  })
})

test('bake new-copy leaves the original font unchanged', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const font = path.join(paths.dataRoot, 'CopyFace.ttf')
    writeSs01Font(font, 'CopyFace')
    const imported = await service.importPaths([font])
    const original = imported.entries[0]
    assert.ok(original)
    await service.install(original.id)
    const before = glyphMetrics(original.sourcePath)

    const baked = await service.bakeFeatures(original.id, ['ss01'], 'new-copy', 'CopyFace SS01')
    assert.notEqual(baked.entry.id, original.id)
    assert.equal(baked.entry.faces[0]?.familyName, 'CopyFace SS01')
    assert.equal(isExternalSource(baked.entry), false)
    const copyMetrics = glyphMetrics(baked.entry.installedPath ?? baked.entry.sourcePath)
    assert.equal(copyMetrics.width, 300)
    assert.equal(copyMetrics.tags.includes('ss01'), false)
    assert.deepEqual(glyphMetrics(original.sourcePath), before)
    const leftover = service.listCatalog().find((entry) => entry.id === original.id)
    assert.ok(leftover)
    assert.equal(leftover.faces[0]?.familyName, 'CopyFace')
  })
})

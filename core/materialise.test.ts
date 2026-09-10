import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { materialisePythonArgv, resolveMaterialiseRuntime } from './materialise.ts'
import { resolvePythonRuntime } from './python-runtime.ts'

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-materialise-'))
}

function writeSs01Font(dest: string): void {
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
    "familyName": "Materialise SS01",
    "styleName": "Regular",
    "uniqueFontIdentifier": "MaterialiseSS01-Regular",
    "fullName": "Materialise SS01 Regular",
    "psName": "MaterialiseSS01-Regular",
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

function writeChainedFont(dest: string): void {
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
builder.setupGlyphOrder([".notdef", "space", "a", "a.ss04", "a.ss09", "a.ss04.ss09"])
builder.setupCharacterMap({0x0020: "space", 0x0061: "a"})
builder.setupGlyf({
    ".notdef": rect(500),
    "space": TTGlyphPen(None).glyph(),
    "a": rect(200),
    "a.ss04": rect(300),
    "a.ss09": rect(400),
    "a.ss04.ss09": rect(500),
})
builder.setupHorizontalMetrics({
    ".notdef": (500, 0),
    "space": (300, 0),
    "a": (200, 0),
    "a.ss04": (300, 10),
    "a.ss09": (400, 20),
    "a.ss04.ss09": (500, 30),
})
builder.setupHorizontalHeader(ascent=800, descent=-200)
builder.setupNameTable({
    "familyName": "Chained SS",
    "styleName": "Regular",
    "uniqueFontIdentifier": "ChainedSS-Regular",
    "fullName": "Chained SS Regular",
    "psName": "ChainedSS-Regular",
    "version": "Version 1.0",
})
builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
builder.setupPost()
font = builder.font
addOpenTypeFeaturesFromString(font, """
languagesystem DFLT dflt;
feature ss04 {
    sub a by a.ss04;
    sub a.ss09 by a.ss04.ss09;
} ss04;
feature ss09 {
    sub a by a.ss09;
    sub a.ss04 by a.ss04.ss09;
} ss09;
""")
font.save(${JSON.stringify(dest)})
`
  execFileSync('python3', ['-c', script], { stdio: 'pipe' })
}

function inspectFont(filePath: string): { width: number; lsb: number; tags: string[] } {
  const script = `
from fontTools.ttLib import TTFont
font = TTFont(${JSON.stringify(filePath)})
width, lsb = font["hmtx"].metrics["a"]
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

function runCli(input: string, output: string, tags: string[]): {
  appliedFeatures: string[]
  skippedWarnings: string[]
  mapping: Array<{ source: string; replacement: string }>
  errors: string[]
  changed: boolean
} {
  const runtime = resolveMaterialiseRuntime()
  assert.ok(runtime)
  const stdout = execFileSync(runtime.command, materialisePythonArgv(runtime, input, output, tags), {
    encoding: 'utf8',
  })
  return JSON.parse(stdout.slice(stdout.indexOf('{')))
}

test('resolvePythonRuntime finds materialise_feature.py next to rename_family.py', () => {
  const resources = tempRoot()
  const root = tempRoot()
  const packagedPython = path.join(resources, 'python', 'bin', 'python3')
  const packagedScript = path.join(resources, 'python', 'materialise_feature.py')
  fs.mkdirSync(path.dirname(packagedPython), { recursive: true })
  fs.writeFileSync(packagedPython, '')
  fs.writeFileSync(packagedScript, '')
  const runtime = resolvePythonRuntime('materialise_feature.py', { resourcesPath: resources, root })
  assert.deepEqual(runtime, {
    command: packagedPython,
    script: packagedScript,
    source: 'bundled',
  })
})

test('materialise Python argv uses -I for bundled runtimes and a -- separator', () => {
  const script = '/tmp/materialise_feature.py'
  assert.deepEqual(
    materialisePythonArgv(
      { command: '/runtime/python3', script, source: 'bundled' },
      '/tmp/Source.ttf',
      '/tmp/Dest.ttf',
      ['ss01', 'tnum'],
    ),
    ['-I', script, '--', '/tmp/Source.ttf', '/tmp/Dest.ttf', 'ss01', 'tnum'],
  )
})

test('CLI swaps ss01 into the default glyph and removes the feature', () => {
  const dir = tempRoot()
  const input = path.join(dir, 'ss01.ttf')
  const output = path.join(dir, 'ss01-baked.ttf')
  writeSs01Font(input)
  const before = inspectFont(input)
  assert.equal(before.width, 200)
  assert.ok(before.tags.includes('ss01'))
  const report = runCli(input, output, ['ss01'])
  assert.equal(report.changed, true)
  assert.deepEqual(report.appliedFeatures, ['ss01'])
  assert.deepEqual(
    report.mapping.map((item) => [item.source, item.replacement]),
    [['a', 'a.ss01']],
  )
  const after = inspectFont(output)
  assert.equal(after.width, 300)
  assert.equal(after.lsb, 10)
  assert.equal(after.tags.includes('ss01'), false)
})

test('CLI skips missing features without writing a changed font', () => {
  const dir = tempRoot()
  const input = path.join(dir, 'ss01.ttf')
  const output = path.join(dir, 'ss01-skipped.ttf')
  writeSs01Font(input)
  const before = fs.readFileSync(input)
  const report = runCli(input, output, ['ss05', 'tnum'])
  assert.equal(report.changed, false)
  assert.equal(report.appliedFeatures.length, 0)
  assert.equal(report.skippedWarnings.length, 2)
  assert.equal(fs.existsSync(output), false)
  assert.deepEqual(fs.readFileSync(input), before)
})

test('CLI composes chained stylistic sets in GSUB lookup order', () => {
  const dir = tempRoot()
  const input = path.join(dir, 'chained.ttf')
  const output = path.join(dir, 'chained-baked.ttf')
  writeChainedFont(input)
  const report = runCli(input, output, ['ss04', 'ss09'])
  assert.equal(report.changed, true)
  assert.deepEqual(
    new Set(report.mapping.map((item) => `${item.source}->${item.replacement}`)),
    new Set(['a->a.ss04.ss09']),
  )
  const after = inspectFont(output)
  assert.equal(after.width, 500)
  assert.equal(after.lsb, 30)
})

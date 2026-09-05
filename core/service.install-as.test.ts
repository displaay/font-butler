import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { isExternalSource, saveCatalog } from './catalog.ts'
import type { AppPaths } from './paths.ts'
import { FontButlerService } from './service.ts'
import { closeAllWatchers } from './watch.ts'
import type { CatalogEntry } from './types.ts'

function tempPaths(): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-install-as-'))
  const userFontsDir = path.join(dataRoot, 'user-fonts')
  return {
    dataRoot,
    catalogPath: path.join(dataRoot, 'catalog.json'),
    settingsPath: path.join(dataRoot, 'settings.json'),
    apiTokenPath: path.join(dataRoot, 'token'),
    installDir: userFontsDir,
    disabledDir: path.join(dataRoot, 'disabled'),
    sourcesDir: path.join(dataRoot, 'sources'),
    uploadsDir: path.join(dataRoot, 'uploads'),
    systemCachePath: path.join(dataRoot, 'system.json'),
    seedDir: path.join(dataRoot, 'seed'),
    userFontsDir,
    computerFontsDir: path.join(dataRoot, 'computer-fonts'),
    systemFontsDir: path.join(dataRoot, 'system-fonts'),
    supplementalFontsDir: path.join(dataRoot, 'supplemental'),
    officeFontCacheDir: path.join(dataRoot, 'office-cache'),
    atsCacheDir: path.join(dataRoot, 'ats-cache'),
  }
}

function writeTestFont(dest: string, family: string, psName: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const script = `
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder([".notdef", "A"])
fb.setupCharacterMap({65: "A"})
empty = TTGlyphPen(None).glyph()
pen = TTGlyphPen(None)
pen.moveTo((0, 0))
pen.lineTo((500, 0))
pen.lineTo((250, 700))
pen.closePath()
fb.setupGlyf({".notdef": empty, "A": pen.glyph()})
fb.setupHorizontalMetrics({".notdef": (500, 0), "A": (600, 0)})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({
    "familyName": ${JSON.stringify(family)},
    "styleName": "Regular",
    "uniqueFontIdentifier": ${JSON.stringify(psName)},
    "fullName": ${JSON.stringify(`${family} Regular`)},
    "psName": ${JSON.stringify(psName)},
    "version": "Version 1.000",
})
fb.setupOS2()
fb.setupPost()
fb.save(${JSON.stringify(dest)})
`
  execFileSync('python3', ['-c', script], { stdio: 'pipe' })
}

function familyOf(entry: CatalogEntry): string {
  return entry.customFamilyName || entry.faces[0]?.familyName || ''
}

test('install as keeps the original sourced and treats the renamed copy as self-sourced', async () => {
  const paths = tempPaths()
  const font = path.join(paths.dataRoot, 'SourceFace.ttf')
  writeTestFont(font, 'SourceFace', 'SourceFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const imported = await service.importPaths([font])
    const original = imported.entries[0]
    assert.ok(original)
    const installed = await service.install(original.id, 'Renamed Face')
    assert.equal(familyOf(installed), 'Renamed Face')
    assert.equal(installed.status, 'installed')
    assert.equal(installed.sourcePath, installed.installedPath)
    assert.equal(installed.sourcePresent, false)
    assert.equal(isExternalSource(installed), false)
    assert.notEqual(installed.id, original.id)

    const catalog = service.listCatalog()
    assert.equal(catalog.length, 2)
    const leftover = catalog.find((entry) => entry.id === original.id)
    assert.ok(leftover)
    assert.equal(familyOf(leftover), 'SourceFace')
    assert.equal(leftover.status, 'uninstalled')
    assert.equal(path.resolve(leftover.sourcePath), path.resolve(font))
    assert.equal(leftover.sourcePresent, true)
    assert.equal(leftover.customFamilyName, undefined)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('init detaches a renamed install that still points at the original source', async () => {
  const paths = tempPaths()
  const source = path.join(paths.dataRoot, 'Original.ttf')
  const installed = path.join(paths.userFontsDir, 'Renamed.ttf')
  writeTestFont(source, 'Original', 'Original-Regular')
  writeTestFont(installed, 'Renamed', 'Renamed-Regular')
  const stat = fs.statSync(installed)
  saveCatalog(paths, {
    version: 1,
    entries: [
      {
        id: 'renamed',
        sourcePath: source,
        sourceMtimeMs: stat.mtimeMs,
        sourceSize: stat.size,
        sourcePresent: true,
        status: 'installed',
        installedPath: installed,
        customFamilyName: 'Renamed',
        faces: [
          {
            familyName: 'Renamed',
            styleName: 'Regular',
            fullName: 'Renamed Regular',
            postscriptName: 'Renamed-Regular',
            isVariable: false,
            instanceCount: 1,
            instanceNames: [],
            weight: 400,
            italic: false,
          },
        ],
        format: 'ttf',
        addedAt: 1,
        updatedAt: 1,
      },
    ],
  })
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const catalog = service.listCatalog()
    const renamed = catalog.find((entry) => entry.id === 'renamed')
    assert.ok(renamed)
    assert.equal(path.resolve(renamed.sourcePath), path.resolve(installed))
    assert.equal(renamed.sourcePresent, false)
    assert.equal(renamed.customFamilyName, undefined)
    const original = catalog.find((entry) => path.resolve(entry.sourcePath) === path.resolve(source))
    assert.ok(original)
    assert.equal(familyOf(original), 'Original')
    assert.equal(original.status, 'uninstalled')
    assert.equal(original.sourcePresent, true)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

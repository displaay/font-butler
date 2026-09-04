import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { saveCatalog } from './catalog.ts'
import type { AppPaths } from './paths.ts'
import { FontButlerService } from './service.ts'
import type { CatalogEntry } from './types.ts'

function tempPaths(): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-source-'))
  return {
    dataRoot,
    catalogPath: path.join(dataRoot, 'catalog.json'),
    settingsPath: path.join(dataRoot, 'settings.json'),
    apiTokenPath: path.join(dataRoot, 'token'),
    installDir: path.join(dataRoot, 'install'),
    disabledDir: path.join(dataRoot, 'disabled'),
    sourcesDir: path.join(dataRoot, 'sources'),
    uploadsDir: path.join(dataRoot, 'uploads'),
    systemCachePath: path.join(dataRoot, 'system.json'),
    seedDir: path.join(dataRoot, 'seed'),
    userFontsDir: path.join(dataRoot, 'user-fonts'),
    computerFontsDir: path.join(dataRoot, 'computer-fonts'),
    systemFontsDir: path.join(dataRoot, 'system-fonts'),
    supplementalFontsDir: path.join(dataRoot, 'supplemental'),
    officeFontCacheDir: path.join(dataRoot, 'office-cache'),
    atsCacheDir: path.join(dataRoot, 'ats-cache'),
  }
}

function writeTestFont(dest: string, family: string, psName: string): void {
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

function installedEntry(sourcePath: string, installedPath: string): CatalogEntry {
  return {
    id: 'entry-1',
    sourcePath,
    sourceMtimeMs: 1,
    sourceSize: 4,
    sourcePresent: true,
    status: 'installed',
    installedPath,
    faces: [],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
  }
}

test('init keeps an installed font installed after its source file is removed', async () => {
  const paths = tempPaths()
  const source = path.join(paths.dataRoot, 'Source.ttf')
  const installed = path.join(paths.installDir, 'Installed.ttf')
  fs.mkdirSync(paths.installDir, { recursive: true })
  fs.writeFileSync(source, 'font')
  fs.writeFileSync(installed, 'font')
  saveCatalog(paths, { version: 1, entries: [installedEntry(source, installed)] })
  const service = new FontButlerService(paths)
  try {
    fs.rmSync(source)
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'installed')
    assert.equal(entry.sourcePresent, false)
    assert.equal(entry.installedPath, installed)
    assert.equal(fs.existsSync(installed), true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('init marks an uninstalled font source-missing when its file is gone', async () => {
  const paths = tempPaths()
  const source = path.join(paths.dataRoot, 'Gone.ttf')
  fs.writeFileSync(source, 'font')
  saveCatalog(paths, {
    version: 1,
    entries: [
      {
        ...installedEntry(source, path.join(paths.installDir, 'missing.ttf')),
        status: 'uninstalled',
        installedPath: undefined,
      },
    ],
  })
  const service = new FontButlerService(paths)
  try {
    fs.rmSync(source)
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'source-missing')
    assert.equal(entry.sourcePresent, false)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('importPaths reuses a catalog entry for the same source path', async () => {
  const paths = tempPaths()
  const font = path.join(paths.dataRoot, 'Same.ttf')
  writeTestFont(font, 'SameFace', 'SameFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const first = await service.importPaths([font])
    const second = await service.importPaths([font])
    assert.equal(first.entries.length, 1)
    assert.equal(second.entries.length, 1)
    assert.equal(first.entries[0].id, second.entries[0].id)
    assert.equal(service.listCatalog().length, 1)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('importPaths reuses an uninstalled upload when the same font arrives from another path', async () => {
  const paths = tempPaths()
  const first = path.join(paths.dataRoot, 'First.ttf')
  const second = path.join(paths.dataRoot, 'Copy', 'Second.ttf')
  fs.mkdirSync(path.dirname(second), { recursive: true })
  writeTestFont(first, 'DupFace', 'DupFace-Regular')
  fs.copyFileSync(first, second)
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const imported = await service.importPaths([first])
    assert.equal(imported.entries[0].status, 'uninstalled')
    const again = await service.importPaths([second])
    assert.equal(again.entries[0].id, imported.entries[0].id)
    assert.equal(again.entries[0].sourcePath, path.resolve(second))
    assert.equal(again.entries[0].status, 'uninstalled')
    assert.equal(service.listCatalog().length, 1)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('importing an already installed font keeps the same entry installed', async () => {
  const paths = tempPaths()
  const font = path.join(paths.dataRoot, 'Keep.ttf')
  writeTestFont(font, 'KeepFace', 'KeepFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const imported = await service.importPaths([font])
    const installed = await service.install(imported.entries[0].id)
    assert.equal(installed.status, 'installed')
    const again = await service.importPaths([font])
    assert.equal(again.entries[0].id, installed.id)
    assert.equal(again.entries[0].status, 'installed')
    const still = await service.install(installed.id)
    assert.equal(still.status, 'installed')
    assert.equal(still.installedPath, installed.installedPath)
    assert.equal(service.listCatalog().length, 1)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

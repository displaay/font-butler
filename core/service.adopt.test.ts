import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { AppPaths } from './paths.ts'
import { FontButlerService } from './service.ts'
import { closeAllWatchers } from './watch.ts'

function tempPaths(): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-adopt-'))
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
    adobeFontsDir: path.join(dataRoot, 'adobe-fonts'),
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

test('init adopts user fonts onto the Fonts tab as installed', async () => {
  const paths = tempPaths()
  const font = path.join(paths.userFontsDir, 'Mine.ttf')
  writeTestFont(font, 'MineFace', 'MineFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'installed')
    assert.equal(entry.installedPath, font)
    assert.equal(entry.sourcePath, font)
    assert.equal(entry.sourcePresent, false)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('uninstall removes an adopted user font from the list when it has no source', async () => {
  const paths = tempPaths()
  const font = path.join(paths.userFontsDir, 'Gone.ttf')
  writeTestFont(font, 'GoneFace', 'GoneFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    await service.uninstall(entry.id)
    assert.equal(service.listCatalog().length, 0)
    assert.equal(fs.existsSync(font), false)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('uninstall deleteSource removes the installed copy and the original file', async () => {
  const paths = tempPaths()
  const source = path.join(paths.dataRoot, 'RemoveMe.ttf')
  writeTestFont(source, 'RemoveFace', 'RemoveFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0].id)
    assert.ok(installed.installedPath)
    assert.equal(fs.existsSync(source), true)
    assert.equal(fs.existsSync(installed.installedPath!), true)
    await service.uninstall(installed.id, { deleteSource: true })
    assert.equal(service.listCatalog().length, 0)
    assert.equal(fs.existsSync(source), false)
    assert.equal(fs.existsSync(installed.installedPath!), false)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('uninstall keeps a catalog row when a separate source file remains', async () => {
  const paths = tempPaths()
  const source = path.join(paths.dataRoot, 'Source.ttf')
  writeTestFont(source, 'KeepFace', 'KeepFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0].id)
    assert.equal(installed.status, 'installed')
    assert.ok(installed.installedPath)
    assert.notEqual(path.resolve(installed.installedPath!), path.resolve(source))
    assert.equal(fs.existsSync(installed.installedPath!), true)
    const after = await service.uninstall(installed.id)
    assert.equal(after.status, 'uninstalled')
    assert.equal(service.listCatalog().length, 1)
    assert.equal(fs.existsSync(source), true)
    assert.equal(fs.existsSync(installed.installedPath!), false)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('deactivate leaves the user font file in place', async () => {
  const paths = tempPaths()
  const font = path.join(paths.userFontsDir, 'Off.ttf')
  writeTestFont(font, 'OffFace', 'OffFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    const off = await service.deactivate(entry.id)
    assert.equal(off.status, 'deactivated')
    assert.equal(off.installedPath, font)
    assert.equal(fs.existsSync(font), true)
    const on = await service.activate(entry.id)
    assert.equal(on.status, 'installed')
    assert.equal(on.installedPath, font)
    assert.equal(fs.existsSync(font), true)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('openWith activates a deactivated user font without deleting it', async () => {
  const paths = tempPaths()
  const font = path.join(paths.userFontsDir, 'Open.ttf')
  writeTestFont(font, 'OpenFace', 'OpenFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    await service.deactivate(entry.id)
    const opened = await service.openWith(font)
    assert.equal(opened.status, 'installed')
    assert.equal(opened.id, entry.id)
    assert.equal(opened.installedPath, font)
    assert.equal(fs.existsSync(font), true)
    assert.equal(service.listCatalog().length, 1)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('reinstall does not delete a deactivated user font that has no separate source', async () => {
  const paths = tempPaths()
  const font = path.join(paths.userFontsDir, 'Again.ttf')
  writeTestFont(font, 'AgainFace', 'AgainFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    await service.deactivate(entry.id)
    const again = await service.reinstall(entry.id)
    assert.equal(again.status, 'installed')
    assert.equal(again.installedPath, font)
    assert.equal(fs.existsSync(font), true)
    assert.equal(service.listCatalog().length, 1)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('On this Mac lists computer fonts and omits user fonts', async () => {
  const paths = tempPaths()
  writeTestFont(path.join(paths.userFontsDir, 'Mine.ttf'), 'MineFace', 'MineFace-Regular')
  writeTestFont(path.join(paths.computerFontsDir, 'Comp.ttf'), 'CompFace', 'CompFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const faces = service.listSystem()
    assert.equal(faces.some((face) => face.familyName === 'MineFace'), false)
    assert.equal(faces.some((face) => face.familyName === 'CompFace'), true)
    assert.equal(service.listCatalog().some((entry) => entry.faces[0]?.familyName === 'MineFace'), true)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('install copies an external source into the user fonts folder', async () => {
  const paths = tempPaths()
  const source = path.join(paths.dataRoot, 'Drop.ttf')
  writeTestFont(source, 'DropFace', 'DropFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0].id)
    assert.equal(installed.status, 'installed')
    assert.equal(path.dirname(installed.installedPath!), paths.userFontsDir)
    assert.equal(path.basename(installed.installedPath!), 'Drop.ttf')
    assert.equal(fs.existsSync(source), true)
    assert.equal(fs.existsSync(installed.installedPath!), true)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

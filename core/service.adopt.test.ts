import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { AppPaths } from './paths.ts'
import { FontButlerService } from './service.ts'
import { occupiesDestination } from './identity.ts'
import { closeAllWatchers } from './watch.ts'
import { setDesktopShell, testDesktopShell } from './reveal.ts'

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
    assert.ok(
      entry.installations?.some(
        (item) => item.destinationId === 'macos' && item.verification === 'file-present' && item.path === font,
      ),
    )
    assert.equal(entry.installations?.some((item) => item.destinationId === 'adobe-shared'), false)
    assert.equal(occupiesDestination(entry, 'macos', paths), true)
    assert.equal(occupiesDestination(entry, 'adobe-shared', paths), false)
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
  setDesktopShell(testDesktopShell())
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
    setDesktopShell(null)
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

test('deactivate parks the user font file into the Disabled vault', async () => {
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
    assert.equal(fs.existsSync(font), false)
    assert.ok(off.disabledPath)
    assert.equal(fs.existsSync(off.disabledPath), true)
    assert.ok(off.disabledPath.startsWith(paths.disabledDir))
    const on = await service.activate(entry.id)
    assert.equal(on.status, 'installed')
    assert.equal(on.installedPath, font)
    assert.equal(fs.existsSync(font), true)
    assert.equal(on.disabledPath, undefined)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('openWith activates a parked user font from its vault copy', async () => {
  const paths = tempPaths()
  const font = path.join(paths.userFontsDir, 'Open.ttf')
  writeTestFont(font, 'OpenFace', 'OpenFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    const off = await service.deactivate(entry.id)
    assert.equal(fs.existsSync(font), false)
    assert.ok(off.disabledPath)
    const opened = await service.openWith(off.disabledPath)
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
    assert.equal(fs.existsSync(font), false)
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

test('init does not delete a parked adopted user font', async () => {
  const paths = tempPaths()
  const font = path.join(paths.userFontsDir, 'ParkedAdopt.ttf')
  writeTestFont(font, 'ParkedAdopt', 'ParkedAdopt-Regular')
  const first = new FontButlerService(paths)
  try {
    await first.init()
    const [entry] = first.listCatalog()
    assert.ok(entry)
    const parked = await first.deactivate(entry.id)
    assert.equal(parked.status, 'deactivated')
    assert.equal(fs.existsSync(font), false)
    assert.ok(parked.disabledPath && fs.existsSync(parked.disabledPath))
    const vaultBytes = fs.readFileSync(parked.disabledPath)
    first.dispose()
    await closeAllWatchers()

    const restarted = new FontButlerService(paths)
    try {
      await restarted.init()
      const after = restarted.listCatalog()
      assert.equal(after.length, 1)
      assert.equal(after[0]?.id, entry.id)
      assert.equal(after[0]?.status, 'deactivated')
      assert.ok(after[0]?.disabledPath && fs.existsSync(after[0].disabledPath))
      assert.deepEqual(fs.readFileSync(after[0].disabledPath), vaultBytes)
      const on = await restarted.activate(entry.id)
      assert.equal(on.status, 'installed')
      assert.equal(fs.existsSync(font), true)
      assert.deepEqual(fs.readFileSync(font), vaultBytes)
    } finally {
      restarted.dispose()
      await closeAllWatchers()
    }
  } finally {
    first.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('init adopts an Adobe-only file without macos occupancy', async () => {
  const paths = tempPaths()
  const font = path.join(paths.adobeFontsDir, 'AdobeOnly.ttf')
  writeTestFont(font, 'AdobeOnly', 'AdobeOnly-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'installed')
    assert.equal(entry.installedPath, undefined)
    assert.ok(
      entry.installations?.some(
        (item) =>
          item.destinationId === 'adobe-shared' &&
          item.verification === 'file-present' &&
          item.path === font,
      ),
    )
    assert.equal(entry.installations?.some((item) => item.destinationId === 'macos'), false)
    assert.equal(occupiesDestination(entry, 'macos', paths), false)
    assert.equal(occupiesDestination(entry, 'adobe-shared', paths), true)
    assert.equal(fs.existsSync(font), true)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('init adopts the same face in Fonts and Adobe as one catalog entry', async () => {
  const paths = tempPaths()
  const macos = path.join(paths.userFontsDir, 'BothFace.ttf')
  const adobe = path.join(paths.adobeFontsDir, 'BothFaceAdobe.ttf')
  writeTestFont(macos, 'BothFace', 'BothFace-Regular')
  writeTestFont(adobe, 'BothFace', 'BothFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const catalog = service.listCatalog()
    assert.equal(catalog.length, 1)
    const [entry] = catalog
    assert.ok(entry)
    assert.equal(entry.status, 'installed')
    assert.equal(entry.installedPath, macos)
    assert.ok(
      entry.installations?.some(
        (item) => item.destinationId === 'macos' && item.verification === 'file-present',
      ),
    )
    assert.ok(
      entry.installations?.some(
        (item) =>
          item.destinationId === 'adobe-shared' &&
          item.verification === 'file-present' &&
          item.path === adobe,
      ),
    )
    assert.equal(occupiesDestination(entry, 'macos', paths), true)
    assert.equal(occupiesDestination(entry, 'adobe-shared', paths), true)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('init skips a corrupt Adobe folder file and leaves it on disk', async () => {
  const paths = tempPaths()
  const bad = path.join(paths.adobeFontsDir, 'Corrupt.ttf')
  fs.mkdirSync(paths.adobeFontsDir, { recursive: true })
  fs.writeFileSync(bad, 'not a font')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    assert.equal(service.listCatalog().length, 0)
    assert.equal(fs.existsSync(bad), true)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('uninstall of an adopted Adobe-only row uses the Adobe path and leaves Fonts neighbors', async () => {
  const paths = tempPaths()
  const adobe = path.join(paths.adobeFontsDir, 'AdobeGone.ttf')
  const neighborAdobe = path.join(paths.adobeFontsDir, 'KeepAdobe.ttf')
  const neighborFonts = path.join(paths.userFontsDir, 'KeepFonts.ttf')
  writeTestFont(adobe, 'AdobeGone', 'AdobeGone-Regular')
  writeTestFont(neighborAdobe, 'KeepAdobe', 'KeepAdobe-Regular')
  writeTestFont(neighborFonts, 'KeepFonts', 'KeepFonts-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const gone = service.listCatalog().find((entry) => entry.faces[0]?.familyName === 'AdobeGone')
    assert.ok(gone)
    assert.equal(gone.installedPath, undefined)
    await service.uninstall(gone.id)
    assert.equal(fs.existsSync(adobe), false)
    assert.equal(fs.existsSync(neighborAdobe), true)
    assert.equal(fs.existsSync(neighborFonts), true)
    assert.equal(service.listCatalog().some((entry) => entry.faces[0]?.familyName === 'AdobeGone'), false)
    assert.equal(service.listCatalog().some((entry) => entry.faces[0]?.familyName === 'KeepFonts'), true)
    assert.equal(service.listCatalog().some((entry) => entry.faces[0]?.familyName === 'KeepAdobe'), true)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('a font dropped into the Adobe folder after launch is adopted', async () => {
  const paths = tempPaths()
  fs.mkdirSync(paths.adobeFontsDir, { recursive: true })
  const service = new FontButlerService(paths)
  try {
    await service.init()
    assert.equal(service.listCatalog().length, 0)
    const font = path.join(paths.adobeFontsDir, 'DroppedAdobe.ttf')
    writeTestFont(font, 'DroppedAdobe', 'DroppedAdobe-Regular')
    const deadline = Date.now() + 8000
    let entry = service.listCatalog()[0]
    while (!entry && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150))
      entry = service.listCatalog()[0]
    }
    assert.ok(entry)
    assert.equal(entry.status, 'installed')
    assert.equal(occupiesDestination(entry, 'adobe-shared', paths), true)
    assert.equal(occupiesDestination(entry, 'macos', paths), false)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { AppPaths } from './paths.ts'
import { FontButlerService } from './service.ts'
import { isExternalSource } from './catalog.ts'
import { occupiesDestination } from './identity.ts'
import { closeAllWatchers } from './watch.ts'
import { setDesktopShell, testDesktopShell } from './reveal.ts'
import { noopFontNative, setFontNative } from './native.ts'
import type { CatalogEntry } from './types.ts'

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

function writeTestFont(dest: string, family: string, psName: string, version = 'Version 1.000'): void {
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
    "version": ${JSON.stringify(version)},
})
fb.setupOS2()
fb.setupPost()
fb.save(${JSON.stringify(dest)})
`
  execFileSync('python3', ['-c', script], { stdio: 'pipe' })
}

async function waitUntil(label: string, predicate: () => boolean | Promise<boolean>, timeoutMs = 12000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`timed out waiting for ${label}`)
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

test('a font added to the Adobe folder is adopted on the next init', async () => {
  const paths = tempPaths()
  fs.mkdirSync(paths.adobeFontsDir, { recursive: true })
  const service = new FontButlerService(paths)
  try {
    await service.init()
    assert.equal(service.listCatalog().length, 0)
    const font = path.join(paths.adobeFontsDir, 'DroppedAdobe.ttf')
    writeTestFont(font, 'DroppedAdobe', 'DroppedAdobe-Regular')
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'installed')
    assert.equal(occupiesDestination(entry, 'adobe-shared', paths), true)
    assert.equal(occupiesDestination(entry, 'macos', paths), false)
    assert.equal(entry.installedPath, undefined)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('Adobe-only adopted paths are allowed for preview', async () => {
  const paths = tempPaths()
  const font = path.join(paths.adobeFontsDir, 'AdobePreview.ttf')
  writeTestFont(font, 'AdobePreview', 'AdobePreview-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const bytes = service.fontBytesForPath(font)
    assert.equal(bytes.filename, 'AdobePreview.ttf')
    assert.ok(bytes.buffer.length > 0)
    const [entry] = service.listCatalog()
    assert.ok(entry)
    const fromEntry = service.fontBytesForEntry(entry.id)
    assert.equal(fromEntry.filename, 'AdobePreview.ttf')
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('distinct files that share a family name do not collapse into one catalog row', async () => {
  const paths = tempPaths()
  const source = path.join(paths.dataRoot, 'LibraryShared.ttf')
  writeTestFont(source, 'SharedFace', 'SharedFace-Regular', 'Version 1.000')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const imported = await service.importPaths([source])
    assert.equal(imported.entries[0]?.status, 'uninstalled')
    const adobe = path.join(paths.adobeFontsDir, 'AdobeShared.ttf')
    writeTestFont(adobe, 'SharedFace', 'SharedFace-Regular', 'Version 2.000')
    await service.init()
    const catalog = service.listCatalog()
    const shared = catalog.filter((entry) => entry.faces[0]?.familyName === 'SharedFace')
    assert.equal(shared.length, 2)
    assert.equal(shared.some((entry) => occupiesDestination(entry, 'adobe-shared', paths)), true)
    assert.equal(
      shared.some((entry) => path.resolve(entry.sourcePath) === path.resolve(source)),
      true,
    )
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('a second same-face file in one destination is warned instead of overwriting', async () => {
  const paths = tempPaths()
  const first = path.join(paths.adobeFontsDir, 'DupA.ttf')
  const second = path.join(paths.adobeFontsDir, 'DupB.ttf')
  writeTestFont(first, 'DupFace', 'DupFace-Regular', 'Version 1.000')
  writeTestFont(second, 'DupFace', 'DupFace-Regular', 'Version 2.000')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const catalog = service.listCatalog().filter((entry) => entry.faces[0]?.familyName === 'DupFace')
    assert.equal(catalog.length, 1)
    const managed = catalog[0]!
    const live = managed.installations?.find((item) => item.destinationId === 'adobe-shared')
    assert.ok(live?.path)
    const livePath = path.resolve(live.path)
    assert.equal(
      livePath === path.resolve(first) || livePath === path.resolve(second),
      true,
    )
    const other = livePath === path.resolve(first) ? second : first
    assert.equal(fs.existsSync(first), true)
    assert.equal(fs.existsSync(second), true)
    const warnings = service.listDuplicates()
    assert.equal(warnings.length, 1)
    assert.equal(path.resolve(warnings[0]!.path), path.resolve(other))
    assert.equal(path.resolve(live.path), livePath)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('a missing recorded destination copy may be restamped onto the remaining file', async () => {
  const paths = tempPaths()
  const first = path.join(paths.adobeFontsDir, 'KeepMe.ttf')
  writeTestFont(first, 'RestampFace', 'RestampFace-Regular', 'Version 1.000')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    fs.rmSync(first, { force: true })
    const replacement = path.join(paths.adobeFontsDir, 'Replacement.ttf')
    writeTestFont(replacement, 'RestampFace', 'RestampFace-Regular', 'Version 2.000')
    await service.init()
    const after = service.listCatalog()
    assert.equal(after.length, 1)
    assert.equal(after[0]?.id, entry.id)
    assert.equal(
      after[0]?.installations?.some(
        (item) =>
          item.destinationId === 'adobe-shared' &&
          item.verification === 'file-present' &&
          path.resolve(item.path) === path.resolve(replacement),
      ),
      true,
    )
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('prunes an Adobe-only row when the Adobe file is gone', async () => {
  const paths = tempPaths()
  const font = path.join(paths.adobeFontsDir, 'GoneAdobe.ttf')
  writeTestFont(font, 'GoneAdobe', 'GoneAdobe-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    assert.equal(service.listCatalog().length, 1)
    fs.rmSync(font, { force: true })
    await service.init()
    assert.equal(service.listCatalog().length, 0)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('an Adobe file does not stamp live occupancy onto a deactivated row', async () => {
  const paths = tempPaths()
  const macos = path.join(paths.userFontsDir, 'ParkedFace.ttf')
  writeTestFont(macos, 'ParkedFace', 'ParkedFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    const parked = await service.deactivate(entry.id)
    assert.equal(parked.status, 'deactivated')
    const adobe = path.join(paths.adobeFontsDir, 'ParkedFaceAdobe.ttf')
    writeTestFont(adobe, 'ParkedFace', 'ParkedFace-Regular')
    await service.init()
    const after = service.listCatalog()
    assert.equal(after.length, 1)
    assert.equal(after[0]?.id, entry.id)
    assert.equal(after[0]?.status, 'deactivated')
    assert.equal(
      after[0]?.installations?.some(
        (item) => item.destinationId === 'adobe-shared' && item.verification === 'file-present',
      ),
      false,
    )
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

function fontBookNative(offPaths: () => string[]) {
  return noopFontNative({
    async fontActivationStates(filePaths) {
      const off = new Set(offPaths().map((item) => path.resolve(item)))
      const states: Record<string, boolean> = {}
      for (const filePath of filePaths) states[filePath] = !off.has(path.resolve(filePath))
      return { ok: true, native: true, states }
    },
  })
}

function adobeCopyOf(entry: CatalogEntry | undefined) {
  return entry?.installations?.find((item) => item.destinationId === 'adobe-shared')
}

test('a Fonts copy disabled in Font Book still records its live Adobe-folder copy', async () => {
  const paths = tempPaths()
  const macos = path.join(paths.userFontsDir, 'BookOff.ttf')
  const adobe = path.join(paths.adobeFontsDir, 'BookOffAdobe.ttf')
  writeTestFont(macos, 'BookOff', 'BookOff-Regular')
  writeTestFont(adobe, 'BookOff', 'BookOff-Regular')
  let off = [macos]
  setFontNative(fontBookNative(() => off))
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const catalog = service.listCatalog()
    assert.equal(catalog.length, 1)
    const [entry] = catalog
    assert.ok(entry)
    assert.equal(entry.status, 'deactivated')
    assert.equal(entry.installedPath, macos)
    assert.equal(entry.disabledPath, undefined)
    assert.equal(fs.existsSync(macos), true)
    const copy = adobeCopyOf(entry)
    assert.equal(copy?.path, adobe)
    assert.equal(copy?.verification, 'file-present')
    assert.equal(copy?.parkedPath, undefined)
    assert.equal(occupiesDestination(entry, 'adobe-shared', paths), true)

    await service.init()
    const again = service.listCatalog()
    assert.equal(again.length, 1)
    assert.equal(again[0]?.status, 'deactivated')
    assert.equal(adobeCopyOf(again[0])?.path, adobe)

    off = []
    await service.init()
    const on = service.listCatalog()
    assert.equal(on.length, 1)
    assert.equal(on[0]?.status, 'installed')
    assert.equal(adobeCopyOf(on[0])?.path, adobe)
  } finally {
    setFontNative(null)
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('an Adobe copy added after the Fonts copy was disabled in Font Book joins that row', async () => {
  const paths = tempPaths()
  const macos = path.join(paths.userFontsDir, 'LateBook.ttf')
  writeTestFont(macos, 'LateBook', 'LateBook-Regular')
  setFontNative(fontBookNative(() => [macos]))
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'deactivated')
    assert.equal(adobeCopyOf(entry), undefined)
    const adobe = path.join(paths.adobeFontsDir, 'LateBookAdobe.ttf')
    writeTestFont(adobe, 'LateBook', 'LateBook-Regular')
    await service.init()
    const after = service.listCatalog()
    assert.equal(after.length, 1)
    assert.equal(after[0]?.id, entry.id)
    assert.equal(after[0]?.status, 'deactivated')
    assert.equal(adobeCopyOf(after[0])?.path, adobe)
    assert.equal(adobeCopyOf(after[0])?.verification, 'file-present')
  } finally {
    setFontNative(null)
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('Show in Finder on an Adobe-only row reveals the Adobe-folder file', async () => {
  const paths = tempPaths()
  const font = path.join(paths.adobeFontsDir, 'RevealAdobe.ttf')
  writeTestFont(font, 'RevealAdobe', 'RevealAdobe-Regular')
  const revealed: string[] = []
  setDesktopShell({ ...testDesktopShell(), async reveal(filePath) { revealed.push(filePath) } })
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.installedPath, undefined)
    assert.equal(await service.reveal(entry.id, 'installed'), font)
    assert.deepEqual(revealed, [font])
  } finally {
    setDesktopShell(null)
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('creating the Adobe folder after init adopts a new font without a second init', async () => {
  const paths = tempPaths()
  assert.equal(fs.existsSync(paths.adobeFontsDir), false)
  const service = new FontButlerService(paths)
  try {
    await service.init()
    assert.equal(service.listCatalog().length, 0)
    fs.mkdirSync(paths.adobeFontsDir, { recursive: true })
    const font = path.join(paths.adobeFontsDir, 'LateAdobe.ttf')
    writeTestFont(font, 'LateAdobe', 'LateAdobe-Regular')
    await waitUntil('Adobe folder adopt', () =>
      service.listCatalog().some((entry) => entry.faces[0]?.familyName === 'LateAdobe'),
    )
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(occupiesDestination(entry, 'adobe-shared', paths), true)
    assert.equal(occupiesDestination(entry, 'macos', paths), false)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('renaming an adopted Fonts file keeps the row and follows the new path', async () => {
  const paths = tempPaths()
  const font = path.join(paths.userFontsDir, 'RenameMe.ttf')
  writeTestFont(font, 'RenameFace', 'RenameFace-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const [before] = service.listCatalog()
    assert.ok(before)
    assert.equal(before.installedPath, font)
    assert.equal(before.sourcePath, font)
    const renamed = path.join(paths.userFontsDir, 'Renamed.ttf')
    fs.renameSync(font, renamed)
    await service.init()
    const catalog = service.listCatalog()
    assert.equal(catalog.length, 1)
    const after = catalog[0]
    assert.ok(after)
    assert.equal(after.id, before.id)
    assert.equal(after.status, 'installed')
    assert.equal(path.resolve(after.installedPath!), path.resolve(renamed))
    assert.equal(path.resolve(after.sourcePath), path.resolve(renamed))
    assert.equal(isExternalSource(after), false)
    assert.equal(after.sourcePresent, false)
    assert.equal(
      after.installations?.some(
        (item) =>
          item.destinationId === 'macos' &&
          item.verification === 'file-present' &&
          path.resolve(item.path) === path.resolve(renamed),
      ),
      true,
    )
    assert.equal(fs.existsSync(font), false)
    assert.equal(fs.existsSync(renamed), true)
    await service.uninstall(after.id)
    assert.equal(service.listCatalog().length, 0)
    assert.equal(fs.existsSync(renamed), false)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('renaming an installed copy leaves a separate source path in place', async () => {
  const paths = tempPaths()
  const source = path.join(paths.dataRoot, 'LibraryRename.ttf')
  writeTestFont(source, 'LibraryRename', 'LibraryRename-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    assert.ok(installed.installedPath)
    assert.notEqual(path.resolve(installed.installedPath), path.resolve(source))
    const renamed = path.join(paths.userFontsDir, 'LibraryRenamed.ttf')
    fs.renameSync(installed.installedPath, renamed)
    await service.init()
    const catalog = service.listCatalog()
    assert.equal(catalog.length, 1)
    const after = catalog[0]
    assert.ok(after)
    assert.equal(after.id, installed.id)
    assert.equal(after.status, 'installed')
    assert.equal(path.resolve(after.sourcePath), path.resolve(source))
    assert.equal(path.resolve(after.installedPath!), path.resolve(renamed))
    assert.equal(isExternalSource(after), true)
    assert.equal(fs.existsSync(source), true)
    assert.equal(fs.existsSync(renamed), true)
    const uninstalled = await service.uninstall(after.id)
    assert.equal(uninstalled.status, 'uninstalled')
    assert.equal(service.listCatalog().length, 1)
    assert.equal(fs.existsSync(source), true)
    assert.equal(fs.existsSync(renamed), false)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

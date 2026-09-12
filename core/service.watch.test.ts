import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { AppPaths } from './paths.ts'
import { FontButlerService } from './service.ts'
import { closeAllWatchers, syncInboxWatcher } from './watch.ts'

function tempPaths(): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-watch-settings-'))
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
    adobeFontsDir: path.join(dataRoot, 'adobe-fonts'),
  }
}

function writeTestFont(
  dest: string,
  family: string,
  psName: string,
  options: { version?: string } = {},
): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const version = options.version ?? 'Version 1.000'
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

test('updateSettings accepts multiple watch folders', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const clients = path.join(paths.dataRoot, 'clients')
  fs.mkdirSync(inbox, { recursive: true })
  fs.mkdirSync(clients, { recursive: true })
  fs.writeFileSync(path.join(inbox, 'Inbox.otf'), 'font')
  fs.writeFileSync(path.join(clients, 'Client.ttf'), 'font')
  const service = new FontButlerService(paths)
  try {
    const settings = await service.updateSettings({ watchFolders: [inbox, clients, inbox] })
    assert.deepEqual(settings.watchFolders, [inbox, clients])
    assert.deepEqual(service.getSettings().watchFolders, [inbox, clients])
  } finally {
    await syncInboxWatcher([], () => {})
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('updateSettings rejects the user fonts folder as a watch folder', async () => {
  const paths = tempPaths()
  fs.mkdirSync(paths.userFontsDir, { recursive: true })
  const service = new FontButlerService(paths)
  try {
    await assert.rejects(
      () => service.updateSettings({ watchFolders: [paths.userFontsDir] }),
      /already shown on the Fonts tab/,
    )
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('watch folder import installs new fonts when the setting is on', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const font = path.join(inbox, 'WatchMe.ttf')
  writeTestFont(font, 'WatchMe', 'WatchMe-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.updateSettings({
      watchFolders: [inbox],
      installWatchFolderFonts: true,
      onboardingCompleted: true,
    })
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'installed')
    assert.ok(entry.installedPath)
    assert.notEqual(path.resolve(entry.installedPath), path.resolve(font))
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('watch folder import leaves new fonts uninstalled when the setting is off', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const font = path.join(inbox, 'LeaveMe.ttf')
  writeTestFont(font, 'LeaveMe', 'LeaveMe-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.updateSettings({
      watchFolders: [inbox],
      installWatchFolderFonts: false,
      onboardingCompleted: true,
    })
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'uninstalled')
    assert.equal(entry.installedPath, undefined)
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('updateSettings rejects a missing watch folder', async () => {
  const paths = tempPaths()
  const service = new FontButlerService(paths)
  try {
    await assert.rejects(
      () => service.updateSettings({ watchFolders: [path.join(paths.dataRoot, 'missing')] }),
      /does not exist/,
    )
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('turning on auto-reinstall installs fonts that already have source updates', async () => {
  const paths = tempPaths()
  const font = path.join(paths.dataRoot, 'UpdateMe.ttf')
  writeTestFont(font, 'UpdateMe', 'UpdateMe-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const imported = await service.importPaths([font])
    const entry = imported.entries[0]
    assert.ok(entry)
    await service.install(entry.id)
    const before = service.listCatalog()[0]
    assert.ok(before)
    assert.equal(before.status, 'installed')
    const snapshot = before.installedSnapshotMtimeMs

    await new Promise((resolve) => setTimeout(resolve, 20))
    writeTestFont(font, 'UpdateMe', 'UpdateMe-Regular', { version: 'Version 2.000' })

    const settings = await service.updateSettings({ autoReinstallOnUpdate: true })
    assert.equal(settings.autoReinstallOnUpdate, true)
    const after = service.listCatalog()[0]
    assert.ok(after)
    assert.equal(after.status, 'installed')
    assert.notEqual(after.installedSnapshotMtimeMs, snapshot)
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('source updates stay outdated when auto-reinstall is off', async () => {
  const paths = tempPaths()
  const font = path.join(paths.dataRoot, 'LeaveOutdated.ttf')
  writeTestFont(font, 'LeaveOutdated', 'LeaveOutdated-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const imported = await service.importPaths([font])
    const entry = imported.entries[0]
    assert.ok(entry)
    await service.install(entry.id)
    await new Promise((resolve) => setTimeout(resolve, 20))
    writeTestFont(font, 'LeaveOutdated', 'LeaveOutdated-Regular', { version: 'Version 2.000' })

    const again = new FontButlerService(paths)
    await again.init()
    const after = again.listCatalog()[0]
    assert.ok(after)
    assert.equal(after.status, 'outdated')
    again.dispose()
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('reinstall succeeds when cache clearing is turned off', async () => {
  const paths = tempPaths()
  const font = path.join(paths.dataRoot, 'SkipCache.ttf')
  writeTestFont(font, 'SkipCache', 'SkipCache-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const imported = await service.importPaths([font])
    const entry = imported.entries[0]
    assert.ok(entry)
    await service.install(entry.id)
    const settings = await service.updateSettings({ skipCacheClearOnReinstall: true })
    assert.equal(settings.skipCacheClearOnReinstall, true)
    const again = await service.reinstall(entry.id)
    assert.equal(again.status, 'installed')
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('watch folder add during onboarding does not import until setup is finished', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const font = path.join(inbox, 'Later.ttf')
  writeTestFont(font, 'Later', 'Later-Regular')
  const service = new FontButlerService(paths)
  try {
    assert.equal(service.getSettings().onboardingCompleted, false)
    const configured = await service.configureFolder({
      root: inbox,
      policy: 'install-new',
    })
    await service.startWatching(configured.folder.id)
    assert.equal(service.getSettings().folders[0]?.watching, true)
    assert.equal(service.listCatalog().length, 0)

    const restarted = new FontButlerService(paths)
    await restarted.init()
    assert.equal(restarted.listCatalog().length, 0)
    restarted.dispose()

    await service.updateSettings({ onboardingCompleted: true })
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'installed')
    assert.ok(entry.installedPath)
    assert.notEqual(path.resolve(entry.installedPath), path.resolve(font))
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('watchFolders patch during onboarding does not import until setup is finished', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const font = path.join(inbox, 'Deferred.ttf')
  writeTestFont(font, 'Deferred', 'Deferred-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.updateSettings({ watchFolders: [inbox], installWatchFolderFonts: true })
    assert.equal(service.getSettings().onboardingCompleted, false)
    assert.equal(service.listCatalog().length, 0)
    await service.updateSettings({ onboardingCompleted: true })
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'installed')
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { onEvent } from './events.ts'
import { fingerprintFile } from './fingerprint.ts'
import type { AppPaths } from './paths.ts'
import { FontButlerService } from './service.ts'
import { canAutomateUpdates, effectiveUpdatePolicy } from './state.ts'
import type { CatalogEntry } from './types.ts'
import {
  INBOX_CORRUPT_SETTLE_MS,
  INBOX_WRITE_STABILITY_MS,
  closeAllWatchers,
  enqueueSourceStatusRefresh,
  inboxRejectionForTest,
  syncInboxWatcher,
} from './watch.ts'

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

test('a new watch folder defaults to installing new fonts and reinstalling updates', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const font = path.join(inbox, 'WatchMe.ttf')
  writeTestFont(font, 'WatchMe', 'WatchMe-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.updateSettings({
      watchFolders: [inbox],
      installWatchFolderFonts: false,
      autoReinstallOnUpdate: false,
      onboardingCompleted: true,
    })
    const folder = service.getSettings().folders[0]
    assert.ok(folder)
    assert.equal(folder.installNew, true)
    assert.equal(folder.autoUpdate, true)
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

test('a folder with install new unchecked does not install new fonts', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const font = path.join(inbox, 'LeaveMe.ttf')
  writeTestFont(font, 'LeaveMe', 'LeaveMe-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.updateSettings({ onboardingCompleted: true, autoReinstallOnUpdate: true })
    const configured = await service.configureFolder({
      root: inbox,
      installNew: false,
      autoUpdate: true,
    })
    assert.equal(configured.folder.installNew, false)
    await service.startWatching(configured.folder.id)
    const [entry] = service.listCatalog()
    assert.ok(entry)
    assert.equal(entry.status, 'uninstalled')
    assert.equal(entry.installedPath, undefined)
  } finally {
    service.dispose()
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

function installedEntry(partial: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'font',
    sourcePath: '/tmp/Font.ttf',
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'installed',
    faces: [],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

async function waitForEntry(
  service: FontButlerService,
  id: string,
  predicate: (entry: CatalogEntry) => boolean,
  timeoutMs = 5000,
): Promise<CatalogEntry> {
  const start = Date.now()
  let last: CatalogEntry | undefined
  while (Date.now() - start < timeoutMs) {
    last = service.listCatalog().find((entry) => entry.id === id)
    if (last && predicate(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  assert.fail(`timed out waiting for ${id}; last status ${last?.status ?? 'missing'}`)
}

test('a watch folder checkbox wins over global auto-reinstall', () => {
  const off = { paused: false, autoUpdate: false }
  const on = { paused: false, autoUpdate: true }
  const entry = installedEntry()
  assert.equal(effectiveUpdatePolicy(entry, off, true), 'manual')
  assert.equal(canAutomateUpdates(entry, off, true), false)
  assert.equal(effectiveUpdatePolicy(entry, on, false), 'automatic')
  assert.equal(canAutomateUpdates(entry, on, false), true)
  assert.equal(effectiveUpdatePolicy(entry, null, true), 'automatic')
  assert.equal(effectiveUpdatePolicy(entry, null, false), 'manual')
  assert.equal(effectiveUpdatePolicy(entry, { ...on, paused: true }, true), 'manual')
  assert.equal(canAutomateUpdates(installedEntry({ status: 'uninstalled' }), on, true), false)
})

test('configureFolder defaults a new folder to both actions on and keeps existing flags', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const other = path.join(paths.dataRoot, 'other')
  fs.mkdirSync(inbox, { recursive: true })
  fs.mkdirSync(other, { recursive: true })
  const service = new FontButlerService(paths)
  try {
    const created = await service.configureFolder({ root: inbox })
    assert.equal(created.folder.installNew, true)
    assert.equal(created.folder.autoUpdate, true)
    const kept = await service.configureFolder({
      root: other,
      installNew: false,
      autoUpdate: false,
    })
    assert.equal(kept.folder.installNew, false)
    assert.equal(kept.folder.autoUpdate, false)
    await service.updateSettings({ theme: 'dark', autoReinstallOnUpdate: true })
    const again = service.getSettings().folders.find((folder) => folder.id === kept.folder.id)
    assert.equal(again?.installNew, false)
    assert.equal(again?.autoUpdate, false)
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('folder auto-reinstall off blocks an update even when the global switch is on', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const font = path.join(inbox, 'Hold.ttf')
  writeTestFont(font, 'Hold', 'Hold-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.updateSettings({
      autoReinstallOnUpdate: true,
      onboardingCompleted: true,
    })
    const configured = await service.configureFolder({
      root: inbox,
      installNew: true,
      autoUpdate: false,
    })
    assert.equal(configured.folder.autoUpdate, false)
    await service.startWatching(configured.folder.id)
    const added = service.listCatalog().find((entry) => entry.faces[0]?.familyName === 'Hold')
    assert.ok(added)
    assert.equal(added.status, 'installed')
    assert.ok(added.installedPath)
    const before = fs.readFileSync(added.installedPath)
    writeTestFont(font, 'Hold', 'Hold-Regular', { version: 'Version 2.000' })
    enqueueSourceStatusRefresh(paths, font)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const after = service.listCatalog().find((entry) => entry.id === added.id)
    assert.ok(after)
    assert.equal(after.status, 'outdated')
    assert.ok(after.installedPath)
    assert.deepEqual(fs.readFileSync(after.installedPath), before)
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('folder auto-reinstall applies two sequential source updates', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const font = path.join(inbox, 'Twice.ttf')
  writeTestFont(font, 'Twice', 'Twice-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.updateSettings({
      autoReinstallOnUpdate: true,
      onboardingCompleted: true,
    })
    const configured = await service.configureFolder({ root: inbox })
    await service.startWatching(configured.folder.id)
    const added = service.listCatalog().find((entry) => entry.faces[0]?.familyName === 'Twice')
    assert.ok(added)
    assert.equal(added.status, 'installed')
    assert.ok(added.installedPath)
    const v1 = fs.readFileSync(added.installedPath)

    writeTestFont(font, 'Twice', 'Twice-Regular', { version: 'Version 2.000' })
    enqueueSourceStatusRefresh(paths, font)
    const afterV2 = await waitForEntry(service, added.id, (entry) => {
      if (entry.status !== 'installed' || !entry.installedPath) return false
      return !fs.readFileSync(entry.installedPath).equals(v1)
    })
    const v2 = fs.readFileSync(afterV2.installedPath!)

    writeTestFont(font, 'Twice', 'Twice-Regular', { version: 'Version 3.000' })
    enqueueSourceStatusRefresh(paths, font)
    const afterV3 = await waitForEntry(service, added.id, (entry) => {
      if (entry.status !== 'installed' || !entry.installedPath) return false
      return !fs.readFileSync(entry.installedPath).equals(v2)
    })
    assert.equal(afterV3.status, 'installed')
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('folder auto-reinstall on still reinstalls when the global switch is off', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const font = path.join(inbox, 'Follow.ttf')
  writeTestFont(font, 'Follow', 'Follow-Regular')
  const service = new FontButlerService(paths)
  try {
    await service.updateSettings({
      autoReinstallOnUpdate: false,
      onboardingCompleted: true,
    })
    const configured = await service.configureFolder({ root: inbox })
    assert.equal(configured.folder.installNew, true)
    assert.equal(configured.folder.autoUpdate, true)
    await service.startWatching(configured.folder.id)
    const added = service.listCatalog().find((entry) => entry.faces[0]?.familyName === 'Follow')
    assert.ok(added)
    assert.equal(added.status, 'installed')
    assert.ok(added.installedPath)
    const before = fs.readFileSync(added.installedPath)
    writeTestFont(font, 'Follow', 'Follow-Regular', { version: 'Version 2.000' })
    enqueueSourceStatusRefresh(paths, font)
    const after = await waitForEntry(service, added.id, (entry) => {
      if (entry.status !== 'installed' || !entry.installedPath) return false
      return !fs.readFileSync(entry.installedPath).equals(before)
    })
    assert.equal(after.status, 'installed')
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function entriesForSource(service: FontButlerService, filePath: string): CatalogEntry[] {
  const resolved = path.resolve(filePath)
  return service.listCatalog().filter((entry) => path.resolve(entry.sourcePath) === resolved)
}

function finishedWatchEntry(service: FontButlerService, filePath: string, family: string): boolean {
  const entries = entriesForSource(service, filePath)
  const entry = entries[0]
  return (
    entries.length === 1 &&
    entry?.status === 'installed' &&
    entry.faces[0]?.familyName === family &&
    entry.sourceFingerprint === fingerprintFile(filePath)
  )
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await delay(40)
  }
  assert.fail(label)
}

async function writeBytesInChunks(dest: string, bytes: Buffer, parts: number, gapMs: number): Promise<void> {
  const fd = fs.openSync(dest, 'w')
  try {
    const size = Math.max(1, Math.ceil(bytes.length / parts))
    for (let offset = 0; offset < bytes.length; offset += size) {
      const length = Math.min(size, bytes.length - offset)
      fs.writeSync(fd, bytes, offset, length, offset)
      fs.fsyncSync(fd)
      if (offset + length < bytes.length) await delay(gapMs)
    }
  } finally {
    fs.closeSync(fd)
  }
}

test('a font copied slowly into a watch folder appears after the write settles', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const staged = path.join(paths.dataRoot, 'staged-slow.ttf')
  fs.mkdirSync(inbox, { recursive: true })
  writeTestFont(staged, 'SlowDrop', 'SlowDrop-Regular')
  const bytes = fs.readFileSync(staged)
  const font = path.join(inbox, 'SlowDrop.ttf')
  const service = new FontButlerService(paths)
  try {
    await service.updateSettings({ onboardingCompleted: true })
    const configured = await service.configureFolder({ root: inbox, installNew: true })
    await service.startWatching(configured.folder.id)
    assert.equal(service.listCatalog().length, 0)

    const copying = writeBytesInChunks(font, bytes, 4, 600)
    await delay(700)
    assert.equal(
      service.listCatalog().some((entry) => entry.faces[0]?.familyName === 'SlowDrop'),
      false,
    )
    await copying
    await waitFor(
      () => finishedWatchEntry(service, font, 'SlowDrop'),
      INBOX_WRITE_STABILITY_MS + 8000,
      'slow watch-folder copy never landed in the library',
    )
    assert.equal(entriesForSource(service, font).length, 1)
    assert.equal(inboxRejectionForTest(font), undefined)
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('a truncated watch-folder font is imported after a later change', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const staged = path.join(paths.dataRoot, 'staged-recover.ttf')
  fs.mkdirSync(inbox, { recursive: true })
  writeTestFont(staged, 'Recovered', 'Recovered-Regular')
  const bytes = fs.readFileSync(staged)
  const font = path.join(inbox, 'Recovered.ttf')
  const service = new FontButlerService(paths)
  try {
    await service.updateSettings({ onboardingCompleted: true })
    const configured = await service.configureFolder({ root: inbox, installNew: true })
    await service.startWatching(configured.folder.id)

    fs.writeFileSync(font, bytes.subarray(0, 32))
    await waitFor(
      () => inboxRejectionForTest(font)?.size === 32,
      INBOX_WRITE_STABILITY_MS + 8000,
      'truncated watch file was not rejected',
    )
    assert.equal(
      service.listCatalog().some((entry) => entry.faces[0]?.familyName === 'Recovered'),
      false,
    )

    fs.writeFileSync(font, bytes)
    await waitFor(
      () => finishedWatchEntry(service, font, 'Recovered'),
      INBOX_WRITE_STABILITY_MS + 8000,
      'completed watch file did not recover after the change',
    )
    const [entry] = entriesForSource(service, font)
    assert.ok(entry)
    assert.equal(entry.sourceSize, bytes.length)
    assert.equal(entry.sourceFingerprint, fingerprintFile(font))
    assert.equal(inboxRejectionForTest(font), undefined)
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('a zero-filled pre-sized watch file lands once when the bytes are filled in', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const staged = path.join(paths.dataRoot, 'staged-presize.ttf')
  fs.mkdirSync(inbox, { recursive: true })
  writeTestFont(staged, 'PreSized', 'PreSized-Regular')
  const bytes = fs.readFileSync(staged)
  const font = path.join(inbox, 'PreSized.ttf')
  fs.writeFileSync(font, Buffer.alloc(bytes.length))
  const service = new FontButlerService(paths)
  try {
    await service.updateSettings({ onboardingCompleted: true })
    const configured = await service.configureFolder({ root: inbox, installNew: true })
    await service.startWatching(configured.folder.id)
    await waitFor(
      () => inboxRejectionForTest(font)?.size === bytes.length,
      INBOX_WRITE_STABILITY_MS + 8000,
      'zero-filled watch file was not rejected',
    )
    assert.equal(entriesForSource(service, font).length, 0)

    fs.writeFileSync(font, bytes)
    await waitFor(
      () => finishedWatchEntry(service, font, 'PreSized'),
      INBOX_WRITE_STABILITY_MS + 8000,
      'filled-in pre-sized font did not land once',
    )
    assert.equal(entriesForSource(service, font).length, 1)
    assert.equal(entriesForSource(service, font)[0]?.sourceFingerprint, fingerprintFile(font))
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('replacing a watched font updates the same library entry', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  fs.mkdirSync(inbox, { recursive: true })
  const font = path.join(inbox, 'Replaced.ttf')
  const service = new FontButlerService(paths)
  const errors: string[] = []
  const stop = onEvent((event) => {
    if (event.type === 'notice' && event.notice.kind === 'error') errors.push(event.notice.message)
  })
  try {
    await service.updateSettings({ onboardingCompleted: true })
    const configured = await service.configureFolder({ root: inbox, installNew: true })
    await service.startWatching(configured.folder.id)

    const stagedFirst = path.join(paths.dataRoot, 'staged-first.ttf')
    writeTestFont(stagedFirst, 'FirstCut', 'FirstCut-Regular')
    const firstBytes = fs.readFileSync(stagedFirst)
    const width = Math.max(firstBytes.length, 4096)
    const paddedFirst = Buffer.alloc(width)
    firstBytes.copy(paddedFirst)
    fs.writeFileSync(font, paddedFirst)
    await waitFor(
      () => finishedWatchEntry(service, font, 'FirstCut'),
      INBOX_WRITE_STABILITY_MS + 8000,
      'first pre-sized font was not imported',
    )
    const [original] = entriesForSource(service, font)
    assert.ok(original)

    writeTestFont(path.join(paths.dataRoot, 'staged-second.ttf'), 'FinalCut', 'FinalCut-Regular')
    const secondBytes = fs.readFileSync(path.join(paths.dataRoot, 'staged-second.ttf'))
    const paddedSecond = Buffer.alloc(width)
    secondBytes.copy(paddedSecond)
    fs.writeFileSync(font, paddedSecond)
    await waitFor(
      () => finishedWatchEntry(service, font, 'FinalCut'),
      INBOX_WRITE_STABILITY_MS + 8000,
      'replaced watch font did not update the original entry',
    )
    const entries = entriesForSource(service, font)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.id, original.id)
    assert.equal(entries[0]?.sourceFingerprint, fingerprintFile(font))
    assert.equal(service.listCatalog().filter((entry) => entry.faces[0]?.familyName === 'FirstCut').length, 0)
    assert.equal(errors.length, 0)
  } finally {
    stop()
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('a font still copying at startup lands once with the final fingerprint', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const staged = path.join(paths.dataRoot, 'staged-startup.ttf')
  fs.mkdirSync(inbox, { recursive: true })
  writeTestFont(staged, 'Startup', 'Startup-Regular')
  const bytes = fs.readFileSync(staged)
  const font = path.join(inbox, 'Startup.ttf')
  fs.writeFileSync(font, bytes.subarray(0, 32))
  const service = new FontButlerService(paths)
  try {
    await service.updateSettings({ onboardingCompleted: true })
    const configured = await service.configureFolder({ root: inbox, installNew: true })
    const errors: string[] = []
    const stop = onEvent((event) => {
      if (event.type === 'notice' && event.notice.kind === 'error') errors.push(event.notice.message)
    })
    try {
    await service.startWatching(configured.folder.id)
    await waitFor(
      () => inboxRejectionForTest(font)?.size === 32 && errors.length === 1,
      8000,
      'startup import did not report the partial font',
    )
    assert.match(errors[0] ?? '', /table directory|past the end|sfnt header/)
    assert.equal(entriesForSource(service, font).length, 0)

    fs.writeFileSync(font, bytes)
    await waitFor(
      () => finishedWatchEntry(service, font, 'Startup'),
      INBOX_WRITE_STABILITY_MS + 8000,
      'startup copy did not finish as a single library entry',
    )
    assert.equal(entriesForSource(service, font).length, 1)
    assert.equal(entriesForSource(service, font)[0]?.sourceFingerprint, fingerprintFile(font))
    assert.equal(errors.length, 1)
    } finally {
      stop()
    }
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('a garbage font dropped into a watch folder is reported once it settles', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  fs.mkdirSync(inbox, { recursive: true })
  const font = path.join(inbox, 'Garbage.otf')
  const service = new FontButlerService(paths)
  const errors: string[] = []
  const stop = onEvent((event) => {
    if (event.type === 'notice' && event.notice.kind === 'error') errors.push(event.notice.message)
  })
  try {
    await service.updateSettings({ onboardingCompleted: true })
    const configured = await service.configureFolder({ root: inbox, installNew: true })
    await service.startWatching(configured.folder.id)
    fs.writeFileSync(font, Buffer.from('this is not a font'))
    await waitFor(
      () => inboxRejectionForTest(font)?.size === fs.statSync(font).size,
      INBOX_WRITE_STABILITY_MS + 8000,
      'garbage watch file was not read',
    )
    assert.equal(errors.length, 0)
    assert.equal(entriesForSource(service, font).length, 0)
    await waitFor(
      () => errors.length === 1,
      INBOX_CORRUPT_SETTLE_MS + 3000,
      'settled garbage font was not reported',
    )
    assert.match(errors[0] ?? '', /Garbage\.otf/)
    await delay(500)
    assert.equal(errors.length, 1)
    assert.equal(service.listCatalog().length, 0)
  } finally {
    stop()
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('a truncated sfnt dropped into a watch folder reports the table error once', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  const staged = path.join(paths.dataRoot, 'staged-live-trunc.ttf')
  fs.mkdirSync(inbox, { recursive: true })
  writeTestFont(staged, 'CutOff', 'CutOff-Regular')
  const bytes = fs.readFileSync(staged)
  const font = path.join(inbox, 'CutOff.ttf')
  const service = new FontButlerService(paths)
  const errors: string[] = []
  const stop = onEvent((event) => {
    if (event.type === 'notice' && event.notice.kind === 'error') errors.push(event.notice.message)
  })
  try {
    await service.updateSettings({ onboardingCompleted: true })
    const configured = await service.configureFolder({ root: inbox, installNew: true })
    await service.startWatching(configured.folder.id)
    fs.writeFileSync(font, bytes.subarray(0, 32))
    await waitFor(
      () => inboxRejectionForTest(font)?.size === 32,
      INBOX_WRITE_STABILITY_MS + 8000,
      'truncated watch file was not read',
    )
    assert.equal(errors.length, 0)
    await waitFor(
      () => errors.length === 1,
      INBOX_CORRUPT_SETTLE_MS + 3000,
      'settled truncated font was not reported',
    )
    assert.match(errors[0] ?? '', /table directory|past the end|sfnt header/)
    await delay(500)
    assert.equal(errors.length, 1)
    assert.equal(entriesForSource(service, font).length, 0)
  } finally {
    stop()
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('a corrupt watch file imports once it is replaced with a real font', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  fs.mkdirSync(inbox, { recursive: true })
  const font = path.join(inbox, 'Repaired.ttf')
  const service = new FontButlerService(paths)
  const errors: string[] = []
  const stop = onEvent((event) => {
    if (event.type === 'notice' && event.notice.kind === 'error') errors.push(event.notice.message)
  })
  try {
    await service.updateSettings({ onboardingCompleted: true })
    const configured = await service.configureFolder({ root: inbox, installNew: true })
    await service.startWatching(configured.folder.id)
    fs.writeFileSync(font, Buffer.from('still-not-a-font'))
    await waitFor(
      () => errors.length === 1,
      INBOX_WRITE_STABILITY_MS + INBOX_CORRUPT_SETTLE_MS + 8000,
      'corrupt watch file was not reported',
    )
    assert.equal(entriesForSource(service, font).length, 0)
    writeTestFont(font, 'Repaired', 'Repaired-Regular')
    await waitFor(
      () => finishedWatchEntry(service, font, 'Repaired'),
      INBOX_WRITE_STABILITY_MS + 8000,
      'repaired watch font did not import',
    )
    assert.equal(entriesForSource(service, font).length, 1)
    assert.equal(entriesForSource(service, font)[0]?.sourceFingerprint, fingerprintFile(font))
    assert.equal(inboxRejectionForTest(font), undefined)
    await delay(500)
    assert.equal(errors.length, 1)
  } finally {
    stop()
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
    await service.updateSettings({ watchFolders: [inbox] })
    assert.equal(service.getSettings().folders[0]?.installNew, true)
    assert.equal(service.getSettings().folders[0]?.autoUpdate, true)
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

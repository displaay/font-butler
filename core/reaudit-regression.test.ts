import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { onEvent } from './events.ts'
import type { AppPaths } from './paths.ts'
import { FontButlerService } from './service.ts'
import { closeAllWatchers, enqueueSourceStatusRefresh, flushSourceStatusRefreshForTest } from './watch.ts'

function tempPaths(): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-reaudit-'))
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
pen.moveTo((0, 0)); pen.lineTo((500, 0)); pen.lineTo((250, 700)); pen.closePath()
fb.setupGlyf({".notdef": empty, "A": pen.glyph()})
fb.setupHorizontalMetrics({".notdef": (500, 0), "A": (600, 0)})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({"familyName": ${JSON.stringify(family)}, "styleName": "Regular", "uniqueFontIdentifier": ${JSON.stringify(psName)}, "fullName": ${JSON.stringify(`${family} Regular`)}, "psName": ${JSON.stringify(psName)}, "version": "Version 1.000"})
fb.setupOS2(); fb.setupPost()
fb.save(${JSON.stringify(dest)})
`
  execFileSync('python3', ['-c', script], { stdio: 'pipe' })
}

test('non-font watch events are ignored for source status refresh', async () => {
  const paths = tempPaths()
  fs.writeFileSync(paths.settingsPath, JSON.stringify({ onboardingCompleted: true, folders: [] }))
  fs.writeFileSync(paths.catalogPath, JSON.stringify({ version: 1, entries: [] }))
  let loadCount = 0
  const original = fs.readFileSync
  fs.readFileSync = ((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (typeof file === 'string' && file.endsWith('catalog.json')) {
      loadCount += 1
    }
    return (original as typeof fs.readFileSync)(file, ...(args as []))
  }) as typeof fs.readFileSync
  try {
    for (let i = 0; i < 50; i += 1) {
      enqueueSourceStatusRefresh(paths, path.join(paths.dataRoot, `note-${i}.txt`))
    }
    await flushSourceStatusRefreshForTest(paths)
    assert.equal(loadCount, 0)
  } finally {
    fs.readFileSync = original
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('fonts dropped into a watch folder before launch are imported on init', async () => {
  const paths = tempPaths()
  const inbox = path.join(paths.dataRoot, 'inbox')
  fs.mkdirSync(inbox, { recursive: true })
  const font = path.join(inbox, 'WhileClosed.ttf')
  writeTestFont(font, 'WhileClosed', 'WhileClosed-Regular')
  fs.writeFileSync(
    paths.settingsPath,
    JSON.stringify({
      version: 1,
      onboardingCompleted: true,
      watchFolders: [inbox],
      installWatchFolderFonts: false,
    }),
  )
  fs.writeFileSync(paths.catalogPath, JSON.stringify({ version: 1, entries: [] }))
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const entries = service.listCatalog()
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.status, 'uninstalled')
    assert.equal(path.resolve(entries[0]?.sourcePath ?? ''), path.resolve(font))
  } finally {
    service.dispose()
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('preview backfill coalesces catalog SSE events', async () => {
  const paths = tempPaths()
  const fontPath = path.join(paths.dataRoot, 'Preview.ttf')
  writeTestFont(fontPath, 'PreviewCoalesce', 'PreviewCoalesce-Regular')
  fs.writeFileSync(
    paths.settingsPath,
    JSON.stringify({ onboardingCompleted: true, folders: [] }),
  )
  const entries = Array.from({ length: 130 }, (_, index) => ({
    id: `e-${index}`,
    status: 'installed',
    sourcePath: fontPath,
    sourcePresent: true,
    installedPath: fontPath,
    format: 'ttf',
    faces: [{ postscriptName: 'PreviewCoalesce-Regular', familyName: 'PreviewCoalesce', subfamilyName: 'Regular' }],
    installations: [{ destinationId: 'macos', path: fontPath, verification: 'file-present' }],
    addedAt: new Date().toISOString(),
  }))
  fs.writeFileSync(paths.catalogPath, JSON.stringify({ version: 1, entries }))
  let catalogEvents = 0
  const stop = onEvent((event) => {
    if (event.type === 'catalog') catalogEvents += 1
  })
  const service = new FontButlerService(paths)
  try {
    for (;;) {
      const done = await service['fillMissingPreviewSamplesBatchUnlocked'](64)
      if (done) break
    }
    assert.ok(catalogEvents <= 3, `expected coalesced catalog events, got ${catalogEvents}`)
  } finally {
    stop()
    service.dispose()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('startup fingerprint-only refresh marks same-stamp source edits outdated', async () => {
  const paths = tempPaths()
  const source = path.join(paths.dataRoot, 'watch', 'Source.ttf')
  const installed = path.join(paths.userFontsDir, 'Source.ttf')
  fs.mkdirSync(path.dirname(source), { recursive: true })
  fs.mkdirSync(paths.userFontsDir, { recursive: true })
  writeTestFont(source, 'StampTest', 'StampTest-Regular')
  writeTestFont(installed, 'StampTest', 'StampTest-Regular')
  const st = fs.statSync(source)
  fs.writeFileSync(
    paths.settingsPath,
    JSON.stringify({ version: 1, onboardingCompleted: true, watchFolders: [] }),
  )
  fs.writeFileSync(
    paths.catalogPath,
    JSON.stringify({
      version: 1,
      entries: [
        {
          id: 'e1',
          status: 'installed',
          sourcePath: source,
          sourcePresent: true,
          sourceMtimeMs: st.mtimeMs,
          sourceSize: st.size,
          sourceFingerprint: 'stale-fingerprint',
          installedPath: installed,
          installedFingerprint: 'installed-fp',
          installedSnapshotMtimeMs: fs.statSync(installed).mtimeMs,
          installedSnapshotSize: fs.statSync(installed).size,
          format: 'ttf',
          previewSample: 'Aa',
          faces: [{ postscriptName: 'StampTest-Regular', familyName: 'StampTest', subfamilyName: 'Regular' }],
          installations: [{ destinationId: 'macos', path: installed, verification: 'file-present', fingerprint: 'installed-fp' }],
          addedAt: new Date().toISOString(),
        },
      ],
    }),
  )
  const service = new FontButlerService(paths)
  try {
    await service['refreshSourceStatuses'](true, { fingerprintOnly: true })
    const entry = service.listCatalog()[0]
    assert.equal(entry?.status, 'outdated')
    assert.notEqual(entry?.sourceFingerprint, 'stale-fingerprint')
  } finally {
    service.dispose()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('preview backfill releases the catalog lock between batches', async () => {
  const paths = tempPaths()
  const fontPath = path.join(paths.dataRoot, 'Parallel.ttf')
  writeTestFont(fontPath, 'Parallel', 'Parallel-Regular')
  fs.writeFileSync(
    paths.settingsPath,
    JSON.stringify({ version: 1, onboardingCompleted: true, watchFolders: [] }),
  )
  const entries = Array.from({ length: 80 }, (_, index) => ({
    id: `e-${index}`,
    status: 'installed',
    sourcePath: fontPath,
    sourcePresent: true,
    installedPath: fontPath,
    format: 'ttf',
    faces: [{ postscriptName: 'Parallel-Regular', familyName: 'Parallel', subfamilyName: 'Regular' }],
    installations: [{ destinationId: 'macos', path: fontPath, verification: 'file-present' }],
    addedAt: new Date().toISOString(),
  }))
  fs.writeFileSync(paths.catalogPath, JSON.stringify({ version: 1, entries }))
  const service = new FontButlerService(paths)
  try {
    service.startPreviewBackfill()
    const deadline = Date.now() + 5_000
    let listed = false
    while (Date.now() < deadline) {
      const catalog = service.listCatalog()
      if (catalog.length === 80) {
        listed = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(listed, true, 'listCatalog should not be blocked for the whole backfill')
  } finally {
    service.dispose()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

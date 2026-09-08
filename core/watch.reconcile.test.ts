import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { onEvent } from './events.ts'
import { fingerprintFile } from './fingerprint.ts'
import { withService, writeTestFont } from './test-util.ts'
import type { CatalogEntry, FontFaceInfo } from './types.ts'
import { reconcileWatchedSources, refreshSourceStatus, refreshWatchedEntry } from './watch.ts'

function watchedEntry(partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'sourcePath' | 'installedPath'>): CatalogEntry {
  const face: FontFaceInfo = {
    familyName: 'Watch',
    styleName: 'Regular',
    fullName: 'Watch Regular',
    postscriptName: 'Watch-Regular',
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
  return {
    id: 'watch',
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'installed',
    faces: [face],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

test('no-op reconcile does not rewrite catalog timestamps or emit', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const sources: string[] = []
    for (let i = 0; i < 6; i++) {
      const source = path.join(paths.dataRoot, `Watch${i}.ttf`)
      writeTestFont(source, `Watch${i}`, `Watch${i}-Regular`)
      sources.push(source)
    }
    const imported = await service.importPaths(sources)
    for (const entry of imported.entries) {
      await service.install(entry.id)
    }
    await reconcileWatchedSources(paths)
    const before = service.listCatalog().map((entry) => ({ id: entry.id, updatedAt: entry.updatedAt }))
    let catalogEvents = 0
    const stop = onEvent((event) => {
      if (event.type === 'catalog') catalogEvents += 1
    })
    try {
      const changed = await reconcileWatchedSources(paths)
      assert.deepEqual(changed, [])
      assert.equal(catalogEvents, 0)
      assert.deepEqual(
        service.listCatalog().map((entry) => ({ id: entry.id, updatedAt: entry.updatedAt })),
        before,
      )
    } finally {
      stop()
    }
  })
})

test('source change still marks installed fonts outdated', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Live.ttf')
    writeTestFont(source, 'Live', 'Live-Regular')
    const imported = await service.importPaths([source])
    await service.install(imported.entries[0]!.id)
    writeTestFont(source, 'Live', 'Live-Regular', { version: 'Version 2.000' })
    const later = Date.now() / 1000 + 2
    fs.utimesSync(source, later, later)
    const updated = await refreshSourceStatus(paths, source)
    assert.ok(updated)
    assert.equal(updated.status, 'outdated')
  })
})

test('stamp shortcut skips hashing unless refresh is watcher-triggered', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-stamp-'))
  try {
    const source = path.join(dir, 'Synced.ttf')
    const installed = path.join(dir, 'Installed.ttf')
    const original = Buffer.alloc(2048, 7)
    original[0] = 1
    fs.writeFileSync(source, original)
    fs.writeFileSync(installed, original)
    const fingerprint = fingerprintFile(source)
    const stat = fs.statSync(source)
    const entry = watchedEntry({
      sourcePath: source,
      installedPath: installed,
      sourceMtimeMs: stat.mtimeMs,
      sourceSize: stat.size,
      sourceFingerprint: fingerprint,
      installedFingerprint: fingerprint,
      installedSnapshotMtimeMs: stat.mtimeMs,
      installedSnapshotSize: stat.size,
      sourceAvailability: 'present',
      sourcePresent: true,
    })

    assert.equal(refreshWatchedEntry(entry), false)
    assert.equal(refreshWatchedEntry(entry, { forceFingerprint: true }), false)
    assert.equal(entry.status, 'installed')
    assert.equal(entry.sourceFingerprint, fingerprint)

    const replacement = Buffer.alloc(2048, 9)
    replacement[0] = 2
    fs.writeFileSync(source, replacement)
    const after = fs.statSync(source)
    entry.sourceMtimeMs = after.mtimeMs
    entry.sourceSize = after.size
    assert.equal(after.size, stat.size)

    assert.equal(refreshWatchedEntry(entry), false)
    assert.equal(entry.status, 'installed')
    assert.equal(entry.sourceFingerprint, fingerprint)

    assert.equal(refreshWatchedEntry(entry, { forceFingerprint: true }), true)
    assert.equal(entry.status, 'outdated')
    assert.equal(entry.sourceFingerprint, fingerprintFile(source))
    assert.notEqual(entry.sourceFingerprint, fingerprint)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('watcher refresh hashes same-size same-mtime source replaces', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Synced.ttf')
    writeTestFont(source, 'Synced', 'Synced-Regular')
    const imported = await service.importPaths([source])
    await service.install(imported.entries[0]!.id)
    const before = service.listCatalog()[0]!
    const original = fs.readFileSync(source)
    const replacement = Buffer.from(original)
    replacement[replacement.length - 1] ^= 0xff
    fs.writeFileSync(source, replacement)
    fs.utimesSync(source, before.sourceMtimeMs / 1000, before.sourceMtimeMs / 1000)
    const after = fs.statSync(source)
    assert.equal(after.size, before.sourceSize)
    if (after.mtimeMs === before.sourceMtimeMs) {
      const skipped = await reconcileWatchedSources(paths)
      assert.deepEqual(skipped, [])
      assert.equal(service.listCatalog()[0]!.status, 'installed')
      assert.equal(service.listCatalog()[0]!.sourceFingerprint, before.sourceFingerprint)
    }
    const updated = await refreshSourceStatus(paths, source)
    assert.ok(updated)
    assert.equal(updated.status, 'outdated')
    assert.notEqual(updated.sourceFingerprint, before.sourceFingerprint)
  })
})

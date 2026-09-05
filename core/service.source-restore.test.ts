import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { withService, writeTestFont } from './test-util.ts'
import { reconcileWatchedSources, refreshSourceStatus } from './watch.ts'

test('deleting and restoring a source recovers without restart', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'RestoreMe.ttf')
    writeTestFont(source, 'RestoreMe', 'RestoreMe-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0].id)
    assert.ok(installed.installedPath && fs.existsSync(installed.installedPath))

    fs.rmSync(source)
    const missing = await refreshSourceStatus(paths, source)
    assert.ok(missing)
    assert.equal(missing.sourcePresent, false)
    assert.notEqual(missing.status, 'source-missing')
    assert.equal(fs.existsSync(installed.installedPath), true)

    writeTestFont(source, 'RestoreMe', 'RestoreMe-Regular', { version: 'Version 2.000' })
    const restored = await refreshSourceStatus(paths, source)
    assert.ok(restored)
    assert.equal(restored.sourcePresent, true)
    assert.notEqual(restored.status, 'source-missing')
    assert.equal(restored.status, 'outdated')
  })
})

test('reconcile recovers an initially missing source after it reappears', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Later.ttf')
    writeTestFont(source, 'Later', 'Later-Regular')
    const imported = await service.importPaths([source])
    await service.install(imported.entries[0].id)
    fs.rmSync(source)
    await reconcileWatchedSources(paths)
    writeTestFont(source, 'Later', 'Later-Regular')
    const later = Date.now() / 1000 + 2
    fs.utimesSync(source, later, later)
    await reconcileWatchedSources(paths)
    const entry = service.listCatalog()[0]
    assert.ok(entry)
    assert.equal(entry.sourcePresent, true)
    assert.notEqual(entry.status, 'source-missing')
  })
})

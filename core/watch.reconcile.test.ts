import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { onEvent } from './events.ts'
import { withService, writeTestFont } from './test-util.ts'
import { reconcileWatchedSources, refreshSourceStatus } from './watch.ts'

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

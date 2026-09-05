import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { withService, writeTestFont } from './test-util.ts'

test('reinstall refreshes faces from the staged file', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Live.ttf')
    writeTestFont(source, 'Live', 'Live-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0].id)
    assert.equal(installed.faces[0]?.styleName, 'Regular')
    const beforeUpdatedAt = installed.updatedAt
    const beforeSnapshot = installed.installedSnapshotMtimeMs

    writeTestFont(source, 'Live', 'Live-Bold', { style: 'Bold' })
    const later = Date.now() / 1000 + 2
    fs.utimesSync(source, later, later)
    const updated = await service.reinstall(installed.id)
    assert.equal(updated.faces[0]?.styleName, 'Bold')
    assert.equal(updated.faces[0]?.postscriptName, 'Live-Bold')
    assert.notEqual(updated.updatedAt, beforeUpdatedAt)
    assert.notEqual(updated.installedSnapshotMtimeMs, beforeSnapshot)
  })
})

test('native activation failure does not persist a successful deactivate', async () => {
  const { noopFontNative, setFontNative } = await import('./native.ts')
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'StayOn.ttf')
    writeTestFont(source, 'StayOn', 'StayOn-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0].id)
    setFontNative(
      noopFontNative({
        async setFontEnabled() {
          return { ok: false, native: true, error: 'Core Text refused deactivation.' }
        },
      }),
    )
    await assert.rejects(() => service.deactivate(installed.id), /Core Text refused/)
    const latest = service.listCatalog().find((entry) => entry.id === installed.id)
    assert.equal(latest?.status, 'installed')
  })
})

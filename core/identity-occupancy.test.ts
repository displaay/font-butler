import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { occupiedDestinations } from './identity.ts'
import { withService, writeTestFont } from './test-util.ts'

test('listCatalog stamps occupiedDestinations from filesystem occupancy', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Live.ttf')
    writeTestFont(source, 'LiveFace', 'LiveFace-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const listed = service.listCatalog().find((entry) => entry.id === installed.id)
    assert.ok(listed)
    assert.deepEqual(listed.occupiedDestinations, occupiedDestinations(installed, paths))
    assert.ok(listed.occupiedDestinations?.includes('macos'))

    await service.deactivate(installed.id)
    const parked = service.listCatalog().find((entry) => entry.id === installed.id)
    assert.deepEqual(parked?.occupiedDestinations, [])
  })
})

import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { onEvent } from './events.ts'
import { withService, writeTestFont } from './test-util.ts'

test('batch install skips ineligible IDs and keeps partial results', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const regular = path.join(paths.dataRoot, 'Mixed-Regular.ttf')
    const bold = path.join(paths.dataRoot, 'Mixed-Bold.ttf')
    writeTestFont(regular, 'Mixed', 'Mixed-Regular')
    writeTestFont(bold, 'Mixed', 'Mixed-Bold', { style: 'Bold' })
    const imported = await service.importPaths([regular, bold])
    const first = imported.entries[0]
    const second = imported.entries[1]
    await service.install(first.id)
    const installed = await service.installMany([first.id, second.id])
    assert.equal(installed.length, 1)
    assert.equal(installed[0]?.id, second.id)
    assert.equal(service.listCatalog().find((entry) => entry.id === first.id)?.status, 'installed')
    assert.equal(service.listCatalog().find((entry) => entry.id === second.id)?.status, 'installed')
  })
})

test('batch install emits family progress for the status bar', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const inter = path.join(paths.dataRoot, 'Inter-Regular.ttf')
    const rec = path.join(paths.dataRoot, 'Recoleta-Regular.ttf')
    writeTestFont(inter, 'Inter', 'Inter-Regular')
    writeTestFont(rec, 'Recoleta', 'Recoleta-Regular')
    const imported = await service.importPaths([inter, rec])
    const events: Array<{ done: number; total: number }> = []
    const stop = onEvent((event) => {
      if (event.type === 'action-progress') {
        events.push({ done: event.done, total: event.total })
      }
    })
    await service.installMany(imported.entries.map((entry) => entry.id))
    stop()
    assert.deepEqual(events, [
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })
})

import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { createSavedFilter, deleteSavedFilter } from './saved-filters.ts'
import { loadSettings } from './settings.ts'
import { withService, writeTestFont } from './test-util.ts'

test('saving and deleting a library filter does not uninstall fonts', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Keep.ttf')
    writeTestFont(source, 'Keep', 'Keep-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const before = service.listCatalog().map((entry) => ({
      id: entry.id,
      status: entry.status,
      installedPath: entry.installedPath,
    }))

    const saved = createSavedFilter([], {
      name: 'Installed',
      query: 'Keep',
      libraryFilters: ['installed'],
      watchFolder: null,
    })
    await service.updateSettings({ savedFilters: saved })
    assert.deepEqual(loadSettings(paths).savedFilters, service.getSettings().savedFilters)
    assert.equal(loadSettings(paths).savedFilters[0]!.name, 'Installed')
    assert.equal(loadSettings(paths).savedFilters[0]!.query, 'Keep')

    const removed = deleteSavedFilter(service.getSettings().savedFilters, saved[0]!.id)
    await service.updateSettings({ savedFilters: removed })
    assert.deepEqual(loadSettings(paths).savedFilters, [])
    assert.deepEqual(
      service.listCatalog().map((entry) => ({
        id: entry.id,
        status: entry.status,
        installedPath: entry.installedPath,
      })),
      before,
    )
    assert.equal(service.listCatalog()[0]!.id, installed.id)
    assert.equal(service.listCatalog()[0]!.status, 'installed')
  })
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { loadCatalog, saveCatalog } from './catalog.ts'
import { loadSettings, saveSettings } from './settings.ts'
import { withService, writeTestFont } from './test-util.ts'
import type { CatalogEntry } from './types.ts'
import {
  RETAIL_NOT_DOWNLOADED_SYNC_OFF,
  RETAIL_NOT_DOWNLOADED_SYNC_ON,
} from '../shared/retail.ts'

function retailStub(patch: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'bagoss-vf',
    sourcePath: '',
    sourceMtimeMs: 0,
    sourceSize: 0,
    sourcePresent: false,
    sourceAvailability: 'none',
    retailRelativePath: 'Bagoss Collection/BagossCollectionVF.otf',
    retailFamilyName: 'Bagoss Collection VF',
    retailTypefaceName: 'Bagoss',
    status: 'uninstalled',
    faces: [
      {
        familyName: 'Bagoss Collection VF',
        styleName: 'Regular',
        fullName: 'Bagoss Collection VF',
        postscriptName: 'BagossCollectionVF-Regular',
        isVariable: true,
        instanceCount: 1,
        instanceNames: [],
        weight: 400,
        italic: false,
      },
    ],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

test('installing a retail font that was never downloaded explains sync instead of a missing file', async () => {
  await withService(async (service, paths) => {
    const entry = retailStub()
    saveCatalog(paths, { version: 1, entries: [entry] })
    await assert.rejects(() => service.install(entry.id), new RegExp(escapeRegExp(RETAIL_NOT_DOWNLOADED_SYNC_OFF)))
    await assert.rejects(
      () => service.install(entry.id),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.doesNotMatch(error.message, /source file is missing/)
        return true
      },
    )
    assert.deepEqual(loadCatalog(paths).entries[0], entry)

    const settings = loadSettings(paths)
    settings.retailSync = { ...settings.retailSync!, enabled: true }
    saveSettings(paths, settings)
    await assert.rejects(() => service.install(entry.id), new RegExp(escapeRegExp(RETAIL_NOT_DOWNLOADED_SYNC_ON)))
    assert.equal(loadCatalog(paths).entries[0]?.status, 'uninstalled')
    assert.equal(loadCatalog(paths).entries[0]?.sourceAvailability, 'none')
  })
})

test('installing a retail font whose recorded source is gone still reports a missing file', async () => {
  await withService(async (service, paths) => {
    const gone = path.join(paths.userFontsDir, 'BagossCollectionVF.otf')
    const entry = retailStub({
      sourcePath: gone,
      sourceAvailability: 'none',
      installedPath: gone,
      status: 'uninstalled',
    })
    saveCatalog(paths, { version: 1, entries: [entry] })
    await assert.rejects(() => service.install(entry.id), /The source file is missing\./)
  })
})

test('installing a non-retail font with no source still reports a missing file', async () => {
  await withService(async (service, paths) => {
    const entry = retailStub({
      id: 'local-missing',
      retailRelativePath: undefined,
      retailFamilyName: undefined,
      retailTypefaceName: undefined,
      sourcePath: path.join(paths.sourcesDir, 'Missing.otf'),
      sourceAvailability: 'missing',
      status: 'source-missing',
    })
    saveCatalog(paths, { version: 1, entries: [entry] })
    await assert.rejects(() => service.install(entry.id), /The source file is missing\./)
    await assert.rejects(() => service.installMany([entry.id]), /The source file is missing\./)
  })
})

test('a batch install of a never-downloaded retail row uses the sync message', async () => {
  await withService(async (service, paths) => {
    const entry = retailStub({ status: 'source-missing' })
    saveCatalog(paths, { version: 1, entries: [entry] })
    await assert.rejects(
      () => service.installMany([entry.id]),
      new RegExp(escapeRegExp(RETAIL_NOT_DOWNLOADED_SYNC_OFF)),
    )
  })
})

test('a retail font that is already on disk still installs', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.sourcesDir, 'BagossCollectionVF.otf')
    writeTestFont(source, 'Bagoss Collection VF', 'BagossCollectionVF-Regular', { format: 'otf' })
    const stat = fs.statSync(source)
    const entry = retailStub({
      sourcePath: source,
      sourcePresent: true,
      sourceAvailability: 'present',
      sourceMtimeMs: stat.mtimeMs,
      sourceSize: stat.size,
    })
    saveCatalog(paths, { version: 1, entries: [entry] })
    const installed = await service.install(entry.id)
    assert.equal(installed.status, 'installed')
    assert.equal(fs.existsSync(installed.installedPath ?? ''), true)
  })
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

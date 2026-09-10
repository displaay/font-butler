import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { readRetailToken } from './auth.ts'
import { loadCatalog } from './catalog.ts'
import { noopFontNative, setFontNative } from './native.ts'
import { buildPaths, retailTokenPath } from './paths.ts'
import type { AppPaths } from './paths.ts'
import {
  checkRetail,
  configureRetailSync,
  resetRetailCache,
  retailStatus,
  syncRetail,
} from './service-retail.ts'
import { loadSettings } from './settings.ts'
import { withService, writeTestFont } from './test-util.ts'
import { retailDriftSummary, type RetailManifest } from '../shared/retail.ts'

function setup(): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-retail-svc-'))
  const paths = buildPaths({ override: dataRoot, mac: false })
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  fs.mkdirSync(paths.userFontsDir, { recursive: true })
  setFontNative(noopFontNative())
  resetRetailCache()
  return paths
}

function manifestWith(size: number, etag: string): RetailManifest {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    collections: [
      {
        glyphsFile: 'Reckless',
        revisionId: 'rev-1',
        lastRegeneratedAt: '2026-01-01T00:00:00.000Z',
        files: [
          {
            key: 'Reckless/rev-1/RecklessVF.otf',
            relativePath: 'Reckless/RecklessVF.otf',
            size,
            etag,
            uploaded: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ],
    skipped: [],
  }
}

test('the worker token is stored outside settings.json and never reported back', () => {
  const paths = setup()

  const status = configureRetailSync(paths, {
    enabled: true,
    workerBaseUrl: 'https://w.displaay.net',
    token: 'super-secret',
  })

  assert.equal(status.hasToken, true)
  assert.equal(JSON.stringify(status).includes('super-secret'), false)

  const raw = fs.readFileSync(paths.settingsPath, 'utf8')
  assert.equal(raw.includes('super-secret'), false)
  assert.equal(readRetailToken(retailTokenPath(paths)), 'super-secret')
})

test('an empty token clears the stored one', () => {
  const paths = setup()
  configureRetailSync(paths, { token: 'abc' })
  assert.equal(retailStatus(paths).hasToken, true)
  const cleared = configureRetailSync(paths, { token: '' })
  assert.equal(cleared.hasToken, false)
})

test('a non-https worker address is rejected at configure time', () => {
  const paths = setup()
  assert.throws(
    () => configureRetailSync(paths, { workerBaseUrl: 'http://evil.example.com' }),
    /https/,
  )
})

test('enabling sync does not create a watch folder', () => {
  const paths = setup()
  const status = configureRetailSync(paths, { enabled: true })
  assert.equal(status.enabled, true)
  assert.equal(status.configured, true)
  assert.equal(loadSettings(paths).folders.length, 0)
  assert.equal(loadSettings(paths).watchFolders.length, 0)
})

test('turning sync off does not create a folder', () => {
  const paths = setup()
  const status = configureRetailSync(paths, { enabled: false })
  assert.equal(status.enabled, false)
  assert.equal(status.configured, false)
})

test('a check without a token reports an error rather than throwing', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true })
  const status = await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  assert.match(status.error ?? '', /token/i)
})

test('a check reports pending files, and a sync writes them into Fonts', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })

  const fetchManifest = async () => manifestWith(4, 'e1')

  const checked = await checkRetail(paths, { fetchManifest })
  assert.equal(checked.error, null)
  assert.equal(checked.pending, 1)
  assert.equal(checked.drift[0].kind, 'added')

  const synced = await syncRetail(paths, {
    fetchManifest,
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  assert.equal(synced.error, null)
  assert.equal(synced.pending, 0)
  assert.equal(fs.readFileSync(path.join(paths.userFontsDir, 'RecklessVF.otf')).length, 4)
  assert.ok(synced.syncedAt)
})

test('a regenerated file is picked up as changed on the next check', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })

  await syncRetail(paths, {
    fetchManifest: async () => manifestWith(4, 'e1'),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })

  const after = await checkRetail(paths, { fetchManifest: async () => manifestWith(6, 'e2') })
  assert.equal(after.pending, 1)
  assert.equal(after.drift[0].kind, 'changed')
  assert.equal(after.drift[0].relativePath, 'Reckless/RecklessVF.otf')
})

test('a worker failure surfaces as a status error, not an exception', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })
  const status = await checkRetail(paths, {
    fetchManifest: async () => {
      throw new Error('worker is down')
    },
  })
  assert.match(status.error ?? '', /worker is down/)
})

test('replacing the token discards drift measured with the old one', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })

  const rotated = configureRetailSync(paths, { token: 'new-token' })
  assert.equal(rotated.pending, 0)
  assert.equal(rotated.checkedAt, null)
})

test('toggling enabled alone keeps the existing drift', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })

  const toggled = configureRetailSync(paths, { enabled: false })
  assert.equal(toggled.pending, 1)
})

test('the on/off switch actually gates checking and syncing', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: false, token: 't' })

  let called = false
  const status = await checkRetail(paths, {
    fetchManifest: async () => {
      called = true
      return manifestWith(4, 'e1')
    },
  })
  assert.equal(called, false, 'a disabled collection must not contact the worker')
  assert.match(status.error ?? '', /turn on/i)
})

test('a failed check keeps the old checkedAt rather than claiming a fresh measurement', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })

  const good = await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  assert.ok(good.checkedAt)

  const failed = await checkRetail(paths, {
    fetchManifest: async () => {
      throw new Error('worker is down')
    },
  })
  assert.equal(failed.checkedAt, good.checkedAt, 'a failed check must not look freshly measured')
  assert.match(failed.error ?? '', /worker is down/)
  assert.equal(retailDriftSummary(failed), 'Could not check the collection.')
})

test('overlapping syncs share one run instead of fighting over the same files', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })

  let downloads = 0
  const options = {
    fetchManifest: async () => manifestWith(4, 'e1'),
    fetchFile: async () => {
      downloads += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      return new Uint8Array(4).fill(1)
    },
  }

  const [first, second] = await Promise.all([syncRetail(paths, options), syncRetail(paths, options)])
  assert.equal(downloads, 1, 'the second call must join the run already in progress')
  assert.equal(first.error, null)
  assert.deepEqual(first, second)

  const later = await syncRetail(paths, options)
  assert.equal(later.error, null)
})

test('the autocheck interval round-trips and rejects nonsense', () => {
  const paths = setup()

  assert.equal(configureRetailSync(paths, {}).autoCheckMinutes, 60)
  assert.equal(configureRetailSync(paths, { autoCheckMinutes: 15 }).autoCheckMinutes, 15)
  assert.equal(configureRetailSync(paths, { autoCheckMinutes: 0 }).autoCheckMinutes, 0)
  assert.equal(configureRetailSync(paths, { autoCheckMinutes: 0.2 }).autoCheckMinutes, 1)
  assert.equal(configureRetailSync(paths, { autoCheckMinutes: -5 }).autoCheckMinutes, 60)
  assert.equal(
    configureRetailSync(paths, { autoCheckMinutes: Number.NaN }).autoCheckMinutes,
    60,
  )

  configureRetailSync(paths, { autoCheckMinutes: 360 })
  assert.equal(loadSettings(paths).retailSync?.autoCheckMinutes, 360)
})

test('changing the interval alone does not discard measured drift', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })

  const changed = configureRetailSync(paths, { autoCheckMinutes: 60 })
  assert.equal(changed.pending, 1)
  assert.equal(changed.autoCheckMinutes, 60)
})

test('an occupied Fonts file still lists the retail font as not installed', async () => {
  const paths = setup()
  fs.writeFileSync(path.join(paths.userFontsDir, 'RecklessVF.otf'), 'mine')
  configureRetailSync(paths, { enabled: true, token: 't' })
  const status = await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  assert.equal(status.drift[0].kind, 'added')
  const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf')
  assert.ok(listing)
  assert.equal(listing.status, 'uninstalled')
  assert.equal(fs.readFileSync(path.join(paths.userFontsDir, 'RecklessVF.otf'), 'utf8'), 'mine')
})

test('dummy bytes land in Fonts without crashing catalog import', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })
  await syncRetail(paths, {
    fetchManifest: async () => manifestWith(4, 'e1'),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf')
  assert.ok(listing)
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), true)
})

test('a check lists every remote retail font even before a sync', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf')
  assert.ok(listing)
  assert.equal(listing.status, 'uninstalled')
})

test('uninstalling a retail font keeps the listing', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const dest = path.join(paths.userFontsDir, 'RecklessVF.otf')
    writeTestFont(dest, 'Reckless', 'RecklessVF', { format: 'otf' })
    const bytes = fs.readFileSync(dest)
    configureRetailSync(paths, { enabled: true, token: 't' })
    await syncRetail(paths, {
      fetchManifest: async () => manifestWith(bytes.length, 'e1'),
      fetchFile: async () => new Uint8Array(bytes),
    })
    const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf')
    assert.ok(listing)
    await service.uninstall(listing.id)
    const after = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf')
    assert.ok(after)
    assert.equal(after.status, 'uninstalled')
    await assert.rejects(() => service.forget(after.id), /stay in the collection/)
  })
})

test('installing a retail listing replaces the catalogue font that occupies Fonts', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const dest = path.join(paths.userFontsDir, 'RecklessVF.otf')
    writeTestFont(dest, 'LocalReckless', 'LocalRecklessVF', { format: 'otf', version: 'Version 1.000' })
    const imported = await service.importPaths([dest])
    assert.equal(imported.entries[0]?.status, 'installed')
    assert.equal(imported.entries[0]?.retailRelativePath, undefined)

    const incoming = path.join(paths.dataRoot, 'incoming.otf')
    writeTestFont(incoming, 'Reckless', 'RecklessVF', { format: 'otf', version: 'Version 2.000' })
    const bytes = fs.readFileSync(incoming)
    configureRetailSync(paths, { enabled: true, token: 't' })
    await checkRetail(paths, { fetchManifest: async () => manifestWith(bytes.length, 'e2') })
    const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf')
    assert.ok(listing)
    assert.equal(listing.status, 'uninstalled')

    await syncRetail(paths, {
      fetchManifest: async () => manifestWith(bytes.length, 'e2'),
      fetchFile: async () => new Uint8Array(bytes),
    })
    assert.equal(fs.readFileSync(dest).equals(bytes), false, 'sync must not overwrite the occupied Fonts file')

    const installed = await service.install(listing.id)
    assert.equal(installed.status, 'installed')
    assert.equal(installed.retailRelativePath, 'Reckless/RecklessVF.otf')
    assert.equal(fs.readFileSync(dest).equals(bytes), true)
    assert.equal(
      loadCatalog(paths).entries.some((entry) => entry.id === imported.entries[0]?.id),
      false,
    )
  })
})

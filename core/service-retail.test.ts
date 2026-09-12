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
import { RETAIL_DOWNLOAD_CONCURRENCY } from './retail-apply.ts'
import { withService, writeTestFont } from './test-util.ts'
import {
  filterDisabledRetailDrift,
  groupRetailFontsByTypeface,
  normalizeDisabledGlyphsFiles,
  normalizeFamilyFormats,
  retailDriftSummary,
  retailFontsFromCollections,
  type RetailManifest,
} from '../shared/retail.ts'

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
  return manifestWithFiles([{ basename: 'RecklessVF.otf', size, etag }])
}

function manifestWithFiles(
  files: Array<{ basename: string; size: number; etag: string }>,
): RetailManifest {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    collections: [
      {
        glyphsFile: 'Reckless',
        revisionId: 'rev-1',
        lastRegeneratedAt: '2026-01-01T00:00:00.000Z',
        files: files.map((file) => ({
          key: `Reckless/rev-1/${file.basename}`,
          relativePath: `Reckless/${file.basename}`,
          size: file.size,
          etag: file.etag,
          uploaded: '2026-01-01T00:00:00.000Z',
        })),
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

test('a check lists loaded families so each can be toggled', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })
  const status = await checkRetail(paths, {
    fetchManifest: async () => ({
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
              size: 4,
              etag: 'e1',
              uploaded: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        {
          glyphsFile: 'Zangezi',
          revisionId: 'rev-1',
          lastRegeneratedAt: '2026-01-01T00:00:00.000Z',
          files: [
            {
              key: 'Zangezi/rev-1/ZangeziVF.otf',
              relativePath: 'Zangezi/ZangeziVF.otf',
              size: 4,
              etag: 'e2',
              uploaded: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      ],
      skipped: [],
    }),
  })
  assert.deepEqual(
    status.fonts.map((font) => ({ glyphsFile: font.glyphsFile, enabled: font.enabled, fileCount: font.fileCount })),
    [
      { glyphsFile: 'Reckless', enabled: true, fileCount: 1 },
      { glyphsFile: 'Zangezi', enabled: true, fileCount: 1 },
    ],
  )
  assert.equal(status.pending, 2)

  const disabled = configureRetailSync(paths, { disabledGlyphsFiles: ['Zangezi'] })
  assert.equal(disabled.pending, 1)
  assert.equal(disabled.fonts.find((font) => font.glyphsFile === 'Zangezi')?.enabled, false)
  assert.equal(disabled.fonts.find((font) => font.glyphsFile === 'Reckless')?.enabled, true)
  assert.deepEqual(loadSettings(paths).retailSync?.disabledGlyphsFiles, ['Zangezi'])
})

test('sync skips families the user turned off', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't', disabledGlyphsFiles: ['Zangezi'] })
  const keys: string[] = []
  await syncRetail(paths, {
    fetchManifest: async () => ({
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
              size: 4,
              etag: 'e1',
              uploaded: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        {
          glyphsFile: 'Zangezi',
          revisionId: 'rev-1',
          lastRegeneratedAt: '2026-01-01T00:00:00.000Z',
          files: [
            {
              key: 'Zangezi/rev-1/ZangeziVF.otf',
              relativePath: 'Zangezi/ZangeziVF.otf',
              size: 4,
              etag: 'e2',
              uploaded: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      ],
      skipped: [],
    }),
    fetchFile: async ({ key }) => {
      keys.push(key)
      return new Uint8Array(4).fill(1)
    },
  })
  assert.deepEqual(keys, ['Reckless/rev-1/RecklessVF.otf'])
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), true)
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'ZangeziVF.otf')), false)
})

test('a restart still lists families from catalog listings', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  resetRetailCache()
  const status = retailStatus(paths)
  assert.deepEqual(
    status.fonts.map((font) => font.glyphsFile),
    ['Reckless'],
  )
})

test('a check lists skipped families so they can still be toggled', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })
  const status = await checkRetail(paths, {
    fetchManifest: async () => ({
      generatedAt: '2026-01-01T00:00:00.000Z',
      collections: [],
      skipped: [{ glyphsFile: 'Aguzzo', reason: 'incomplete' }],
    }),
  })
  assert.deepEqual(status.fonts, [
    {
      familyName: 'Aguzzo',
      typefaceName: 'Aguzzo',
      glyphsFile: 'Aguzzo',
      fileCount: 0,
      enabled: true,
      available: false,
      formats: [],
      selectedFormat: 'otf',
    },
  ])
})

test('normalizeDisabledGlyphsFiles trims, drops blanks, and sorts', () => {
  assert.deepEqual(normalizeDisabledGlyphsFiles([' Zangezi ', '', 'Reckless', 'Zangezi']), [
    'Reckless',
    'Zangezi',
  ])
  assert.deepEqual(normalizeDisabledGlyphsFiles(undefined), [])
})

test('filterDisabledRetailDrift hides opted-out families', () => {
  const drift = [
    { kind: 'added' as const, relativePath: 'Reckless/a.otf', glyphsFile: 'Reckless' },
    { kind: 'added' as const, relativePath: 'Zangezi/b.otf', glyphsFile: 'Zangezi' },
  ]
  assert.deepEqual(
    filterDisabledRetailDrift(drift, ['Zangezi']).map((item) => item.glyphsFile),
    ['Reckless'],
  )
})

test('retailFontsFromCollections sorts and marks disabled families', () => {
  assert.deepEqual(
    retailFontsFromCollections(
      [
        { glyphsFile: 'Zangezi', files: [1, 2] },
        { glyphsFile: 'Reckless', files: [1] },
      ],
      ['Zangezi'],
      [{ glyphsFile: 'Aguzzo' }],
    ),
    [
      {
        familyName: 'Aguzzo',
        typefaceName: 'Aguzzo',
        glyphsFile: 'Aguzzo',
        fileCount: 0,
        enabled: true,
        available: false,
        formats: [],
        selectedFormat: 'otf',
      },
      {
        familyName: 'Reckless',
        typefaceName: 'Reckless',
        glyphsFile: 'Reckless',
        fileCount: 1,
        enabled: true,
        available: true,
        formats: [],
        selectedFormat: 'otf',
      },
      {
        familyName: 'Zangezi',
        typefaceName: 'Zangezi',
        glyphsFile: 'Zangezi',
        fileCount: 2,
        enabled: false,
        available: true,
        formats: [],
        selectedFormat: 'otf',
      },
    ],
  )
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

test('an uninstall during a later retail batch is not overwritten by stale catalog writes', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const size = 4
    const files = Array.from({ length: RETAIL_DOWNLOAD_CONCURRENCY + 1 }, (_, index) => ({
      basename: `Face${index}.otf`,
      size,
      etag: `e-${index}`,
    }))
    const firstRelative = `Reckless/${files[0]!.basename}`
    const lastKey = `Reckless/rev-1/${files.at(-1)!.basename}`
    configureRetailSync(paths, { enabled: true, token: 't' })
    await checkRetail(paths, { fetchManifest: async () => manifestWithFiles(files) })
    const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === firstRelative)
    assert.ok(listing)

    const status = await syncRetail(paths, {
      fetchManifest: async () => manifestWithFiles(files),
      fetchFile: async (options) => {
        if (options.key === lastKey) {
          const persisted = loadCatalog(paths).entries.find((entry) => entry.id === listing.id)
          assert.equal(persisted?.status, 'installed')
          await service.uninstall(listing.id)
        }
        return new Uint8Array(size).fill(1)
      },
    })
    assert.equal(status.error, null)
    const after = loadCatalog(paths).entries.find((entry) => entry.id === listing.id)
    assert.ok(after)
    assert.equal(after.status, 'uninstalled')
    assert.equal(fs.existsSync(path.join(paths.userFontsDir, files[0]!.basename)), false)
  })
})

test('a large retail sync yields so other work on the same event loop can run', async () => {
  const paths = setup()
  const fixture = path.join(paths.dataRoot, 'fixture.otf')
  writeTestFont(fixture, 'Reckless', 'RecklessVF', { format: 'otf' })
  const bytes = fs.readFileSync(fixture)
  const files = Array.from({ length: 24 }, (_, index) => ({
    basename: `Face${index}.otf`,
    size: bytes.length,
    etag: `e-${index}`,
  }))
  configureRetailSync(paths, { enabled: true, token: 't' })

  let catalogSaves = 0
  const renameSync = fs.renameSync
  fs.renameSync = function (from, to, ...rest) {
    if (to === paths.catalogPath) catalogSaves += 1
    return renameSync.call(fs, from, to, ...rest)
  }

  const started = Date.now()
  let timerDelay = Number.POSITIVE_INFINITY
  const timer = new Promise<void>((resolve) => {
    setTimeout(() => {
      timerDelay = Date.now() - started
      resolve()
    }, 0)
  })
  try {
    const status = await syncRetail(paths, {
      fetchManifest: async () => manifestWithFiles(files),
      fetchFile: async () => new Uint8Array(bytes),
    })
    assert.equal(status.error, null)
    await timer
  } finally {
    fs.renameSync = renameSync
  }

  assert.ok(
    timerDelay < 200,
    `retail sync blocked the event loop for ${timerDelay}ms`,
  )
  // Listings once, then one save per download batch — not one rewrite per file.
  const expectedBatches = Math.ceil(files.length / RETAIL_DOWNLOAD_CONCURRENCY)
  assert.ok(
    catalogSaves <= expectedBatches + 2,
    `catalog was rewritten ${catalogSaves} times for ${files.length} files`,
  )
  assert.equal(loadCatalog(paths).entries.filter((entry) => entry.retailRelativePath).length, files.length)
})

function azeretFile(
  familyName: string,
  basename: string,
  size = 4,
  etag = `e-${basename}`,
) {
  return {
    key: `Azeret/rev-1/${basename}`,
    relativePath: `Azeret/${basename}`,
    size,
    etag,
    uploaded: '2026-01-01T00:00:00.000Z',
    familyName,
  }
}

function azeretManifest(): RetailManifest {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    collections: [
      {
        typefaceName: 'Azeret',
        revisionId: 'rev-1',
        lastRegeneratedAt: '2026-01-01T00:00:00.000Z',
        files: [
          azeretFile('Azeret', 'Azeret-Regular.otf'),
          azeretFile('Azeret', 'Azeret-Regular.ttf'),
          azeretFile('Azeret Mono', 'AzeretMono-Regular.otf'),
          azeretFile('Azeret Mono', 'AzeretMono-Regular.ttf'),
          azeretFile('Azeret VF', 'AzeretVF.ttf'),
        ],
      },
    ],
    skipped: [],
  }
}

test('retailFontsFromCollections groups families under typefaceName and picks a format', () => {
  const fonts = retailFontsFromCollections(azeretManifest().collections, ['Azeret Mono'], [], {
    Azeret: 'ttf',
  })
  assert.deepEqual(
    fonts.map((font) => ({
      familyName: font.familyName,
      typefaceName: font.typefaceName,
      enabled: font.enabled,
      formats: font.formats,
      selectedFormat: font.selectedFormat,
      fileCount: font.fileCount,
    })),
    [
      {
        familyName: 'Azeret',
        typefaceName: 'Azeret',
        enabled: true,
        formats: ['otf', 'ttf'],
        selectedFormat: 'ttf',
        fileCount: 1,
      },
      {
        familyName: 'Azeret Mono',
        typefaceName: 'Azeret',
        enabled: false,
        formats: ['otf', 'ttf'],
        selectedFormat: 'otf',
        fileCount: 1,
      },
      {
        familyName: 'Azeret VF',
        typefaceName: 'Azeret',
        enabled: true,
        formats: ['ttf'],
        selectedFormat: 'ttf',
        fileCount: 1,
      },
    ],
  )
  assert.deepEqual(
    groupRetailFontsByTypeface(fonts).map((group) => ({
      typefaceName: group.typefaceName,
      families: group.fonts.map((font) => font.familyName),
    })),
    [{ typefaceName: 'Azeret', families: ['Azeret', 'Azeret Mono', 'Azeret VF'] }],
  )
})

test('normalizeFamilyFormats keeps only otf/ttf keys', () => {
  assert.deepEqual(normalizeFamilyFormats({ ' Azeret ': 'ttf', Mono: 'woff', '': 'otf' }), {
    Azeret: 'ttf',
  })
  assert.deepEqual(normalizeFamilyFormats(['otf']), {})
})

test('filterDisabledRetailDrift hides the unselected format as well as opted-out families', () => {
  const drift = [
    {
      kind: 'added' as const,
      relativePath: 'Azeret/Azeret-Regular.otf',
      glyphsFile: 'Azeret',
      familyName: 'Azeret',
    },
    {
      kind: 'added' as const,
      relativePath: 'Azeret/Azeret-Regular.ttf',
      glyphsFile: 'Azeret',
      familyName: 'Azeret',
    },
    {
      kind: 'added' as const,
      relativePath: 'Azeret/AzeretMono-Regular.otf',
      glyphsFile: 'Azeret',
      familyName: 'Azeret Mono',
    },
  ]
  assert.deepEqual(
    filterDisabledRetailDrift(drift, ['Azeret Mono'], {
      selectedFormats: { Azeret: 'ttf', 'Azeret Mono': 'otf' },
    }).map((item) => item.relativePath),
    ['Azeret/Azeret-Regular.ttf'],
  )
})

test('a check lists typeface children with format toggles', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })
  const status = await checkRetail(paths, { fetchManifest: async () => azeretManifest() })
  assert.deepEqual(
    status.fonts.map((font) => ({
      familyName: font.familyName,
      typefaceName: font.typefaceName,
      formats: font.formats,
      selectedFormat: font.selectedFormat,
    })),
    [
      { familyName: 'Azeret', typefaceName: 'Azeret', formats: ['otf', 'ttf'], selectedFormat: 'otf' },
      {
        familyName: 'Azeret Mono',
        typefaceName: 'Azeret',
        formats: ['otf', 'ttf'],
        selectedFormat: 'otf',
      },
      { familyName: 'Azeret VF', typefaceName: 'Azeret', formats: ['ttf'], selectedFormat: 'ttf' },
    ],
  )
  assert.equal(status.pending, 3)
})

test('sync downloads only the selected format of enabled families', async () => {
  const paths = setup()
  configureRetailSync(paths, {
    enabled: true,
    token: 't',
    disabledGlyphsFiles: ['Azeret Mono'],
    familyFormats: { Azeret: 'ttf' },
  })
  const keys: string[] = []
  await syncRetail(paths, {
    fetchManifest: async () => azeretManifest(),
    fetchFile: async ({ key }) => {
      keys.push(key)
      return new Uint8Array(4).fill(1)
    },
  })
  assert.deepEqual(keys.sort(), ['Azeret/rev-1/Azeret-Regular.ttf', 'Azeret/rev-1/AzeretVF.ttf'])
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'Azeret-Regular.ttf')), true)
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'Azeret-Regular.otf')), false)
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'AzeretMono-Regular.otf')), false)
})

test('switching format uninstalls the other format instead of installing both', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't', familyFormats: { Azeret: 'otf' } })
  const fetchManifest = async () => azeretManifest()
  await syncRetail(paths, {
    fetchManifest,
    fetchFile: async ({ key }) => {
      assert.equal(key.includes('.ttf') && key.includes('Azeret-Regular'), false)
      return new Uint8Array(4).fill(1)
    },
  })
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'Azeret-Regular.otf')), true)
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'Azeret-Regular.ttf')), false)

  const switched = configureRetailSync(paths, { familyFormats: { Azeret: 'ttf' } })
  assert.equal(switched.fonts.find((font) => font.familyName === 'Azeret')?.selectedFormat, 'ttf')
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'Azeret-Regular.otf')), false)

  const keys: string[] = []
  await syncRetail(paths, {
    fetchManifest,
    fetchFile: async ({ key }) => {
      keys.push(key)
      return new Uint8Array(4).fill(1)
    },
  })
  assert.equal(keys.includes('Azeret/rev-1/Azeret-Regular.ttf'), true)
  assert.equal(keys.includes('Azeret/rev-1/Azeret-Regular.otf'), false)
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'Azeret-Regular.ttf')), true)
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'Azeret-Regular.otf')), false)
})

test('a restart still lists typeface families from catalog listings', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })
  await checkRetail(paths, { fetchManifest: async () => azeretManifest() })
  resetRetailCache()
  const status = retailStatus(paths)
  assert.deepEqual(
    status.fonts.map((font) => font.familyName),
    ['Azeret', 'Azeret Mono', 'Azeret VF'],
  )
  assert.equal(status.fonts.find((font) => font.familyName === 'Azeret')?.typefaceName, 'Azeret')
})

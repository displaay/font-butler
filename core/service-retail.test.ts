import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { readRetailToken } from './auth.ts'
import { loadCatalog, runCatalogTask, saveCatalog } from './catalog.ts'
import { fingerprintFile } from './fingerprint.ts'
import { noopFontNative, setFontNative } from './native.ts'
import { buildPaths, retailTokenPath } from './paths.ts'
import type { AppPaths } from './paths.ts'
import {
  checkRetail,
  configureRetailSync,
  dropOrphanRetailListings,
  resetRetailCache,
  resolveDropRetailCollisions,
  retailStatus,
  retailSyncNeedsResume,
  retailWorkerToken,
  syncRetail,
} from './service-retail.ts'
import { onEvent } from './events.ts'
import {
  catalogEntryFamilyNames,
  familyHasValidDropReplacement,
  incomingPathStillMatchesFamily,
  isRetailOwnedInstall,
  findOutsideCollisionsForRetailFamilies,
  findRetailCollisionsForIncomingFamilies,
} from './retail-collisions.ts'
import { DEFAULT_RETAIL_TRIAL_TOKEN, loadSettings, saveSettings } from './settings.ts'
import { RETAIL_DOWNLOAD_CONCURRENCY } from './retail-apply.ts'
import { loadRetailManifest, saveRetailManifest } from './retail-sync.ts'
import { withService, writeTestFont } from './test-util.ts'
import {
  filterDisabledRetailDrift,
  groupRetailFontsByTypeface,
  isRetailFamilyOptedOut,
  normalizeDisabledGlyphsFiles,
  normalizeFamilyFormats,
  retailDriftSummary,
  retailFontsFromCollections,
  type RetailManifest,
} from '../shared/retail.ts'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup(): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-retail-svc-'))
  const paths = buildPaths({ override: dataRoot, mac: false })
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  fs.mkdirSync(paths.userFontsDir, { recursive: true })
  setFontNative(noopFontNative())
  resetRetailCache()
  return paths
}

function emptyManifest(): RetailManifest {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    collections: [],
    skipped: [],
  }
}

/** The trial cut the built-in token gets: sibling `-TRIALS` revision folder, `-TRIAL` file names. */
function trialManifest(): RetailManifest {
  return {
    mode: 'trial',
    generatedAt: '2026-01-01T00:00:00.000Z',
    collections: [
      {
        glyphsFile: 'Reckless',
        revisionId: 'rev-1',
        lastRegeneratedAt: '2026-01-01T00:00:00.000Z',
        files: [
          {
            key: 'Reckless/rev-1-TRIALS/Reckless-TRIAL-VF.otf',
            relativePath: 'Reckless/Reckless-TRIAL-VF.otf',
            size: 4,
            etag: 't1',
            uploaded: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ],
    skipped: [],
  }
}

function manifestWith(size: number, etag: string, basename = 'RecklessVF.otf'): RetailManifest {
  return manifestWithFiles([{ basename, size, etag }])
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

test('the worker token is stored outside settings.json and never reported back', async () => {
  const paths = setup()

  const status = await configureRetailSync(paths, {
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

test('the stored worker token can be read on demand without appearing in status', async () => {
  const paths = setup()
  await configureRetailSync(paths, { token: 'super-secret' })
  const status = retailStatus(paths)
  assert.equal(status.hasToken, true)
  assert.equal(JSON.stringify(status).includes('super-secret'), false)
  assert.equal(retailWorkerToken(paths), 'super-secret')
})

test('an empty token clears the stored one', async () => {
  const paths = setup()
  await configureRetailSync(paths, { token: 'abc' })
  assert.equal(retailStatus(paths).hasToken, true)
  const cleared = await configureRetailSync(paths, { token: '' })
  assert.equal(cleared.hasToken, false)
})

test('a non-https worker address is rejected at configure time', async () => {
  const paths = setup()
  await assert.rejects(
    () => configureRetailSync(paths, { workerBaseUrl: 'http://evil.example.com' }),
    /https/,
  )
})

test('enabling sync does not create a watch folder', async () => {
  const paths = setup()
  const status = await configureRetailSync(paths, { enabled: true })
  assert.equal(status.enabled, true)
  assert.equal(status.configured, true)
  assert.equal(loadSettings(paths).folders.length, 0)
  assert.equal(loadSettings(paths).watchFolders.length, 0)
})

test('turning sync off does not create a folder', async () => {
  const paths = setup()
  const status = await configureRetailSync(paths, { enabled: false })
  assert.equal(status.enabled, false)
  assert.equal(status.configured, false)
})

test('turning sync off keeps installed fonts unless remove is chosen', async () => {
  resetRetailCache()
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  await syncRetail(paths, {
    fetchManifest: async () => manifestWith(4, 'e1'),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  const dest = path.join(paths.userFontsDir, 'RecklessVF.otf')
  assert.equal(fs.existsSync(dest), true)
  const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath)
  assert.ok(listing)

  const kept = await configureRetailSync(paths, { enabled: false, disableAction: 'keep' })
  assert.equal(kept.enabled, false)
  assert.equal(fs.existsSync(dest), true)
  const afterKeep = loadCatalog(paths).entries.find((entry) => entry.id === listing.id)
  assert.equal(afterKeep?.status, 'installed')
  assert.ok(afterKeep?.retailRelativePath)
  assert.equal(Object.keys(loadRetailManifest(paths).files).length, 1)
})

test('file-less retail listings are dropped after sync is off', async () => {
  resetRetailCache()
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  await syncRetail(paths, {
    fetchManifest: async () => manifestWith(4, 'e1'),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  await configureRetailSync(paths, { enabled: false, disableAction: 'keep' })
  const dest = path.join(paths.userFontsDir, 'RecklessVF.otf')
  fs.rmSync(dest, { force: true })
  const catalog = loadCatalog(paths)
  const listing = catalog.entries.find((entry) => entry.retailRelativePath)
  assert.ok(listing)
  listing.installedPath = undefined
  listing.installations = []
  listing.sourcePresent = false
  listing.sourceAvailability = 'missing'
  listing.status = 'source-missing'
  saveCatalog(paths, catalog)

  assert.equal(await dropOrphanRetailListings(paths), 1)
  assert.equal(
    loadCatalog(paths).entries.some((entry) => entry.retailRelativePath),
    false,
  )
  assert.equal(Object.keys(loadRetailManifest(paths).files).length, 0)
})

test('forgetMissingSources removes orphan retail listings when sync is off', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    await configureRetailSync(paths, { enabled: true, token: 't' })
    await syncRetail(paths, {
      fetchManifest: async () => manifestWith(4, 'e1'),
      fetchFile: async () => new Uint8Array(4).fill(1),
    })
    await configureRetailSync(paths, { enabled: false, disableAction: 'keep' })
    const dest = path.join(paths.userFontsDir, 'RecklessVF.otf')
    fs.rmSync(dest, { force: true })
    const catalog = loadCatalog(paths)
    const listing = catalog.entries.find((entry) => entry.retailRelativePath)
    assert.ok(listing)
    listing.installedPath = undefined
    listing.installations = []
    listing.sourcePresent = false
    listing.sourceAvailability = 'missing'
    listing.status = 'source-missing'
    saveCatalog(paths, catalog)

    const result = await service.forgetMissingSources()
    assert.equal(result.removed, 1)
    assert.equal(
      loadCatalog(paths).entries.some((entry) => entry.retailRelativePath),
      false,
    )
  })
})

test('turning sync off with remove uninstalls fonts and drops the listings', async () => {
  resetRetailCache()
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  await syncRetail(paths, {
    fetchManifest: async () => manifestWith(4, 'e1'),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  const dest = path.join(paths.userFontsDir, 'RecklessVF.otf')
  assert.equal(fs.existsSync(dest), true)

  const removed = await configureRetailSync(paths, { enabled: false, disableAction: 'remove' })
  assert.equal(removed.enabled, false)
  assert.equal(fs.existsSync(dest), false)
  assert.equal(
    loadCatalog(paths).entries.some((entry) => entry.retailRelativePath),
    false,
  )
  assert.equal(Object.keys(loadRetailManifest(paths).files).length, 0)
  assert.equal(removed.fonts.length, 0)
})

test('turning sync off with remove leaves a non-retail occupant in Fonts', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const dest = path.join(paths.userFontsDir, 'RecklessVF.otf')
    writeTestFont(dest, 'LocalReckless', 'LocalRecklessVF', { format: 'otf' })
    const imported = await service.importPaths([dest])
    assert.equal(imported.entries[0]?.retailRelativePath, undefined)

    await configureRetailSync(paths, { enabled: true, token: 't' })
    await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
    assert.ok(loadCatalog(paths).entries.some((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf'))

    await configureRetailSync(paths, { enabled: false, disableAction: 'remove' })
    assert.equal(fs.existsSync(dest), true)
    assert.equal(
      loadCatalog(paths).entries.some((entry) => entry.retailRelativePath),
      false,
    )
    assert.equal(
      loadCatalog(paths).entries.some((entry) => entry.id === imported.entries[0]?.id),
      true,
    )
  })
})

test('without a saved token a check uses the built-in trial token', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true })
  const tokens: string[] = []
  const status = await checkRetail(paths, {
    fetchManifest: async (options) => {
      tokens.push(options.token)
      return trialManifest()
    },
  })
  assert.deepEqual(tokens, [DEFAULT_RETAIL_TRIAL_TOKEN])
  assert.equal(status.error, null)
  assert.equal(status.hasToken, false)
  assert.equal(status.mode, 'trial')
  // The built-in token is never revealed as if the user had saved it.
  assert.equal(retailWorkerToken(paths), '')
})

test('a saved token replaces the built-in trial token', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 'retail-token' })
  const tokens: string[] = []
  const status = await checkRetail(paths, {
    fetchManifest: async (options) => {
      tokens.push(options.token)
      return { ...manifestWith(4, 'e1'), mode: 'retail' }
    },
  })
  assert.deepEqual(tokens, ['retail-token'])
  assert.equal(status.mode, 'retail')
})

async function syncTrialFont(paths: AppPaths): Promise<string> {
  await configureRetailSync(paths, { enabled: true })
  const synced = await syncRetail(paths, {
    fetchManifest: async () => trialManifest(),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  assert.equal(synced.error, null)
  const trialFile = path.join(paths.userFontsDir, 'Reckless-TRIAL-VF.otf')
  assert.equal(fs.existsSync(trialFile), true)
  return trialFile
}

for (const via of ['check', 'sync'] as const) {
  test(`a ${via} with a retail token replaces the synced trial collection`, async () => {
    const paths = setup()
    const trialFile = await syncTrialFont(paths)
    await configureRetailSync(paths, { token: 'retail-token' })
    const fetchManifest = async () => ({ ...manifestWith(4, 'e1'), mode: 'retail' as const })
    const status =
      via === 'check'
        ? await checkRetail(paths, { fetchManifest })
        : await syncRetail(paths, { fetchManifest, fetchFile: async () => new Uint8Array(4).fill(2) })
    assert.equal(status.error, null)
    assert.equal(status.mode, 'retail')
    assert.equal(fs.existsSync(trialFile), false)
    assert.deepEqual(
      loadCatalog(paths).entries.map((entry) => entry.retailRelativePath),
      ['Reckless/RecklessVF.otf'],
    )
    assert.equal('Reckless/Reckless-TRIAL-VF.otf' in loadRetailManifest(paths).files, false)
    assert.equal(status.drift.some((item) => item.kind === 'removed'), false)
  })
}

test('removing the token puts the trial collection back in place of the retail one', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 'retail-token' })
  await syncRetail(paths, {
    fetchManifest: async () => ({ ...manifestWith(4, 'e1'), mode: 'retail' as const }),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  const retailFile = path.join(paths.userFontsDir, 'RecklessVF.otf')
  assert.equal(fs.existsSync(retailFile), true)
  await configureRetailSync(paths, { token: '' })
  const status = await checkRetail(paths, { fetchManifest: async () => trialManifest() })
  assert.equal(status.mode, 'trial')
  assert.equal(fs.existsSync(retailFile), false)
  assert.deepEqual(
    loadCatalog(paths).entries.map((entry) => entry.retailRelativePath),
    ['Reckless/Reckless-TRIAL-VF.otf'],
  )
})

test('a sync record from before trial tokens is read as retail from its keys', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 'retail-token' })
  // An older worker: no `mode` in the manifest.
  await syncRetail(paths, {
    fetchManifest: async () => manifestWith(4, 'e1'),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  const { mode: _dropped, ...legacy } = loadRetailManifest(paths)
  saveRetailManifest(paths, legacy)
  resetRetailCache()
  assert.equal(retailStatus(paths).mode, 'retail')

  await configureRetailSync(paths, { token: '' })
  await checkRetail(paths, { fetchManifest: async () => trialManifest() })
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), false)
})

test('a full sync keeps the stamped collection mode on disk', async () => {
  const paths = setup()
  await syncTrialFont(paths)
  assert.equal(loadRetailManifest(paths).mode, 'trial')
  resetRetailCache()
  assert.equal(retailStatus(paths).mode, 'trial')
})

test('a manifest without a mode (older worker) counts as retail and replaces the trials', async () => {
  const paths = setup()
  const trialFile = await syncTrialFont(paths)
  await configureRetailSync(paths, { token: 'retail-token' })
  const status = await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  assert.equal(status.mode, 'retail')
  assert.equal(fs.existsSync(trialFile), false)
})

test('a check answered for a token the user has since replaced changes nothing', async () => {
  const paths = setup()
  const trialFile = await syncTrialFont(paths)
  await configureRetailSync(paths, { token: 'retail-token' })
  const status = await checkRetail(paths, {
    fetchManifest: async () => {
      // The user removes the token again while the retail answer is on its way.
      await configureRetailSync(paths, { token: '' })
      return { ...manifestWith(4, 'e1'), mode: 'retail' as const }
    },
  })
  assert.equal(status.mode, 'trial')
  assert.equal(fs.existsSync(trialFile), true)
  assert.deepEqual(
    loadCatalog(paths).entries.map((entry) => entry.retailRelativePath),
    ['Reckless/Reckless-TRIAL-VF.otf'],
  )
})

test('a sync answered for a token the user has since replaced changes nothing', async () => {
  const paths = setup()
  const trialFile = await syncTrialFont(paths)
  await configureRetailSync(paths, { token: 'retail-token' })
  let downloads = 0
  await syncRetail(paths, {
    fetchManifest: async () => {
      await configureRetailSync(paths, { token: '' })
      return { ...manifestWith(4, 'e1'), mode: 'retail' as const }
    },
    fetchFile: async () => {
      downloads += 1
      return new Uint8Array(4).fill(2)
    },
  })
  assert.equal(downloads, 0)
  assert.equal(fs.existsSync(trialFile), true)
  assert.equal(loadRetailManifest(paths).mode, 'trial')
})

test('a check that switches collections stops a running sync of the old one first', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true })
  const started = deferred()
  const running = syncRetail(paths, {
    fetchManifest: async () => trialManifest(),
    // Hangs until aborted, like a slow download.
    fetchFile: (options) =>
      new Promise<Uint8Array>((_, reject) => {
        started.resolve()
        options.signal?.addEventListener('abort', () => reject(new Error('canceled')), { once: true })
      }),
  })
  await started.promise
  // Written directly rather than through configureRetailSync, which would abort the sync itself —
  // this is the case where only the check can stop it.
  fs.writeFileSync(retailTokenPath(paths), 'retail-token')
  const status = await checkRetail(paths, {
    fetchManifest: async () => ({ ...manifestWith(4, 'e1'), mode: 'retail' as const }),
  })
  await running
  assert.equal(status.mode, 'retail')
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'Reckless-TRIAL-VF.otf')), false)
  assert.deepEqual(
    loadCatalog(paths).entries.map((entry) => entry.retailRelativePath),
    ['Reckless/RecklessVF.otf'],
  )
})

test('an unreadable token file is an error, not a silent switch to the trial collection', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 'retail-token' })
  await syncRetail(paths, {
    fetchManifest: async () => ({ ...manifestWith(4, 'e1'), mode: 'retail' as const }),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  // Something that exists but cannot be read as the token.
  fs.rmSync(retailTokenPath(paths), { force: true })
  fs.mkdirSync(retailTokenPath(paths))
  let fetched = 0
  const status = await checkRetail(paths, {
    fetchManifest: async () => {
      fetched += 1
      return trialManifest()
    },
  })
  assert.equal(fetched, 0)
  assert.match(status.error ?? '', /token/i)
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), true)
})

test('with no sync record, file-less listings the new collection does not name are dropped', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 'retail-token' })
  // A check-only run on a build that did not stamp the mode: listings, no files, no mode.
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  saveRetailManifest(paths, { version: 1, syncedAt: null, files: {} })
  await configureRetailSync(paths, { token: '' })
  const status = await checkRetail(paths, { fetchManifest: async () => trialManifest() })
  assert.equal(status.mode, 'trial')
  assert.deepEqual(
    loadCatalog(paths).entries.map((entry) => entry.retailRelativePath),
    ['Reckless/Reckless-TRIAL-VF.otf'],
  )
})

test('a failed check with a new token leaves the previous collection alone', async () => {
  const paths = setup()
  const trialFile = await syncTrialFont(paths)
  await configureRetailSync(paths, { token: 'wrong' })
  const status = await checkRetail(paths, {
    fetchManifest: async () => {
      throw new Error('The Displaay worker rejected that token.')
    },
  })
  assert.match(status.error ?? '', /rejected/)
  assert.equal(status.mode, 'trial')
  assert.equal(fs.existsSync(trialFile), true)
})

test('a credentials-only check validates the worker without writing listings', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  const status = await checkRetail(paths, {
    credentialsOnly: true,
    fetchManifest: async () => manifestWith(4, 'e1'),
  })
  assert.equal(status.error, null)
  assert.equal(status.hasToken, true)
  assert.equal(status.pending, 0)
  assert.equal(loadCatalog(paths).entries.length, 0)
  assert.equal(Object.keys(loadRetailManifest(paths).files).length, 0)
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), false)
})

test('a credentials-only check fetches the remote manifest to validate the token', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  let fetched = 0
  const status = await checkRetail(paths, {
    credentialsOnly: true,
    fetchManifest: async () => {
      fetched += 1
      return manifestWith(4, 'e1')
    },
  })
  assert.equal(fetched, 1)
  assert.equal(status.error, null)
  assert.equal(status.hasToken, true)
  assert.equal(status.pending, 0)
  assert.equal(loadCatalog(paths).entries.length, 0)
  assert.equal(Object.keys(loadRetailManifest(paths).files).length, 0)
})

test('a credentials-only check still reports a worker error without writing listings', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  const status = await checkRetail(paths, {
    credentialsOnly: true,
    fetchManifest: async () => {
      throw new Error('bad token')
    },
  })
  assert.match(status.error ?? '', /bad token/)
  assert.equal(loadCatalog(paths).entries.length, 0)
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), false)
})

test('turning retail on after setup lists the collection without downloading', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    await service.updateSettings({ onboardingCompleted: true })
    let downloads = 0
    service.retailFetch = {
      fetchManifest: async () => manifestWith(4, 'e1'),
      fetchFile: async () => {
        downloads += 1
        return new Uint8Array(4).fill(1)
      },
    }
    const status = await service.configureRetailSync({ enabled: true, token: 't' })
    assert.equal(status.error, null)
    assert.equal(status.pending, 1)
    assert.equal(downloads, 0)
    assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), false)
    assert.ok(
      loadCatalog(paths).entries.some((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf'),
    )
  })
})

test('retail stays check-only during onboarding and does not download after setup', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    assert.equal(service.getSettings().onboardingCompleted, false)
    await service.configureRetailSync({ enabled: true, token: 't' })
    service.retailFetch = {
      fetchManifest: async () => manifestWith(4, 'e1'),
      fetchFile: async () => new Uint8Array(4).fill(1),
    }

    const checked = await service.checkRetail()
    assert.equal(checked.error, null)
    assert.equal(loadCatalog(paths).entries.length, 0)
    assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), false)

    const skipped = await service.syncRetail()
    assert.equal(skipped.error, null)
    assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), false)

    await service.updateSettings({ onboardingCompleted: true })
    assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), false)
    assert.ok(loadCatalog(paths).entries.some((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf'))
  })
})

test('a check reports pending files, and a sync writes them into Fonts', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })

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
  await configureRetailSync(paths, { enabled: true, token: 't' })

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
  await configureRetailSync(paths, { enabled: true, token: 't' })
  const status = await checkRetail(paths, {
    fetchManifest: async () => {
      throw new Error('worker is down')
    },
  })
  assert.match(status.error ?? '', /worker is down/)
})

test('replacing the token discards drift measured with the old one', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })

  const rotated = await configureRetailSync(paths, { token: 'new-token' })
  assert.equal(rotated.pending, 0)
  assert.equal(rotated.checkedAt, null)
})

test('toggling enabled alone keeps the existing drift', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })

  const toggled = await configureRetailSync(paths, { enabled: false })
  assert.equal(toggled.pending, 1)
})

test('the on/off switch actually gates checking and syncing', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: false, token: 't' })

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
  await configureRetailSync(paths, { enabled: true, token: 't' })

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

test('skipped families are not reported as up to date', async () => {
  const paths = setup()
  configureRetailSync(paths, { enabled: true, token: 't' })
  const status = await checkRetail(paths, {
    fetchManifest: async () => ({
      generatedAt: '2026-01-01T00:00:00.000Z',
      collections: [],
      skipped: [
        { glyphsFile: 'Reckless', reason: 'incomplete' },
        { glyphsFile: 'Vinila', reason: 'incomplete' },
      ],
    }),
  })
  assert.equal(status.pending, 0)
  assert.equal(status.skipped.length, 2)
  assert.equal(retailDriftSummary(status), '2 families are not available on the worker.')
})

test('overlapping syncs share one run instead of fighting over the same files', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })

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

test('disabling every family aborts an in-flight sync', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  let downloads = 0
  const files = Array.from({ length: RETAIL_DOWNLOAD_CONCURRENCY + 1 }, (_, index) => ({
    basename: `File${index}.otf`,
    size: 4,
    etag: `e${index}`,
  }))
  const syncing = syncRetail(paths, {
    fetchManifest: async () => manifestWithFiles(files),
    fetchFile: async () => {
      downloads += 1
      await new Promise((resolve) => setTimeout(resolve, 40))
      return new Uint8Array(4).fill(1)
    },
  })
  while (downloads === 0) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  const stopped = await configureRetailSync(paths, { disabledGlyphsFiles: ['Reckless'] })
  assert.equal(stopped.fonts.every((font) => !font.enabled), true)
  await syncing
  assert.ok(downloads <= RETAIL_DOWNLOAD_CONCURRENCY)
})

test('retail status reports family progress while a sync is running', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  const seen: Array<{ done: number; total: number } | null> = []
  const synced = await syncRetail(paths, {
    fetchManifest: async () =>
      manifestWithFiles([
        { basename: 'A.otf', size: 4, etag: 'ea' },
        { basename: 'B.otf', size: 4, etag: 'eb' },
      ]),
    fetchFile: async () => {
      seen.push(retailStatus(paths).progress)
      return new Uint8Array(4).fill(1)
    },
  })
  assert.equal(synced.error, null)
  assert.equal(synced.progress, null)
  assert.ok(seen.some((item) => item && item.total === 1 && item.done === 0))
})

test('turning sync off clears an interrupted download marker', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  saveRetailManifest(paths, {
    version: 1,
    syncedAt: null,
    files: {},
    incomplete: true,
  })
  assert.equal(retailSyncNeedsResume(paths), true)
  await configureRetailSync(paths, { enabled: false })
  assert.equal(loadRetailManifest(paths).incomplete, false)
  assert.equal(retailSyncNeedsResume(paths), false)
})

test('init resumes an interrupted retail download', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    await service.updateSettings({ onboardingCompleted: true })
    const fileA = path.join(paths.dataRoot, 'A.otf')
    const fileB = path.join(paths.dataRoot, 'B.otf')
    writeTestFont(fileA, 'Reckless', 'Reckless-A', { format: 'otf' })
    writeTestFont(fileB, 'Reckless', 'Reckless-B', { format: 'otf', style: 'Bold', weight: 700 })
    const bytesA = fs.readFileSync(fileA)
    const bytesB = fs.readFileSync(fileB)
    const remote = manifestWithFiles([
      { basename: 'A.otf', size: bytesA.length, etag: 'ea' },
      { basename: 'B.otf', size: bytesB.length, etag: 'eb' },
    ])
    await configureRetailSync(paths, { enabled: true, token: 't' })
    await checkRetail(paths, { fetchManifest: async () => remote })
    saveRetailManifest(paths, { version: 1, syncedAt: null, files: {}, incomplete: true })
    resetRetailCache()

    const downloaded: string[] = []
    service.retailFetch = {
      fetchManifest: async () => remote,
      fetchFile: async ({ key }) => {
        downloaded.push(key)
        return key.endsWith('A.otf') ? new Uint8Array(bytesA) : new Uint8Array(bytesB)
      },
    }
    await service.init()
    const status = await service.syncRetail()
    assert.equal(status.error, null)
    assert.equal(status.incomplete, false)
    assert.equal(downloaded.length, 2)
    assert.equal(fs.readFileSync(path.join(paths.userFontsDir, 'A.otf')).length, bytesA.length)
    assert.equal(fs.readFileSync(path.join(paths.userFontsDir, 'B.otf')).length, bytesB.length)
    assert.equal(loadRetailManifest(paths).incomplete, false)
  })
})

test('leftover listings without an incomplete flag wait for an explicit sync', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    await service.updateSettings({ onboardingCompleted: true })
    const fileA = path.join(paths.dataRoot, 'A.otf')
    const fileB = path.join(paths.dataRoot, 'B.otf')
    writeTestFont(fileA, 'Reckless', 'Reckless-A', { format: 'otf' })
    writeTestFont(fileB, 'Reckless', 'Reckless-B', { format: 'otf', style: 'Bold', weight: 700 })
    const bytesA = fs.readFileSync(fileA)
    const bytesB = fs.readFileSync(fileB)
    const remote = manifestWithFiles([
      { basename: 'A.otf', size: bytesA.length, etag: 'ea' },
      { basename: 'B.otf', size: bytesB.length, etag: 'eb' },
    ])
    await configureRetailSync(paths, { enabled: true, token: 't' })
    await checkRetail(paths, { fetchManifest: async () => remote })
    fs.copyFileSync(fileA, path.join(paths.userFontsDir, 'A.otf'))
    saveRetailManifest(paths, {
      version: 1,
      syncedAt: '2026-01-01T00:00:00.000Z',
      files: {
        'Reckless/A.otf': {
          key: 'Reckless/rev-1/A.otf',
          relativePath: 'Reckless/A.otf',
          size: bytesA.length,
          etag: 'ea',
          glyphsFile: 'Reckless',
          revisionId: 'rev-1',
          syncedAt: '2026-01-01T00:00:00.000Z',
          installedPath: path.join(paths.userFontsDir, 'A.otf'),
        },
      },
    })
    resetRetailCache()
    assert.equal(retailSyncNeedsResume(paths), false)
    assert.equal(retailStatus(paths).incomplete, false)

    let downloads = 0
    service.retailFetch = {
      fetchManifest: async () => remote,
      fetchFile: async ({ key }) => {
        downloads += 1
        assert.equal(key.endsWith('B.otf'), true)
        return new Uint8Array(bytesB)
      },
    }
    await service.init()
    assert.equal(downloads, 0)

    const status = await service.syncRetail()
    assert.equal(status.error, null)
    assert.equal(status.incomplete, false)
    assert.equal(downloads, 1)
    assert.equal(fs.readFileSync(path.join(paths.userFontsDir, 'B.otf')).length, bytesB.length)
  })
})

test('a finished sync does not resume leftover conflict listings', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  const fixture = path.join(paths.dataRoot, 'X.otf')
  writeTestFont(fixture, 'Reckless', 'Reckless-X', { format: 'otf' })
  const bytes = fs.readFileSync(fixture)
  const remote: RetailManifest = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    collections: [
      {
        glyphsFile: 'Reckless',
        revisionId: 'rev-1',
        lastRegeneratedAt: '2026-01-01T00:00:00.000Z',
        files: [
          {
            key: 'Reckless/rev-1/X.otf',
            relativePath: 'Reckless/X.otf',
            size: bytes.length,
            etag: 'e1',
            uploaded: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      {
        glyphsFile: 'Vinila',
        revisionId: 'rev-1',
        lastRegeneratedAt: '2026-01-01T00:00:00.000Z',
        files: [
          {
            key: 'Vinila/rev-1/X.otf',
            relativePath: 'Vinila/X.otf',
            size: bytes.length,
            etag: 'e2',
            uploaded: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ],
    skipped: [],
  }
  await syncRetail(paths, {
    fetchManifest: async () => remote,
    fetchFile: async () => new Uint8Array(bytes),
  })
  assert.ok(
    loadCatalog(paths).entries.some(
      (entry) => entry.retailRelativePath === 'Vinila/X.otf' && entry.status === 'uninstalled',
    ),
  )
  assert.equal(loadRetailManifest(paths).incomplete, false)
  resetRetailCache()
  assert.equal(retailSyncNeedsResume(paths), false)
})

test('a finished sync does not resume listings that left the worker', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  const fixture = path.join(paths.dataRoot, 'A.otf')
  writeTestFont(fixture, 'Reckless', 'Reckless-A', { format: 'otf' })
  const bytes = fs.readFileSync(fixture)
  await checkRetail(paths, {
    fetchManifest: async () => manifestWithFiles([{ basename: 'A.otf', size: bytes.length, etag: 'ea' }]),
  })
  await syncRetail(paths, {
    fetchManifest: async () => emptyManifest(),
    fetchFile: async () => {
      throw new Error('removed files must not download')
    },
  })
  assert.ok(
    loadCatalog(paths).entries.some(
      (entry) => entry.retailRelativePath === 'Reckless/A.otf' && entry.status === 'uninstalled',
    ),
  )
  assert.equal(loadRetailManifest(paths).incomplete, false)
  resetRetailCache()
  assert.equal(retailSyncNeedsResume(paths), false)
})

test('a finished retail sync does not download again on init', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    await service.updateSettings({ onboardingCompleted: true })
    const fixture = path.join(paths.dataRoot, 'RecklessVF.otf')
    writeTestFont(fixture, 'Reckless', 'RecklessVF', { format: 'otf' })
    const bytes = fs.readFileSync(fixture)
    const remote = manifestWith(bytes.length, 'e1')
    await configureRetailSync(paths, { enabled: true, token: 't' })
    await syncRetail(paths, {
      fetchManifest: async () => remote,
      fetchFile: async () => new Uint8Array(bytes),
    })
    assert.equal(retailSyncNeedsResume(paths), false)
    resetRetailCache()

    let downloads = 0
    service.retailFetch = {
      fetchManifest: async () => remote,
      fetchFile: async () => {
        downloads += 1
        return new Uint8Array(bytes)
      },
    }
    await service.init()
    assert.equal(downloads, 0)
    assert.equal(retailSyncNeedsResume(paths), false)
  })
})

test('the autocheck interval round-trips and rejects nonsense', async () => {
  const paths = setup()

  assert.equal((await configureRetailSync(paths, {})).autoCheckMinutes, 60)
  assert.equal((await configureRetailSync(paths, { autoCheckMinutes: 15 })).autoCheckMinutes, 15)
  assert.equal((await configureRetailSync(paths, { autoCheckMinutes: 0 })).autoCheckMinutes, 0)
  assert.equal((await configureRetailSync(paths, { autoCheckMinutes: 0.2 })).autoCheckMinutes, 1)
  assert.equal((await configureRetailSync(paths, { autoCheckMinutes: -5 })).autoCheckMinutes, 60)
  assert.equal(
    (await configureRetailSync(paths, { autoCheckMinutes: Number.NaN })).autoCheckMinutes,
    60,
  )

  await configureRetailSync(paths, { autoCheckMinutes: 360 })
  assert.equal(loadSettings(paths).retailSync?.autoCheckMinutes, 360)
})

test('changing the interval alone does not discard measured drift', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })

  const changed = await configureRetailSync(paths, { autoCheckMinutes: 60 })
  assert.equal(changed.pending, 1)
  assert.equal(changed.autoCheckMinutes, 60)
})

test('an occupied Fonts file still lists the retail font as not installed', async () => {
  const paths = setup()
  fs.writeFileSync(path.join(paths.userFontsDir, 'RecklessVF.otf'), 'mine')
  await configureRetailSync(paths, { enabled: true, token: 't' })
  const status = await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  assert.equal(status.drift[0].kind, 'added')
  const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf')
  assert.ok(listing)
  assert.equal(listing.status, 'uninstalled')
  assert.equal(fs.readFileSync(path.join(paths.userFontsDir, 'RecklessVF.otf'), 'utf8'), 'mine')
})

test('dummy bytes land in Fonts without crashing catalog import', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
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
  await configureRetailSync(paths, { enabled: true, token: 't' })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf')
  assert.ok(listing)
  assert.equal(listing.status, 'uninstalled')
})

test('a check does not catalog families the user turned off', async () => {
  const paths = setup()
  await configureRetailSync(paths, {
    enabled: true,
    token: 't',
    disabledGlyphsFiles: ['Reckless'],
  })
  const status = await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  assert.equal(status.fonts[0]?.enabled, false)
  assert.equal(
    loadCatalog(paths).entries.some((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf'),
    false,
  )
})

test('a check lists loaded families so each can be toggled', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
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

  const disabled = await configureRetailSync(paths, { disabledGlyphsFiles: ['Zangezi'] })
  assert.equal(disabled.pending, 1)
  assert.equal(disabled.fonts.find((font) => font.glyphsFile === 'Zangezi')?.enabled, false)
  assert.equal(disabled.fonts.find((font) => font.glyphsFile === 'Reckless')?.enabled, true)
  assert.deepEqual(loadSettings(paths).retailSync?.disabledGlyphsFiles, ['Zangezi'])
})

test('sync skips families the user turned off', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't', disabledGlyphsFiles: ['Zangezi'] })
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
  await configureRetailSync(paths, { enabled: true, token: 't' })
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
  await configureRetailSync(paths, { enabled: true, token: 't' })
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
    await configureRetailSync(paths, { enabled: true, token: 't' })
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
    await configureRetailSync(paths, { enabled: true, token: 't' })
    await checkRetail(paths, { fetchManifest: async () => manifestWith(bytes.length, 'e2') })
    const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf')
    assert.ok(listing)
    assert.equal(listing.status, 'uninstalled')

    await syncRetail(paths, {
      fetchManifest: async () => manifestWith(bytes.length, 'e2'),
      fetchFile: async () => new Uint8Array(bytes),
    })
    assert.equal(fs.readFileSync(dest).equals(bytes), false, 'sync must not overwrite the occupied Fonts file')
    assert.equal(retailStatus(paths).collisions.length, 0, 'a different family occupying Fonts is not a retail collision')

    const installed = await service.install(listing.id)
    assert.equal(installed.status, 'installed')
    assert.equal(installed.retailRelativePath, 'Reckless/RecklessVF.otf')
    assert.equal(fs.readFileSync(dest).equals(bytes), true)
    const leftover = loadCatalog(paths).entries.find((entry) => entry.id === imported.entries[0]?.id)
    assert.notEqual(leftover?.status, 'installed')
    assert.notEqual(leftover?.installedPath, dest)
  })
})

test('an Adobe-only install of a cached retail listing leaves the Fonts occupant in place', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const dest = path.join(paths.userFontsDir, 'RecklessVF.otf')
    writeTestFont(dest, 'LocalReckless', 'LocalRecklessVF', { format: 'otf', version: 'Version 1.000' })
    const imported = await service.importPaths([dest])
    assert.equal(imported.entries[0]?.status, 'installed')
    const occupantId = imported.entries[0]!.id
    const occupantBytes = fs.readFileSync(dest)

    await service.updateSettings({ defaultDestination: 'adobe-shared' })

    const incoming = path.join(paths.dataRoot, 'incoming.otf')
    writeTestFont(incoming, 'Reckless', 'RecklessVF', { format: 'otf', version: 'Version 2.000' })
    const bytes = fs.readFileSync(incoming)
    await configureRetailSync(paths, { enabled: true, token: 't' })
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
    assert.ok(installed.installations?.some((copy) => copy.destinationId === 'adobe-shared'))
    assert.equal(
      installed.installations?.some((copy) => copy.destinationId === 'macos'),
      false,
    )
    assert.equal(fs.readFileSync(dest).equals(occupantBytes), true)
    const occupant = loadCatalog(paths).entries.find((entry) => entry.id === occupantId)
    assert.ok(occupant)
    assert.equal(occupant.status, 'installed')
    assert.equal(occupant.installedPath, dest)
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
    await configureRetailSync(paths, { enabled: true, token: 't' })
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

test('an uninstall during the same retail batch is not overwritten by stale catalog writes', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const size = 4
    const files = [
      { basename: 'Face0.otf', size, etag: 'e-0' },
      { basename: 'Face1.otf', size, etag: 'e-1' },
    ]
    const firstRelative = `Reckless/${files[0]!.basename}`
    const secondKey = `Reckless/rev-1/${files[1]!.basename}`
    await configureRetailSync(paths, { enabled: true, token: 't' })
    await checkRetail(paths, { fetchManifest: async () => manifestWithFiles(files) })
    await syncRetail(paths, {
      fetchManifest: async () => manifestWithFiles(files),
      fetchFile: async () => new Uint8Array(size).fill(1),
    })
    const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === firstRelative)
    assert.ok(listing)
    assert.equal(listing.status, 'installed')

    const dest = path.join(paths.userFontsDir, files[0]!.basename)
    const before = Buffer.from(fs.readFileSync(dest))
    const nextFiles = files.map((file) => ({ ...file, etag: `${file.etag}-next` }))
    await checkRetail(paths, { fetchManifest: async () => manifestWithFiles(nextFiles) })

    const status = await syncRetail(paths, {
      fetchManifest: async () => manifestWithFiles(nextFiles),
      fetchFile: async (options) => {
        if (options.key === secondKey) {
          const deadline = Date.now() + 5000
          while (Date.now() < deadline && fs.readFileSync(dest).equals(before)) {
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          assert.equal(
            fs.readFileSync(dest).equals(before),
            false,
            'first dest write should finish before the second download proceeds',
          )
          const persisted = loadCatalog(paths).entries.find((entry) => entry.id === listing.id)
          assert.equal(persisted?.status, 'installed')
          await service.uninstall(listing.id)
        }
        return new Uint8Array(size).fill(2)
      },
    })
    assert.equal(status.error, null)
    const after = loadCatalog(paths).entries.find((entry) => entry.id === listing.id)
    assert.ok(after)
    assert.equal(after.status, 'uninstalled')
    assert.equal(fs.existsSync(dest), false)
    assert.equal(
      after.installations?.some((copy) => copy.destinationId === 'macos' && copy.verification === 'file-present'),
      false,
    )
  })
})

test('a deactivate during a later retail batch keeps the parked copy', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const size = 4
    const files = Array.from({ length: RETAIL_DOWNLOAD_CONCURRENCY + 1 }, (_, index) => ({
      basename: `Park${index}.otf`,
      size,
      etag: `p-${index}`,
    }))
    const firstRelative = `Reckless/${files[0]!.basename}`
    const lastKey = `Reckless/rev-1/${files.at(-1)!.basename}`
    await configureRetailSync(paths, { enabled: true, token: 't' })
    await checkRetail(paths, { fetchManifest: async () => manifestWithFiles(files) })
    const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === firstRelative)
    assert.ok(listing)

    const status = await syncRetail(paths, {
      fetchManifest: async () => manifestWithFiles(files),
      fetchFile: async (options) => {
        if (options.key === lastKey) {
          const persisted = loadCatalog(paths).entries.find((entry) => entry.id === listing.id)
          assert.equal(persisted?.status, 'installed')
          await service.deactivate(listing.id)
        }
        return new Uint8Array(size).fill(1)
      },
    })
    assert.equal(status.error, null)
    const after = loadCatalog(paths).entries.find((entry) => entry.id === listing.id)
    assert.ok(after)
    assert.equal(after.status, 'deactivated')
    assert.ok(after.disabledPath && fs.existsSync(after.disabledPath))
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
  await configureRetailSync(paths, { enabled: true, token: 't' })

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

test('isRetailFamilyOptedOut matches typeface names only in typeface mode', () => {
  assert.equal(isRetailFamilyOptedOut('Azeret', 'Azeret', ['Azeret'], 'family'), true)
  assert.equal(isRetailFamilyOptedOut('Azeret Mono', 'Azeret', ['Azeret'], 'family'), false)
  assert.equal(isRetailFamilyOptedOut('Azeret VF', 'Azeret', ['Azeret'], 'family'), false)
  assert.equal(isRetailFamilyOptedOut('Azeret Mono', 'Azeret', ['Azeret'], 'typeface'), true)
  assert.equal(isRetailFamilyOptedOut('Azeret VF', 'Azeret', ['Azeret'], 'typeface'), true)
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
  assert.deepEqual(
    filterDisabledRetailDrift(drift, ['Azeret'], { optOutMode: 'typeface' }).map(
      (item) => item.familyName,
    ),
    [],
  )
  assert.deepEqual(
    filterDisabledRetailDrift(drift, ['Azeret'], { optOutMode: 'family' }).map(
      (item) => item.familyName,
    ),
    ['Azeret Mono'],
  )
})

test('a check lists typeface children with format toggles', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
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
  await configureRetailSync(paths, {
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
  resetRetailCache()
  assert.equal(retailSyncNeedsResume(paths), false)
})

test('switching format uninstalls the other format instead of installing both', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't', familyFormats: { Azeret: 'otf' } })
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

  const switched = await configureRetailSync(paths, { familyFormats: { Azeret: 'ttf' } })
  assert.equal(switched.fonts.find((font) => font.familyName === 'Azeret')?.selectedFormat, 'ttf')
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'Azeret-Regular.otf')), false)
  const switchedOut = loadCatalog(paths).entries.find(
    (entry) => entry.retailRelativePath === 'Azeret/Azeret-Regular.otf',
  )
  assert.ok(switchedOut)
  assert.equal(switchedOut.status, 'uninstalled')
  assert.equal(switchedOut.sourceAvailability, 'none')
  assert.equal(
    loadCatalog(paths).entries.some((entry) => entry.status === 'source-missing'),
    false,
  )

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
  await configureRetailSync(paths, { enabled: true, token: 't' })
  await checkRetail(paths, { fetchManifest: async () => azeretManifest() })
  resetRetailCache()
  const status = retailStatus(paths)
  assert.deepEqual(
    status.fonts.map((font) => font.familyName),
    ['Azeret', 'Azeret Mono', 'Azeret VF'],
  )
  assert.equal(status.fonts.find((font) => font.familyName === 'Azeret')?.typefaceName, 'Azeret')
})

test('a saved typeface opt-out still covers every child family', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  const settings = loadSettings(paths)
  settings.retailSync = {
    ...settings.retailSync!,
    disabledGlyphsFiles: ['Azeret'],
    familyOptOuts: false,
  }
  saveSettings(paths, settings)

  const status = await checkRetail(paths, { fetchManifest: async () => azeretManifest() })
  assert.deepEqual(
    status.fonts.map((font) => ({ familyName: font.familyName, enabled: font.enabled })),
    [
      { familyName: 'Azeret', enabled: false },
      { familyName: 'Azeret Mono', enabled: false },
      { familyName: 'Azeret VF', enabled: false },
    ],
  )
  assert.equal(status.pending, 0)

  const keys: string[] = []
  await syncRetail(paths, {
    fetchManifest: async () => azeretManifest(),
    fetchFile: async ({ key }) => {
      keys.push(key)
      return new Uint8Array(4).fill(1)
    },
  })
  assert.deepEqual(keys, [])
})

test('family-level opt-outs leave other children of the same typeface enabled', async () => {
  const paths = setup()
  await configureRetailSync(paths, {
    enabled: true,
    token: 't',
    disabledGlyphsFiles: ['Azeret'],
  })
  assert.equal(loadSettings(paths).retailSync?.familyOptOuts, true)
  const status = await checkRetail(paths, { fetchManifest: async () => azeretManifest() })
  assert.deepEqual(
    status.fonts.map((font) => ({ familyName: font.familyName, enabled: font.enabled })),
    [
      { familyName: 'Azeret', enabled: false },
      { familyName: 'Azeret Mono', enabled: true },
      { familyName: 'Azeret VF', enabled: true },
    ],
  )
})

test('format switch awaits native unregister before deleting the old file', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't', familyFormats: { Azeret: 'otf' } })
  await syncRetail(paths, {
    fetchManifest: async () => azeretManifest(),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  const otf = path.join(paths.userFontsDir, 'Azeret-Regular.otf')
  assert.equal(fs.existsSync(otf), true)

  const unregisterStarted = deferred()
  const unregisterGate = deferred()
  setFontNative(
    noopFontNative({
      async unregisterFont() {
        unregisterStarted.resolve()
        await unregisterGate.promise
        return { ok: true, native: true }
      },
    }),
  )

  const switched = configureRetailSync(paths, { familyFormats: { Azeret: 'ttf' } })
  await unregisterStarted.promise
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fs.existsSync(otf), true, 'must not delete until Core Text unregister finishes')
  unregisterGate.resolve()
  await switched
  assert.equal(fs.existsSync(otf), false)
})

test('format cleanup waits for in-flight catalog writes', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't', familyFormats: { Azeret: 'otf' } })
  await syncRetail(paths, {
    fetchManifest: async () => azeretManifest(),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  const otf = path.join(paths.userFontsDir, 'Azeret-Regular.otf')
  const snapshot = JSON.parse(JSON.stringify(loadCatalog(paths)))
  const gate = deferred()
  let holding = false
  const inFlight = runCatalogTask(async () => {
    holding = true
    await gate.promise
    saveCatalog(paths, snapshot)
  })
  while (!holding) {
    await new Promise((resolve) => setImmediate(resolve))
  }

  const switched = configureRetailSync(paths, { familyFormats: { Azeret: 'ttf' } })
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(fs.existsSync(otf), true, 'cleanup must not run while a catalog write is in flight')
  gate.resolve()
  await inFlight
  await switched
  assert.equal(fs.existsSync(otf), false)
  const entry = loadCatalog(paths).entries.find(
    (item) => item.retailRelativePath === 'Azeret/Azeret-Regular.otf',
  )
  assert.ok(entry)
  assert.equal(entry.status, 'uninstalled')
  assert.equal(entry.sourceAvailability, 'none')
})

function emptyOwned() {
  return { ownedPaths: new Set<string>(), cacheRoot: path.resolve(os.tmpdir(), 'font-butler-no-retail-cache') }
}

function stubEntry(patch: Partial<import('./types.ts').CatalogEntry>): import('./types.ts').CatalogEntry {
  return {
    id: 'x',
    sourcePath: '/tmp/Reckless-Regular.otf',
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'installed',
    faces: [
      {
        familyName: 'Reckless',
        styleName: 'Regular',
        fullName: 'Reckless Regular',
        postscriptName: 'Reckless-Regular',
        isVariable: false,
        instanceCount: 1,
        instanceNames: [],
        weight: 400,
        italic: false,
      },
    ],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
    installedPath: '/tmp/Fonts/Reckless-Regular.otf',
    ...patch,
  }
}

test('familyName alone does not make a catalog entry retail-owned', () => {
  const outside = stubEntry({})
  assert.equal(isRetailOwnedInstall(outside, emptyOwned()), false)
  assert.equal(
    isRetailOwnedInstall(stubEntry({ retailRelativePath: 'Reckless/Reckless-Regular.otf' }), emptyOwned()),
    true,
  )
  assert.deepEqual(catalogEntryFamilyNames(outside), ['Reckless'])
})

test('outside Reckless collides with pending retail Reckless, not a LocalReckless occupant', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-collision-'))
  const outsidePath = path.join(dir, 'Reckless-Regular.otf')
  const localPath = path.join(dir, 'RecklessVF.otf')
  fs.writeFileSync(outsidePath, 'x')
  fs.writeFileSync(localPath, 'x')
  try {
    const outside = stubEntry({
      id: 'out',
      installedPath: outsidePath,
    })
    const local = stubEntry({
      id: 'local',
      installedPath: localPath,
      faces: [
        {
          familyName: 'LocalReckless',
          styleName: 'Regular',
          fullName: 'LocalReckless Regular',
          postscriptName: 'LocalRecklessVF',
          isVariable: false,
          instanceCount: 1,
          instanceNames: [],
          weight: 400,
          italic: false,
        },
      ],
    })
    const collisions = findOutsideCollisionsForRetailFamilies(
      [outside, local],
      [{ familyName: 'Reckless', typefaceName: 'Reckless' }],
      emptyOwned(),
    )
    assert.equal(collisions.length, 1)
    assert.equal(collisions[0]?.familyName, 'Reckless')
    assert.deepEqual(collisions[0]?.entryIds, ['out'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('incoming drop replacements must still exist and still belong to that family', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-drop-valid-'))
  const file = path.join(dir, 'Reckless-Regular.otf')
  writeTestFont(file, 'Reckless', 'Reckless-Regular', { format: 'otf' })
  try {
    assert.equal(incomingPathStillMatchesFamily(file, 'Reckless'), true)
    assert.equal(incomingPathStillMatchesFamily(file, 'Azeret'), false)
    assert.equal(incomingPathStillMatchesFamily(path.join(dir, 'gone.otf'), 'Reckless'), false)
    assert.equal(
      familyHasValidDropReplacement([{ familyName: 'Reckless', path: file }], 'Reckless'),
      true,
    )
    writeTestFont(file, 'Azeret', 'Azeret-Regular', { format: 'otf' })
    assert.equal(incomingPathStillMatchesFamily(file, 'Reckless'), false)
    assert.equal(
      familyHasValidDropReplacement([{ familyName: 'Reckless', path: file }], 'Reckless'),
      false,
    )
    assert.equal(familyHasValidDropReplacement(['Reckless'], 'Reckless'), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('retail sync pauses when a same-family font is already installed from outside', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const dest = path.join(paths.userFontsDir, 'Reckless-Regular.otf')
    writeTestFont(dest, 'Reckless', 'Reckless-Regular', { format: 'otf' })
    await service.importPaths([dest])
    await configureRetailSync(paths, { enabled: true, token: 't' })

    const paused = await syncRetail(paths, {
      fetchManifest: async () => manifestWith(4, 'e1'),
      fetchFile: async () => new Uint8Array(4).fill(1),
    })
    assert.equal(paused.error, null)
    assert.equal(paused.pending, 1)
    assert.equal(paused.collisions.length, 1)
    assert.equal(paused.collisions[0]?.familyName, 'Reckless')
    assert.match(paused.collisions[0]?.installedLabel ?? '', /Reckless/i)
    assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), false)

    const replaced = await syncRetail(paths, {
      fetchManifest: async () => manifestWith(4, 'e1'),
      fetchFile: async () => new Uint8Array(4).fill(1),
      choices: { Reckless: 'replace' },
    })
    assert.equal(replaced.error, null)
    assert.equal(replaced.collisions.length, 0)
    assert.equal(replaced.pending, 0)
    assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), true)

    const remaining = loadCatalog(paths).entries.filter((entry) => catalogEntryFamilyNames(entry).includes('Reckless'))
    const installed = remaining.filter((entry) => entry.status === 'installed')
    assert.equal(installed.length, 1)
    assert.ok(installed[0]?.retailRelativePath)
    assert.equal(
      remaining.some((entry) => !entry.retailRelativePath && (entry.status === 'installed' || entry.status === 'outdated')),
      false,
    )
  })
})

test('sync replace does not uninstall an outside font when the family left the current manifest', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const dest = path.join(paths.userFontsDir, 'Reckless-Regular.otf')
    writeTestFont(dest, 'Reckless', 'Reckless-Regular', { format: 'otf' })
    await service.importPaths([dest])
    await configureRetailSync(paths, { enabled: true, token: 't' })

    const paused = await syncRetail(paths, {
      fetchManifest: async () => manifestWith(4, 'e1'),
      fetchFile: async () => new Uint8Array(4).fill(1),
    })
    assert.equal(paused.collisions.length, 1)
    assert.equal(paused.collisions[0]?.familyName, 'Reckless')

    const afterGone = await syncRetail(paths, {
      fetchManifest: async () => emptyManifest(),
      fetchFile: async () => new Uint8Array(4).fill(1),
      choices: { Reckless: 'replace' },
    })
    assert.equal(afterGone.error, null)
    assert.equal(fs.existsSync(dest), true)
    const remaining = loadCatalog(paths).entries.filter((entry) => catalogEntryFamilyNames(entry).includes('Reckless'))
    const installed = remaining.filter((entry) => entry.status === 'installed' || entry.status === 'outdated')
    assert.equal(installed.length, 1)
    assert.equal(installed[0]?.retailRelativePath ?? '', '')
    assert.equal(afterGone.collisions.some((item) => item.familyName === 'Reckless'), false)
  })
})

test('retail sync keep-old opts the family out of sync without downloading', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const dest = path.join(paths.userFontsDir, 'Reckless-Regular.otf')
    writeTestFont(dest, 'Reckless', 'Reckless-Regular', { format: 'otf' })
    await service.importPaths([dest])
    await configureRetailSync(paths, { enabled: true, token: 't' })

    const kept = await syncRetail(paths, {
      fetchManifest: async () => manifestWith(4, 'e1'),
      fetchFile: async () => new Uint8Array(4).fill(1),
      choices: { Reckless: 'keep' },
    })
    assert.equal(kept.error, null)
    assert.equal(kept.pending, 0)
    assert.equal(kept.collisions.length, 0)
    assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), false)
    assert.deepEqual(loadSettings(paths).retailSync?.disabledGlyphsFiles, ['Reckless'])
    assert.equal(loadSettings(paths).retailSync?.familyOptOuts, true)

    const remaining = loadCatalog(paths).entries.filter((entry) => catalogEntryFamilyNames(entry).includes('Reckless'))
    const installed = remaining.filter((entry) => entry.status === 'installed')
    assert.equal(installed.length, 1)
    assert.equal(installed[0]?.retailRelativePath ?? '', '')
  })
})

test('already-synced retail fonts do not collide with themselves on the next sync', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  const first = await syncRetail(paths, {
    fetchManifest: async () => manifestWith(4, 'e1'),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  assert.equal(first.error, null)
  assert.equal(first.pending, 0)
  assert.equal(first.collisions.length, 0)
  assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'RecklessVF.otf')), true)

  const second = await syncRetail(paths, {
    fetchManifest: async () => manifestWith(4, 'e1'),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  assert.equal(second.error, null)
  assert.equal(second.pending, 0)
  assert.equal(second.collisions.length, 0)
})

test('retail sync apply-all replace resolves every outside family collision', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const azeret = path.join(paths.userFontsDir, 'Azeret-Regular.otf')
    const mono = path.join(paths.userFontsDir, 'AzeretMono-Regular.otf')
    writeTestFont(azeret, 'Azeret', 'Azeret-Regular', { format: 'otf' })
    writeTestFont(mono, 'Azeret Mono', 'AzeretMono-Regular', { format: 'otf' })
    await service.importPaths([azeret, mono])
    await configureRetailSync(paths, { enabled: true, token: 't' })

    const paused = await syncRetail(paths, {
      fetchManifest: async () => azeretManifest(),
      fetchFile: async () => new Uint8Array(4).fill(1),
    })
    assert.equal(paused.collisions.length, 2)
    assert.deepEqual(paused.collisions.map((item) => item.familyName).sort(), ['Azeret', 'Azeret Mono'])
    assert.notEqual(fs.statSync(path.join(paths.userFontsDir, 'Azeret-Regular.otf')).size, 4)

    const choices: Record<string, 'replace' | 'keep'> = {}
    for (const collision of paused.collisions) choices[collision.familyName] = 'replace'
    const resolved = await syncRetail(paths, {
      fetchManifest: async () => azeretManifest(),
      fetchFile: async () => new Uint8Array(4).fill(1),
      choices,
    })
    assert.equal(resolved.error, null)
    assert.equal(resolved.collisions.length, 0)
    assert.equal(resolved.pending, 0)
    assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'Azeret-Regular.otf')), true)
    assert.equal(fs.existsSync(path.join(paths.userFontsDir, 'AzeretMono-Regular.otf')), true)
  })
})

test('dropping a same-family font over an installed retail copy uninstalls retail after replace', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const fixture = path.join(paths.dataRoot, 'fixture.otf')
    writeTestFont(fixture, 'Reckless', 'RecklessVF', { format: 'otf' })
    const bytes = fs.readFileSync(fixture)
    await configureRetailSync(paths, { enabled: true, token: 't' })
    const synced = await syncRetail(paths, {
      fetchManifest: async () => manifestWith(bytes.length, 'e1'),
      fetchFile: async () => new Uint8Array(bytes),
    })
    assert.equal(synced.pending, 0)
    assert.ok(loadCatalog(paths).entries.some((entry) => entry.retailRelativePath && entry.status === 'installed'))

    const dropped = path.join(paths.dataRoot, 'drop', 'Reckless-Regular.otf')
    writeTestFont(dropped, 'Reckless', 'Reckless-Regular', { format: 'otf', version: 'Version 2.000' })
    const planned = await service.planImport([dropped])
    assert.equal(planned.retailCollisions?.length, 1)
    assert.equal(planned.retailCollisions?.[0]?.familyName, 'Reckless')
    const incoming = findRetailCollisionsForIncomingFamilies(
      loadCatalog(paths).entries,
      [{ familyName: 'Reckless', path: dropped }],
      { ownedPaths: new Set(), cacheRoot: path.resolve(os.tmpdir(), 'font-butler-no-retail-cache') },
    )
    assert.equal(incoming.length, 1)

    await resolveDropRetailCollisions(paths, { Reckless: 'replace' }, { planId: planned.id })
    assert.deepEqual(loadSettings(paths).retailSync?.disabledGlyphsFiles, ['Reckless'])
    assert.equal(loadSettings(paths).retailSync?.familyOptOuts, true)

    const remaining = loadCatalog(paths).entries.filter((entry) => catalogEntryFamilyNames(entry).includes('Reckless'))
    assert.ok(remaining.every((entry) => entry.status !== 'installed' && entry.status !== 'outdated'))

    const plannedAgain = await service.planImport([dropped])
    assert.equal(plannedAgain.retailCollisions?.length ?? 0, 0)
    const applied = await service.applyPlan(plannedAgain.id)
    assert.equal(applied.entries.length, 1)
    assert.equal(applied.entries[0]?.status, 'installed')
    assert.equal(applied.entries[0]?.retailRelativePath ?? '', '')
  })
})

test('drop replace does not uninstall retail when the dropped file is gone', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const fixture = path.join(paths.dataRoot, 'fixture.otf')
    writeTestFont(fixture, 'Reckless', 'RecklessVF', { format: 'otf' })
    const bytes = fs.readFileSync(fixture)
    await configureRetailSync(paths, { enabled: true, token: 't' })
    await syncRetail(paths, {
      fetchManifest: async () => manifestWith(bytes.length, 'e1'),
      fetchFile: async () => new Uint8Array(bytes),
    })
    const retail = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath)
    assert.equal(retail?.status, 'installed')

    const dropped = path.join(paths.dataRoot, 'drop', 'Reckless-Regular.otf')
    writeTestFont(dropped, 'Reckless', 'Reckless-Regular', { format: 'otf', version: 'Version 2.000' })
    const planned = await service.planImport([dropped])
    assert.equal(planned.retailCollisions?.length, 1)
    fs.rmSync(dropped)

    await resolveDropRetailCollisions(paths, { Reckless: 'replace' }, { planId: planned.id })
    const after = loadCatalog(paths).entries.find((entry) => entry.id === retail?.id)
    assert.equal(after?.status, 'installed')
    assert.ok(after?.retailRelativePath)
    assert.equal(loadSettings(paths).retailSync?.disabledGlyphsFiles.includes('Reckless'), false)
  })
})

test('drop replace does not uninstall retail when the dropped file is no longer that family', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const fixture = path.join(paths.dataRoot, 'fixture.otf')
    writeTestFont(fixture, 'Reckless', 'RecklessVF', { format: 'otf' })
    const bytes = fs.readFileSync(fixture)
    await configureRetailSync(paths, { enabled: true, token: 't' })
    await syncRetail(paths, {
      fetchManifest: async () => manifestWith(bytes.length, 'e1'),
      fetchFile: async () => new Uint8Array(bytes),
    })
    const retail = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath)
    assert.equal(retail?.status, 'installed')

    const dropped = path.join(paths.dataRoot, 'drop', 'Reckless-Regular.otf')
    writeTestFont(dropped, 'Reckless', 'Reckless-Regular', { format: 'otf', version: 'Version 2.000' })
    const planned = await service.planImport([dropped])
    writeTestFont(dropped, 'Azeret', 'Azeret-Regular', { format: 'otf', version: 'Version 3.000' })

    await resolveDropRetailCollisions(paths, { Reckless: 'replace' }, {
      planId: planned.id,
      incoming: planned.items.map((item) => ({ familyName: item.familyName, path: item.path })),
    })
    const after = loadCatalog(paths).entries.find((entry) => entry.id === retail?.id)
    assert.equal(after?.status, 'installed')
    assert.ok(after?.retailRelativePath)
    assert.equal(loadSettings(paths).retailSync?.disabledGlyphsFiles.includes('Reckless'), false)
  })
})

test('drop replace without planned incoming files leaves retail installed', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const fixture = path.join(paths.dataRoot, 'fixture.otf')
    writeTestFont(fixture, 'Reckless', 'RecklessVF', { format: 'otf' })
    const bytes = fs.readFileSync(fixture)
    await configureRetailSync(paths, { enabled: true, token: 't' })
    await syncRetail(paths, {
      fetchManifest: async () => manifestWith(bytes.length, 'e1'),
      fetchFile: async () => new Uint8Array(bytes),
    })
    const dropped = path.join(paths.dataRoot, 'drop', 'Reckless-Regular.otf')
    writeTestFont(dropped, 'Reckless', 'Reckless-Regular', { format: 'otf' })
    await service.planImport([dropped])

    await resolveDropRetailCollisions(paths, { Reckless: 'replace' })
    const retail = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath)
    assert.equal(retail?.status, 'installed')
    assert.equal(loadSettings(paths).retailSync?.disabledGlyphsFiles.includes('Reckless'), false)
  })
})

test('drop replace into a new project does not watch the dropped folder', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const fixture = path.join(paths.dataRoot, 'fixture.otf')
    writeTestFont(fixture, 'Reckless', 'RecklessVF', { format: 'otf' })
    const bytes = fs.readFileSync(fixture)
    await configureRetailSync(paths, { enabled: true, token: 't' })
    const synced = await syncRetail(paths, {
      fetchManifest: async () => manifestWith(bytes.length, 'e1'),
      fetchFile: async () => new Uint8Array(bytes),
    })
    assert.equal(synced.pending, 0)

    const folder = path.join(paths.dataRoot, 'Incoming')
    const dropped = path.join(folder, 'Reckless-Regular.otf')
    writeTestFont(dropped, 'Reckless', 'Reckless-Regular', { format: 'otf', version: 'Version 2.000' })
    const planned = await service.planImport([folder])
    assert.equal(planned.retailCollisions?.length, 1)
    await resolveDropRetailCollisions(paths, { Reckless: 'replace' }, { planId: planned.id })

    const plannedAgain = await service.planImport([folder])
    assert.equal(plannedAgain.retailCollisions?.length ?? 0, 0)
    const applied = await service.applyPlan(plannedAgain.id)
    assert.equal(applied.entries.length, 1)
    assert.equal(applied.entries[0]?.status, 'installed')
    assert.equal(applied.entries[0]?.retailRelativePath ?? '', '')
    const project = await service.createProject(path.basename(folder), applied.entries.map((item) => item.id))
    assert.equal(project.name, 'Incoming')
    assert.equal(project.members.length, 1)
    assert.equal(project.members[0]?.assetId, applied.entries[0]?.id)
    const settings = service.getSettings()
    assert.deepEqual(settings.watchFolders, [])
    assert.deepEqual(settings.folders, [])
  })
})

test('dropping keep cancels the import and leaves the retail copy installed', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    await configureRetailSync(paths, { enabled: true, token: 't' })
    await syncRetail(paths, {
      fetchManifest: async () => manifestWith(4, 'e1'),
      fetchFile: async () => new Uint8Array(4).fill(1),
    })

    const dropped = path.join(paths.dataRoot, 'drop', 'Reckless-Regular.otf')
    writeTestFont(dropped, 'Reckless', 'Reckless-Regular', { format: 'otf' })
    const planned = await service.planImport([dropped])
    assert.equal(planned.retailCollisions?.length, 1)

    await resolveDropRetailCollisions(paths, { Reckless: 'keep' })
    assert.equal(loadSettings(paths).retailSync?.disabledGlyphsFiles.includes('Reckless'), false)

    const remaining = loadCatalog(paths).entries.filter(
      (entry) => catalogEntryFamilyNames(entry).includes('Reckless') && entry.status === 'installed',
    )
    assert.equal(remaining.length, 1)
    assert.ok(remaining[0]?.retailRelativePath)
    assert.equal(fs.existsSync(dropped), true)
  })
})

test('resolving a drop collision does not clear pending retail-sync collisions', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const dest = path.join(paths.userFontsDir, 'Reckless-Regular.otf')
    writeTestFont(dest, 'Reckless', 'Reckless-Regular', { format: 'otf' })
    await service.importPaths([dest])
    await configureRetailSync(paths, { enabled: true, token: 't' })
    const paused = await syncRetail(paths, {
      fetchManifest: async () => manifestWith(4, 'e1'),
      fetchFile: async () => new Uint8Array(4).fill(1),
    })
    assert.equal(paused.collisions.length, 1)
    assert.equal(paused.collisions[0]?.familyName, 'Reckless')

    const dropped = path.join(paths.dataRoot, 'drop', 'Azeret-Regular.otf')
    writeTestFont(dropped, 'Azeret', 'Azeret-Regular', { format: 'otf' })
    const planned = await service.planImport([dropped])
    const afterDrop = await resolveDropRetailCollisions(
      paths,
      { Azeret: 'replace' },
      { planId: planned.id },
    )
    assert.equal(afterDrop.collisions.length, 1)
    assert.equal(afterDrop.collisions[0]?.familyName, 'Reckless')
    assert.equal(retailStatus(paths).collisions.length, 1)
    assert.equal(retailStatus(paths).collisions[0]?.familyName, 'Reckless')
    assert.equal(fs.existsSync(dest), true)
  })
})

test('turning sync off from a retail listing uses the keep-old opt-out path', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    await configureRetailSync(paths, { enabled: true, token: 't' })
    await syncRetail(paths, {
      fetchManifest: async () => manifestWith(4, 'e1'),
      fetchFile: async () => new Uint8Array(4).fill(1),
    })
    const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath)
    assert.ok(listing)
    assert.equal(listing.status, 'installed')

    const status = service.optOutRetailFamilies(['Reckless'])
    assert.deepEqual(status.disabledGlyphsFiles, ['Reckless'])
    assert.equal(status.fonts.find((font) => font.familyName === 'Reckless')?.enabled, false)
    assert.equal(loadSettings(paths).retailSync?.familyOptOuts, true)

    const after = loadCatalog(paths).entries.find((entry) => entry.id === listing.id)
    assert.equal(after?.status, 'installed')
    assert.ok(after?.retailRelativePath)

    const again = await syncRetail(paths, {
      fetchManifest: async () => manifestWith(6, 'e2'),
      fetchFile: async () => new Uint8Array(6).fill(2),
    })
    assert.equal(again.pending, 0)
    assert.equal(again.collisions.length, 0)
    assert.equal(fs.readFileSync(path.join(paths.userFontsDir, 'RecklessVF.otf')).length, 4)
  })
})

test('a check does not revert an uninstall that queued during reconcile', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const fixture = path.join(paths.dataRoot, 'fixture.otf')
    writeTestFont(fixture, 'Reckless', 'RecklessVF', { format: 'otf' })
    const bytes = fs.readFileSync(fixture)
    const files = Array.from({ length: 8 }, (_, index) => ({
      basename: `Face${index}.otf`,
      size: bytes.length,
      etag: `e-${index}`,
    }))
    configureRetailSync(paths, { enabled: true, token: 't' })
    await syncRetail(paths, {
      fetchManifest: async () => manifestWithFiles(files),
      fetchFile: async () => new Uint8Array(bytes),
    })
    const listing = loadCatalog(paths).entries.find(
      (entry) => entry.retailRelativePath === `Reckless/${files[0]!.basename}`,
    )
    assert.ok(listing)
    assert.equal(listing.status, 'installed')

    let uninstalling: Promise<unknown> | undefined
    await checkRetail(paths, {
      fetchManifest: async () => {
        uninstalling = new Promise((resolve, reject) => {
          setImmediate(() => {
            service.uninstall(listing.id).then(resolve, reject)
          })
        })
        return manifestWithFiles(files)
      },
    })
    assert.ok(uninstalling)
    await uninstalling

    const after = loadCatalog(paths).entries.find((entry) => entry.id === listing.id)
    assert.ok(after)
    assert.equal(after.status, 'uninstalled')
    assert.equal(fs.existsSync(path.join(paths.userFontsDir, files[0]!.basename)), false)
  })
})

test('a check reparses dest bytes that landed after an interrupted catalog write', async () => {
  const paths = setup()
  const fixture = path.join(paths.dataRoot, 'fixture.otf')
  writeTestFont(fixture, 'Reckless', 'RecklessVF', { format: 'otf', version: 'Version 1.000' })
  const first = fs.readFileSync(fixture)
  configureRetailSync(paths, { enabled: true, token: 't' })
  await syncRetail(paths, {
    fetchManifest: async () => manifestWith(first.length, 'e1'),
    fetchFile: async () => new Uint8Array(first),
  })
  const dest = path.join(paths.userFontsDir, 'RecklessVF.otf')
  const before = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf')
  assert.ok(before)
  assert.equal(before.status, 'installed')
  assert.equal(before.installedPath, dest)
  assert.equal(before.faces[0]?.familyName, 'Reckless')
  const staleFingerprint = before.installedFingerprint
  assert.ok(staleFingerprint)

  // Persist already wrote dest + manifest; catalog faces still describe the previous revision.
  writeTestFont(dest, 'NewReckless', 'NewRecklessVF', { format: 'otf', version: 'Version 2.000' })
  const next = fs.readFileSync(dest)
  assert.notEqual(fingerprintFile(dest), staleFingerprint)
  const local = loadRetailManifest(paths)
  const row = local.files['Reckless/RecklessVF.otf']
  assert.ok(row)
  row.size = next.length
  row.etag = 'e2'
  row.revisionId = 'rev-2'
  saveRetailManifest(paths, local)

  await checkRetail(paths, { fetchManifest: async () => manifestWith(next.length, 'e2') })
  const after = loadCatalog(paths).entries.find((entry) => entry.id === before.id)
  assert.ok(after)
  assert.equal(after.faces[0]?.familyName, 'NewReckless')
  assert.equal(after.installedFingerprint, fingerprintFile(dest))
})

test('a parked retail cache records its fingerprint so later checks skip reparse', async () => {
  const paths = setup()
  const occupying = path.join(paths.userFontsDir, 'RecklessVF.otf')
  writeTestFont(occupying, 'LocalReckless', 'LocalRecklessVF', { format: 'otf' })
  const fixture = path.join(paths.dataRoot, 'fixture.otf')
  writeTestFont(fixture, 'Reckless', 'RecklessVF', { format: 'otf', version: 'Version 2.000' })
  const bytes = fs.readFileSync(fixture)
  configureRetailSync(paths, { enabled: true, token: 't' })
  await syncRetail(paths, {
    fetchManifest: async () => manifestWith(bytes.length, 'e1'),
    fetchFile: async () => new Uint8Array(bytes),
  })

  const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath === 'Reckless/RecklessVF.otf')
  assert.ok(listing)
  assert.equal(listing.status, 'uninstalled')
  assert.ok(listing.sourcePath)
  assert.equal(listing.sourceFingerprint, fingerprintFile(listing.sourcePath))
  assert.equal(listing.faces[0]?.familyName, 'Reckless')

  const catalog = loadCatalog(paths)
  const stale = catalog.entries.find((entry) => entry.id === listing.id)
  assert.ok(stale?.faces[0])
  stale.faces[0].familyName = 'StaleName'
  saveCatalog(paths, catalog)

  await checkRetail(paths, { fetchManifest: async () => manifestWith(bytes.length, 'e1') })
  const after = loadCatalog(paths).entries.find((entry) => entry.id === listing.id)
  assert.ok(after)
  assert.equal(after.sourceFingerprint, fingerprintFile(listing.sourcePath))
  assert.equal(after.faces[0]?.familyName, 'StaleName', 'matching cache bytes must not reparse')
})

function recklessFont(paths: AppPaths): Uint8Array {
  const file = path.join(paths.dataRoot, 'source-RecklessVF.otf')
  writeTestFont(file, 'Reckless', 'RecklessVF', { format: 'otf' })
  return new Uint8Array(fs.readFileSync(file))
}

function slowManyFiles(count: number) {
  let downloads = 0
  const files = Array.from({ length: count }, (_, index) => ({ basename: `File${index}.otf`, size: 4, etag: `e${index}` }))
  return {
    get downloads() {
      return downloads
    },
    options: {
      fetchManifest: async () => manifestWithFiles(files),
      fetchFile: async () => {
        downloads += 1
        await new Promise((resolve) => setTimeout(resolve, 30))
        return new Uint8Array(4).fill(1)
      },
    },
  }
}

test('None during a sync ends it with a status that is no longer syncing, and nothing after', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  const run = slowManyFiles(RETAIL_DOWNLOAD_CONCURRENCY * 3)
  const events: Array<{ done: number; total: number } | null> = []
  const stop = onEvent((event) => {
    if (event.type === 'retail') events.push(event.status.progress)
  })
  try {
    const syncing = syncRetail(paths, run.options)
    while (run.downloads === 0) await new Promise((resolve) => setImmediate(resolve))
    assert.ok(events.some((progress) => progress && progress.total > 0))
    const stopped = await configureRetailSync(paths, { disabledGlyphsFiles: ['Reckless'] })
    assert.equal(stopped.progress, null)
    const settled = events.length
    await syncing
    assert.equal(events.at(-1), null)
    assert.equal(events.slice(settled).some((progress) => progress !== null), false)
  } finally {
    stop()
  }
})

test('one None during a sync removes every not-installed listing of the family', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  const run = slowManyFiles(RETAIL_DOWNLOAD_CONCURRENCY * 3)
  const syncing = syncRetail(paths, run.options)
  while (run.downloads <= RETAIL_DOWNLOAD_CONCURRENCY) await new Promise((resolve) => setImmediate(resolve))
  await configureRetailSync(paths, { disabledGlyphsFiles: ['Reckless'] })
  const retail = loadCatalog(paths).entries.filter((entry) => entry.retailRelativePath)
  assert.equal(retail.some((entry) => entry.status === 'uninstalled'), false)
  assert.ok(retail.length > 0, 'installed fonts stay listed')
  await syncing
  assert.equal(
    loadCatalog(paths).entries.some((entry) => entry.retailRelativePath && entry.status === 'uninstalled'),
    false,
  )
})

test('turning a family off drops a listing whose only copy is parked in the retail cache', async () => {
  resetRetailCache()
  await withService(async (service, paths) => {
    const bytes = recklessFont(paths)
    await configureRetailSync(paths, { enabled: true, token: 't' })
    const options = { fetchManifest: async () => manifestWith(bytes.length, 'e1'), fetchFile: async () => bytes }
    await syncRetail(paths, options)
    const listing = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath)!
    await service.uninstall(listing.id)
    // The next pass re-downloads the uninstalled file into the retail cache, not Fonts.
    await syncRetail(paths, options)
    const parked = loadCatalog(paths).entries.find((entry) => entry.retailRelativePath)!
    assert.equal(parked.status, 'uninstalled')
    assert.ok(parked.sourcePath && fs.existsSync(parked.sourcePath))

    await configureRetailSync(paths, { disabledGlyphsFiles: ['Reckless'] })
    assert.equal(loadCatalog(paths).entries.some((entry) => entry.retailRelativePath), false)
    assert.equal(fs.existsSync(parked.sourcePath), false)
  })
})

test('a restart drops not-installed listings of families that were already off', async () => {
  const paths = setup()
  await configureRetailSync(paths, { enabled: true, token: 't' })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  // Written by an older build: the family is off but its listing stayed.
  const settings = loadSettings(paths)
  settings.retailSync = { ...settings.retailSync!, disabledGlyphsFiles: ['Reckless'], familyOptOuts: true }
  saveSettings(paths, settings)
  assert.equal(loadCatalog(paths).entries.some((entry) => entry.retailRelativePath), true)
  resetRetailCache()
  assert.equal(await dropOrphanRetailListings(paths), 1)
  assert.equal(loadCatalog(paths).entries.some((entry) => entry.retailRelativePath), false)
})

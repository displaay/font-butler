import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { readRetailToken } from './auth.ts'
import { createWatchFolder } from './folders.ts'
import { buildPaths, retailTokenPath } from './paths.ts'
import type { AppPaths } from './paths.ts'
import {
  checkRetail,
  configureRetailSync,
  resetRetailCache,
  retailStatus,
  syncRetail,
} from './service-retail.ts'
import { loadSettings, saveSettings } from './settings.ts'
import { retailDriftSummary, type RetailManifest } from '../shared/retail.ts'

function setup(): { paths: AppPaths; root: string } {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-retail-svc-'))
  const paths = buildPaths({ override: dataRoot, mac: false })
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  const root = path.join(dataRoot, 'DISPLAAY Retail')
  resetRetailCache()
  return { paths, root }
}

function withFolder(paths: AppPaths, root: string): string {
  fs.mkdirSync(root, { recursive: true })
  const settings = loadSettings(paths)
  const folder = createWatchFolder(root, { policy: 'library', watching: true })
  settings.folders = [folder]
  saveSettings(paths, settings)
  return folder.id
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
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)

  const status = configureRetailSync(paths, {
    enabled: true,
    workerBaseUrl: 'https://w.displaay.net',
    token: 'super-secret',
    folderId,
  })

  assert.equal(status.hasToken, true)
  assert.equal(JSON.stringify(status).includes('super-secret'), false)

  // The settings file is what gets broadcast to the renderer — the token must not be in it.
  const raw = fs.readFileSync(paths.settingsPath, 'utf8')
  assert.equal(raw.includes('super-secret'), false)
  assert.equal(readRetailToken(retailTokenPath(paths)), 'super-secret')
})

test('an empty token clears the stored one', () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { token: 'abc', folderId })
  assert.equal(retailStatus(paths).hasToken, true)
  const cleared = configureRetailSync(paths, { token: '' })
  assert.equal(cleared.hasToken, false)
})

test('a non-https worker address is rejected at configure time', () => {
  const { paths } = setup()
  assert.throws(
    () => configureRetailSync(paths, { workerBaseUrl: 'http://evil.example.com' }),
    /https/,
  )
})

test('a check without a configured folder reports an error rather than throwing', async () => {
  const { paths, root } = setup()
  withFolder(paths, root)
  configureRetailSync(paths, { enabled: true })
  const status = await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  assert.match(status.error ?? '', /folder/i)
  assert.equal(status.pending, 0)
})

test('a check without a token reports an error rather than throwing', async () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: true, folderId })
  const status = await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  assert.match(status.error ?? '', /token/i)
})

test('a check reports pending files, and a sync clears them', async () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: true, token: 't', folderId })

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
  assert.equal(fs.readFileSync(path.join(root, 'Reckless', 'RecklessVF.otf')).length, 4)
  assert.ok(synced.syncedAt)
})

test('a regenerated file is picked up as changed on the next check', async () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: true, token: 't', folderId })

  await syncRetail(paths, {
    fetchManifest: async () => manifestWith(4, 'e1'),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })

  // Same path, new bytes — exactly what a regeneration looks like.
  const after = await checkRetail(paths, { fetchManifest: async () => manifestWith(6, 'e2') })
  assert.equal(after.pending, 1)
  assert.equal(after.drift[0].kind, 'changed')
  assert.equal(after.drift[0].relativePath, 'Reckless/RecklessVF.otf')
})

test('a worker failure surfaces as a status error, not an exception', async () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: true, token: 't', folderId })
  const status = await checkRetail(paths, {
    fetchManifest: async () => {
      throw new Error('worker is down')
    },
  })
  assert.match(status.error ?? '', /worker is down/)
})

test('the retail folder is created by a sync when it does not exist', async () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: true, token: 't', folderId })
  fs.rmSync(root, { recursive: true, force: true })

  const status = await syncRetail(paths, {
    fetchManifest: async () => manifestWith(4, 'e1'),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  assert.equal(status.error, null)
  assert.equal(fs.existsSync(path.join(root, 'Reckless', 'RecklessVF.otf')), true)
})

test('changing the folder discards drift measured against the old one', async () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: true, token: 't', folderId })

  const checked = await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })
  assert.equal(checked.pending, 1)

  // Point at a different folder: the old folder's pending count must not carry over.
  const moved = configureRetailSync(paths, { folderId: null })
  assert.equal(moved.pending, 0)
  assert.deepEqual(moved.drift, [])
  assert.equal(moved.checkedAt, null)
})

test('replacing the token discards drift measured with the old one', async () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: true, token: 't', folderId })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })

  const rotated = configureRetailSync(paths, { token: 'new-token' })
  assert.equal(rotated.pending, 0)
  assert.equal(rotated.checkedAt, null)
})

test('toggling enabled alone keeps the existing drift', async () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: true, token: 't', folderId })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })

  const toggled = configureRetailSync(paths, { enabled: false })
  assert.equal(toggled.pending, 1)
})

test('the on/off switch actually gates checking and syncing', async () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: false, token: 't', folderId })

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

test('a paused or unwatched folder is refused, so fonts are never written where nothing imports them', async () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: true, token: 't', folderId })

  const settings = loadSettings(paths)
  settings.folders = settings.folders.map((folder) => ({ ...folder, paused: true }))
  saveSettings(paths, settings)

  const status = await syncRetail(paths, {
    fetchManifest: async () => manifestWith(4, 'e1'),
    fetchFile: async () => new Uint8Array(4).fill(1),
  })
  assert.match(status.error ?? '', /start watching/i)
  assert.equal(fs.existsSync(path.join(root, 'Reckless', 'RecklessVF.otf')), false)
})

test('a failed check keeps the old checkedAt rather than claiming a fresh measurement', async () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: true, token: 't', folderId })

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
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: true, token: 't', folderId })

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

  // The lock releases, so a later sync still works.
  const later = await syncRetail(paths, options)
  assert.equal(later.error, null)
})

test('the autocheck interval round-trips and rejects nonsense', () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)

  // Default when never set.
  assert.equal(configureRetailSync(paths, { folderId }).autoCheckMinutes, 60)
  assert.equal(configureRetailSync(paths, { autoCheckMinutes: 15 }).autoCheckMinutes, 15)
  // 0 is a real choice: never check in the background.
  assert.equal(configureRetailSync(paths, { autoCheckMinutes: 0 }).autoCheckMinutes, 0)
  // Sub-minute values would hammer the worker; negatives and junk fall back to the default.
  assert.equal(configureRetailSync(paths, { autoCheckMinutes: 0.2 }).autoCheckMinutes, 1)
  assert.equal(configureRetailSync(paths, { autoCheckMinutes: -5 }).autoCheckMinutes, 60)
  assert.equal(
    configureRetailSync(paths, { autoCheckMinutes: Number.NaN }).autoCheckMinutes,
    60,
  )

  // Survives a reload from disk.
  configureRetailSync(paths, { autoCheckMinutes: 360 })
  assert.equal(loadSettings(paths).retailSync?.autoCheckMinutes, 360)
})

test('changing the interval alone does not discard measured drift', async () => {
  const { paths, root } = setup()
  const folderId = withFolder(paths, root)
  configureRetailSync(paths, { enabled: true, token: 't', folderId })
  await checkRetail(paths, { fetchManifest: async () => manifestWith(4, 'e1') })

  const changed = configureRetailSync(paths, { autoCheckMinutes: 60 })
  assert.equal(changed.pending, 1)
  assert.equal(changed.autoCheckMinutes, 60)
})

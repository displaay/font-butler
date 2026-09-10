import fs from 'node:fs'
import path from 'node:path'
import { readRetailToken, writeRetailToken } from './auth.ts'
import { emitEvent } from './events.ts'
import { retailTokenPath } from './paths.ts'
import type { AppPaths } from './paths.ts'
import { applyRetailSync } from './retail-apply.ts'
import { fetchRetailFile, fetchRetailManifest, isAllowedRetailBaseUrl } from './retail-client.ts'
import {
  countPendingDrift,
  diffRetailManifest,
  loadRetailManifest,
  saveRetailManifest,
  statRetailFile,
} from './retail-sync.ts'
import { DEFAULT_RETAIL_WORKER_BASE_URL, defaultRetailSync, loadSettings, saveSettings } from './settings.ts'
import type { AppSettings, RetailSyncSettings, WatchFolder } from './types.ts'
import { normalizeAutoCheckMinutes } from '../shared/retail.ts'
import type { RetailDriftItem, RetailManifest, RetailSkip, RetailSyncStatus } from '../shared/retail.ts'

/** In-memory only: the last check's result, so `status` is cheap and never touches the network. */
type RetailCache = {
  checkedAt: string | null
  drift: RetailDriftItem[]
  skipped: RetailSkip[]
  error: string | null
}

const cache: RetailCache = { checkedAt: null, drift: [], skipped: [], error: null }

/**
 * Two overlapping syncs would fight over the same `.part` files: the second one's entry sweep deletes
 * the first one's in-flight downloads, and both write the same temp path before renaming it over the
 * target. A shared promise makes a second request join the run already in progress.
 */
let inflightSync: Promise<RetailSyncStatus> | null = null

export function resetRetailCache(): void {
  cache.checkedAt = null
  cache.drift = []
  cache.skipped = []
  cache.error = null
}

function retailSettings(settings: AppSettings): RetailSyncSettings {
  return settings.retailSync ?? defaultRetailSync()
}

function retailFolder(settings: AppSettings): WatchFolder | undefined {
  const config = retailSettings(settings)
  if (!config.folderId) return undefined
  return settings.folders.find((folder) => folder.id === config.folderId)
}

export function retailStatus(paths: AppPaths, settings = loadSettings(paths)): RetailSyncStatus {
  const config = retailSettings(settings)
  const folder = retailFolder(settings)
  const local = loadRetailManifest(paths)
  return {
    enabled: config.enabled,
    autoCheckMinutes: config.autoCheckMinutes,
    configured: Boolean(folder),
    // Never the token itself: this object is emitted as an event and returned to the renderer.
    hasToken: readRetailToken(retailTokenPath(paths)).length > 0,
    workerBaseUrl: config.workerBaseUrl || DEFAULT_RETAIL_WORKER_BASE_URL,
    folderRoot: folder?.root ?? null,
    checkedAt: cache.checkedAt,
    syncedAt: local.syncedAt,
    pending: countPendingDrift(cache.drift),
    drift: cache.drift,
    skipped: cache.skipped,
    error: cache.error,
  }
}

function emitRetail(paths: AppPaths): RetailSyncStatus {
  const status = retailStatus(paths)
  emitEvent({ type: 'retail', status })
  return status
}

export function configureRetailSync(
  paths: AppPaths,
  input: {
    enabled?: boolean
    workerBaseUrl?: string
    autoCheckMinutes?: number
    token?: string
    folderId?: string | null
  },
): RetailSyncStatus {
  const settings = loadSettings(paths)
  const current = retailSettings(settings)

  const workerBaseUrl = (input.workerBaseUrl ?? current.workerBaseUrl).trim()
  if (workerBaseUrl && !isAllowedRetailBaseUrl(workerBaseUrl)) {
    throw new Error('The DISPLAAY worker address must be an https URL.')
  }

  const next: RetailSyncSettings = {
    enabled: input.enabled ?? current.enabled,
    workerBaseUrl: workerBaseUrl || DEFAULT_RETAIL_WORKER_BASE_URL,
    autoCheckMinutes:
      input.autoCheckMinutes === undefined
        ? current.autoCheckMinutes
        : normalizeAutoCheckMinutes(input.autoCheckMinutes),
    folderId: input.folderId === undefined ? current.folderId : input.folderId,
  }
  // Cached drift describes one folder on one server. If either moves, or the credentials change, it is
  // no longer a statement about anything — serving it would report the old folder's files as pending.
  const invalidates =
    next.folderId !== current.folderId ||
    next.workerBaseUrl !== current.workerBaseUrl ||
    input.token !== undefined
  // The token is written to its own 0600 file, never into settings.json. An empty string clears it.
  // Written first: if it throws, settings are not yet on disk and the two cannot disagree.
  if (input.token !== undefined) {
    writeRetailToken(retailTokenPath(paths), input.token)
  }
  settings.retailSync = next
  saveSettings(paths, settings)
  if (invalidates) {
    resetRetailCache()
  }

  emitEvent({ type: 'settings', settings })
  return emitRetail(paths)
}

function requireReady(paths: AppPaths): {
  config: RetailSyncSettings
  folder: WatchFolder
  token: string
} {
  const settings = loadSettings(paths)
  const config = retailSettings(settings)
  if (!config.enabled) {
    throw new Error('Turn on the DISPLAAY retail collection first.')
  }
  const folder = retailFolder(settings)
  if (!folder) {
    throw new Error('Pick a folder for the DISPLAAY retail collection first.')
  }
  // Synced fonts reach the library through the inbox watcher, which only walks folders that are
  // watching and not paused. Writing into a paused folder would put files on disk that nothing
  // imports, and the sync would still report success.
  if (!folder.watching || folder.paused) {
    throw new Error('Start watching that folder before syncing the retail collection.')
  }
  const token = readRetailToken(retailTokenPath(paths))
  if (!token) {
    throw new Error('Add a DISPLAAY worker token first.')
  }
  return { config, folder, token }
}

async function readManifest(
  paths: AppPaths,
  options: { refresh?: boolean; fetchManifest?: typeof fetchRetailManifest } = {},
): Promise<{ manifest: RetailManifest; folder: WatchFolder; token: string; workerBaseUrl: string }> {
  const { config, folder, token } = requireReady(paths)
  const manifest = await (options.fetchManifest ?? fetchRetailManifest)({
    workerBaseUrl: config.workerBaseUrl,
    token,
    refresh: options.refresh,
  })
  return { manifest, folder, token, workerBaseUrl: config.workerBaseUrl }
}

/**
 * Compare R2 against the last sync. Never called on the cold-start path — it is a deliberate user
 * action or a manual refresh, matching how the app-update check is wired.
 */
export async function checkRetail(
  paths: AppPaths,
  options: { refresh?: boolean; fetchManifest?: typeof fetchRetailManifest } = {},
): Promise<RetailSyncStatus> {
  try {
    const { manifest, folder } = await readManifest(paths, options)
    // The folder may not exist yet on a first run; treat everything as missing rather than throwing.
    const drift = diffRetailManifest(manifest, loadRetailManifest(paths), statRetailFile(folder.root))
    cache.checkedAt = new Date().toISOString()
    cache.drift = drift
    cache.skipped = manifest.skipped
    cache.error = null
  } catch (error) {
    // Deliberately does NOT bump `checkedAt`: nothing was measured, and a fresh timestamp next to
    // stale drift would read as a successful check.
    cache.error = error instanceof Error ? error.message : 'Could not reach the DISPLAAY worker.'
  }
  return emitRetail(paths)
}

export async function syncRetail(
  paths: AppPaths,
  options: {
    fetchManifest?: typeof fetchRetailManifest
    fetchFile?: typeof fetchRetailFile
    onFolderReady?: (root: string) => Promise<void>
  } = {},
): Promise<RetailSyncStatus> {
  // A second request joins the run already in progress rather than starting a competing one.
  if (inflightSync) return inflightSync
  inflightSync = runSync(paths, options).finally(() => {
    inflightSync = null
  })
  return inflightSync
}

async function runSync(
  paths: AppPaths,
  options: {
    fetchManifest?: typeof fetchRetailManifest
    fetchFile?: typeof fetchRetailFile
    onFolderReady?: (root: string) => Promise<void>
  },
): Promise<RetailSyncStatus> {
  try {
    const { manifest, folder, token, workerBaseUrl } = await readManifest(paths, {
      refresh: true,
      fetchManifest: options.fetchManifest,
    })

    // `resolveWatchFolders` throws on a missing directory, so the folder has to exist before anything
    // downstream re-reads it as a watch folder.
    fs.mkdirSync(path.resolve(folder.root), { recursive: true })

    const drift = diffRetailManifest(manifest, loadRetailManifest(paths), statRetailFile(folder.root))
    const download = options.fetchFile ?? fetchRetailFile

    const result = await applyRetailSync({
      root: folder.root,
      drift,
      manifest: loadRetailManifest(paths),
      persist: (next) => saveRetailManifest(paths, next),
      download: (key, expectedSize) => download({ workerBaseUrl, token, key, expectedSize }),
    })

    // Re-diff against what actually landed, so the status reflects disk rather than intent.
    cache.checkedAt = new Date().toISOString()
    cache.drift = diffRetailManifest(manifest, result.manifest, statRetailFile(folder.root))
    cache.skipped = manifest.skipped
    cache.error = result.errors.length ? result.errors.slice(0, 5).join(' ') : null

    if (result.written > 0) {
      await options.onFolderReady?.(folder.root)
    }
  } catch (error) {
    cache.error = error instanceof Error ? error.message : 'Could not sync the retail collection.'
  }
  return emitRetail(paths)
}

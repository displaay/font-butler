import chokidar, { type FSWatcher } from 'chokidar'
import fs from 'node:fs'
import path from 'node:path'
import { findBySourcePath, loadCatalog, resolveStatusWhenSourceFound, saveCatalog } from './catalog.ts'
import { emitEvent } from './events.ts'
import { isFontFile, readFileStat } from './parse.ts'
import type { AppPaths } from './paths.ts'
import type { CatalogEntry } from './types.ts'

let watcher: FSWatcher | null = null
let inboxWatcher: FSWatcher | null = null
let inboxTimer: ReturnType<typeof setTimeout> | null = null
let inboxPending: string[] = []

function refreshStatus(paths: AppPaths, sourcePath: string): CatalogEntry | undefined {
  const catalog = loadCatalog(paths)
  const entry = findBySourcePath(catalog, sourcePath)
  if (!entry) {
    return undefined
  }
  if (!fs.existsSync(sourcePath)) {
    entry.status = 'source-missing'
    entry.updatedAt = Date.now()
    saveCatalog(paths, catalog)
    emitEvent({ type: 'catalog', entries: catalog.entries })
    return entry
  }
  const stat = readFileStat(sourcePath)
  entry.sourceMtimeMs = stat.mtimeMs
  entry.sourceSize = stat.size
  if (
    (entry.status === 'installed' || entry.status === 'outdated') &&
    (stat.mtimeMs !== entry.installedSnapshotMtimeMs ||
      stat.size !== entry.installedSnapshotSize)
  ) {
    entry.status = 'outdated'
  } else if (entry.status === 'source-missing') {
    entry.status = resolveStatusWhenSourceFound(entry)
  } else if (
    entry.status === 'outdated' &&
    stat.mtimeMs === entry.installedSnapshotMtimeMs &&
    stat.size === entry.installedSnapshotSize
  ) {
    entry.status = 'installed'
  }
  entry.updatedAt = Date.now()
  saveCatalog(paths, catalog)
  emitEvent({ type: 'catalog', entries: catalog.entries })
  return entry
}

export async function syncWatchers(paths: AppPaths): Promise<void> {
  const catalog = loadCatalog(paths)
  const sources = catalog.entries.map((entry) => entry.sourcePath)
  if (watcher) {
    await watcher.close()
    watcher = null
  }
  if (sources.length === 0) {
    return
  }
  watcher = chokidar.watch(sources, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
  })
  watcher.on('change', (filePath) => {
    refreshStatus(paths, filePath)
  })
  watcher.on('unlink', (filePath) => {
    refreshStatus(paths, filePath)
  })
}

const INBOX_MAX_DEPTH = 5

export function listInboxFontFiles(root: string, depth = 0): string[] {
  if (depth > INBOX_MAX_DEPTH) {
    return []
  }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...listInboxFontFiles(full, depth + 1))
    } else if (entry.isFile() && isFontFile(full)) {
      files.push(path.resolve(full))
    }
  }
  return files
}

export async function syncInboxWatcher(
  folder: string | null,
  onBatch: (filePaths: string[]) => void,
): Promise<void> {
  if (inboxTimer) {
    clearTimeout(inboxTimer)
    inboxTimer = null
  }
  inboxPending = []
  if (inboxWatcher) {
    await inboxWatcher.close()
    inboxWatcher = null
  }
  if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return
  }
  inboxWatcher = chokidar.watch(folder, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    depth: INBOX_MAX_DEPTH,
  })
  const queue = (filePath: string) => {
    if (!isFontFile(filePath)) {
      return
    }
    inboxPending.push(path.resolve(filePath))
    if (inboxTimer) {
      clearTimeout(inboxTimer)
    }
    inboxTimer = setTimeout(() => {
      const batch = [...new Set(inboxPending)]
      inboxPending = []
      inboxTimer = null
      if (batch.length) {
        onBatch(batch)
      }
    }, 350)
  }
  inboxWatcher.on('add', queue)
}

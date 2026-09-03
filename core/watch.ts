import chokidar, { type FSWatcher } from 'chokidar'
import fs from 'node:fs'
import { findBySourcePath, loadCatalog, resolveStatusWhenSourceFound, saveCatalog } from './catalog.ts'
import { emitEvent } from './events.ts'
import { readFileStat } from './parse.ts'
import type { AppPaths } from './paths.ts'
import type { CatalogEntry } from './types.ts'

let watcher: FSWatcher | null = null

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

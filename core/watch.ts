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

export const FONT_TREE_MAX_DEPTH = 10

export function shouldSkipFontWalkName(name: string): boolean {
  return name.startsWith('.') || name === '__MACOSX'
}

export function listFontFilesInTree(
  root: string,
  depth = 0,
  maxDepth = FONT_TREE_MAX_DEPTH,
): string[] {
  if (depth > maxDepth) {
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
    if (shouldSkipFontWalkName(entry.name)) {
      continue
    }
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFontFilesInTree(full, depth + 1, maxDepth))
    } else if (entry.isFile() && isFontFile(full)) {
      files.push(path.resolve(full))
    }
  }
  return files
}

export function listInboxFontFiles(root: string, depth = 0): string[] {
  return listFontFilesInTree(root, depth)
}

export function expandImportPaths(inputPaths: string[]): { files: string[]; errors: string[] } {
  const files: string[] = []
  const errors: string[] = []
  const seen = new Set<string>()

  const addFile = (filePath: string) => {
    const resolved = path.resolve(filePath)
    if (seen.has(resolved)) {
      return
    }
    seen.add(resolved)
    files.push(resolved)
  }

  for (const raw of inputPaths) {
    const resolved = path.resolve(raw)
    if (!fs.existsSync(resolved)) {
      errors.push(`${raw}: Not found.`)
      continue
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(resolved)
    } catch (error) {
      errors.push(`${raw}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (stat.isDirectory()) {
      const found = listFontFilesInTree(resolved)
      if (found.length === 0) {
        errors.push(`${raw}: No font files in that folder.`)
        continue
      }
      for (const filePath of found) {
        addFile(filePath)
      }
      continue
    }
    if (stat.isFile()) {
      addFile(resolved)
      continue
    }
    errors.push(`${raw}: Not a file.`)
  }

  return { files, errors }
}

function existingWatchFolders(folders: string[]): string[] {
  const existing: string[] = []
  for (const folder of folders) {
    if (!folder) continue
    try {
      if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
        existing.push(folder)
      }
    } catch {
      // Skip folders that disappeared between settings save and watch setup.
    }
  }
  return existing
}

export async function syncInboxWatcher(
  folders: string[],
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
  const existing = existingWatchFolders(folders)
  if (existing.length === 0) {
    return
  }
  inboxWatcher = chokidar.watch(existing, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    depth: FONT_TREE_MAX_DEPTH,
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

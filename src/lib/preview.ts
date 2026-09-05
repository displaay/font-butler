import type { CatalogEntry } from './types'

export function catalogPreviewRevision(entry: CatalogEntry): string {
  if (entry.installedPath) {
    return `${entry.installedSnapshotMtimeMs ?? 0}-${entry.installedSnapshotSize ?? 0}-${entry.updatedAt}`
  }
  return `${entry.sourceMtimeMs}-${entry.sourceSize}-${entry.updatedAt}`
}

export function catalogFontUrl(entry: CatalogEntry): string {
  return `/api/font-file/${entry.id}?v=${encodeURIComponent(catalogPreviewRevision(entry))}`
}

export function systemFontUrl(filePath: string, revision?: string | number): string {
  const query = new URLSearchParams({ path: filePath })
  if (revision !== undefined) {
    query.set('v', String(revision))
  }
  return `/api/system-font?${query.toString()}`
}

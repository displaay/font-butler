import type { CatalogEntry } from './types'

export type PreviewWhich = 'source' | 'installed' | 'revision'

export function catalogPreviewRevision(
  entry: CatalogEntry,
  which: PreviewWhich = 'installed',
  revision?: string,
): string {
  if (which === 'revision' && revision) return revision
  if (which === 'source') {
    return `${entry.sourceFingerprint ?? `${entry.sourceMtimeMs}-${entry.sourceSize}`}-${entry.updatedAt}`
  }
  if (entry.installedFingerprint) return `${entry.installedFingerprint}-${entry.updatedAt}`
  if (entry.installedPath) {
    return `${entry.installedSnapshotMtimeMs ?? 0}-${entry.installedSnapshotSize ?? 0}-${entry.updatedAt}`
  }
  return `${entry.sourceMtimeMs}-${entry.sourceSize}-${entry.updatedAt}`
}

export function catalogFontUrl(
  entry: CatalogEntry,
  which: PreviewWhich = 'installed',
  revision?: string,
): string {
  const query = new URLSearchParams({
    v: catalogPreviewRevision(entry, which, revision),
    which,
  })
  if (which === 'revision' && revision) query.set('revision', revision)
  return `/api/font-file/${entry.id}?${query.toString()}`
}

export function systemFontUrl(filePath: string, revision?: string | number): string {
  const query = new URLSearchParams({ path: filePath })
  if (revision !== undefined) {
    query.set('v', String(revision))
  }
  return `/api/system-font?${query.toString()}`
}

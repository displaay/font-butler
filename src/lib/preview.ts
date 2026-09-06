import { signFontAccess, withFontAccessQuery } from './font-access'
import type { CatalogEntry } from './types'

export type PreviewWhich = 'source' | 'installed' | 'revision'

export function catalogPreviewWhich(entry: CatalogEntry): PreviewWhich {
  if (entry.installedPath || entry.disabledPath) return 'installed'
  return 'source'
}

export function catalogPreviewRevision(
  entry: CatalogEntry,
  which: PreviewWhich = 'installed',
  revision?: string,
): string {
  if (which === 'revision' && revision) return revision
  const liveInstall = Boolean(entry.installedPath || entry.disabledPath)
  if (which === 'source' || (which === 'installed' && !liveInstall)) {
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

export function catalogFontFaceRules(
  family: string,
  url: string,
  faces: Array<{ weight?: number; italic?: boolean; isVariable?: boolean }>,
): string[] {
  const descriptors = faces.length > 0 ? faces : [{ weight: 400, italic: false }]
  return descriptors.map((face) => {
    const weight = face.isVariable ? '1 1000' : String(face.weight ?? 400)
    const style = face.italic ? 'italic' : 'normal'
    return `@font-face{font-family:"${family}";src:url("${url}");font-weight:${weight};font-style:${style};font-display:swap;}`
  })
}

export function systemFontUrl(filePath: string, revision?: string | number): string {
  const query = new URLSearchParams({ path: filePath })
  if (revision !== undefined) {
    query.set('v', String(revision))
  }
  return `/api/system-font?${query.toString()}`
}

export async function signedCatalogFontUrl(
  entry: CatalogEntry,
  which: PreviewWhich,
  secret: string,
  revision?: string,
  now = Date.now(),
): Promise<string> {
  const access = await signFontAccess(
    secret,
    {
      kind: 'font-file',
      id: entry.id,
      which,
      revision: which === 'revision' && revision ? revision : '',
    },
    now,
  )
  return withFontAccessQuery(catalogFontUrl(entry, which, revision), access)
}

export async function signedSystemFontUrl(
  filePath: string,
  secret: string,
  revision?: string | number,
  now = Date.now(),
): Promise<string> {
  const access = await signFontAccess(secret, { kind: 'system-font', path: filePath }, now)
  return withFontAccessQuery(systemFontUrl(filePath, revision), access)
}

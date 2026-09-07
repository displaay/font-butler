import { signFontAccess, withFontAccessQuery } from './font-access'
import type { CatalogEntry, SystemFace } from './types'

export type PreviewWhich = 'source' | 'installed' | 'revision'
export type PreviewUrlCache = Map<string, string>

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

function faceDescriptorKey(
  faces: Array<{ weight?: number; italic?: boolean; isVariable?: boolean }>,
): string {
  const descriptors = faces.length > 0 ? faces : [{ weight: 400, italic: false }]
  return descriptors
    .map((face) => `${face.isVariable ? '1 1000' : String(face.weight ?? 400)}:${face.italic ? 'i' : 'n'}`)
    .join(',')
}

function catalogEntryPreviewUrls(entry: CatalogEntry): string[] {
  const which = catalogPreviewWhich(entry)
  const urls = [catalogFontUrl(entry, which), catalogFontUrl(entry, 'installed')]
  if (entry.sourcePath && entry.sourcePath !== entry.installedPath) {
    urls.push(catalogFontUrl(entry, 'source'))
  }
  return urls
}

export function catalogPreviewFingerprint(entry: CatalogEntry): string {
  return `${entry.id}\t${faceDescriptorKey(entry.faces)}\t${catalogEntryPreviewUrls(entry).join(' ')}`
}

export function systemPreviewFingerprint(
  face: Pick<SystemFace, 'path' | 'weight' | 'isVariable'>,
): string {
  const weight = face.isVariable ? '1 1000' : face.weight ? String(face.weight) : '400'
  return `${systemFontUrl(face.path)}\t${weight}`
}

export function previewStylesFingerprint(
  entries: CatalogEntry[],
  systemFaces: Array<Pick<SystemFace, 'path' | 'weight' | 'isVariable'>>,
): string {
  const catalog = entries.map(catalogPreviewFingerprint)
  const system = systemFaces.map(systemPreviewFingerprint)
  return `${catalog.join('\n')}\n--\n${system.join('\n')}`
}

export function catalogPreviewFingerprintSet(entries: CatalogEntry[]): string {
  return entries.map(catalogPreviewFingerprint).join('\n')
}

export function systemPreviewFingerprintSet(
  systemFaces: Array<Pick<SystemFace, 'path' | 'weight' | 'isVariable'>>,
): string {
  return systemFaces.map(systemPreviewFingerprint).join('\n')
}

async function cachedUrl(
  cache: PreviewUrlCache,
  unsigned: string,
  refresh: boolean,
  sign: () => Promise<string>,
): Promise<string> {
  if (!refresh) {
    const hit = cache.get(unsigned)
    if (hit) return hit
  }
  const url = await sign()
  cache.set(unsigned, url)
  return url
}

export async function cachedSignedCatalogFontUrl(
  cache: PreviewUrlCache,
  entry: CatalogEntry,
  which: PreviewWhich,
  secret: string,
  options: { revision?: string; now?: number; refresh?: boolean } = {},
): Promise<string> {
  const unsigned = catalogFontUrl(entry, which, options.revision)
  return cachedUrl(cache, unsigned, Boolean(options.refresh), () =>
    signedCatalogFontUrl(entry, which, secret, options.revision, options.now),
  )
}

export async function cachedSignedSystemFontUrl(
  cache: PreviewUrlCache,
  filePath: string,
  secret: string,
  options: { revision?: string | number; now?: number; refresh?: boolean } = {},
): Promise<string> {
  const unsigned = systemFontUrl(filePath, options.revision)
  return cachedUrl(cache, unsigned, Boolean(options.refresh), () =>
    signedSystemFontUrl(filePath, secret, options.revision, options.now),
  )
}

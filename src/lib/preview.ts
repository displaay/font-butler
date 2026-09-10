import { signFontAccess, withFontAccessQuery } from './font-access'
import { hasManagedInstall } from './group'
import type { CatalogEntry, SystemFace } from './types'

export type PreviewWhich = 'source' | 'installed' | 'revision'
export type PreviewUrlCache = Map<string, string>

export function catalogPreviewWhich(entry: CatalogEntry): PreviewWhich {
  if (hasManagedInstall(entry)) return 'installed'
  return 'source'
}

export function catalogPreviewRevision(
  entry: CatalogEntry,
  which: PreviewWhich = 'installed',
  revision?: string,
): string {
  if (which === 'revision' && revision) return revision
  const liveInstall = hasManagedInstall(entry)
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
    return `@font-face{font-family:"${family}";src:url("${url}");font-weight:${weight};font-style:${style};font-display:block;}`
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
  if (entry.sourcePath && entry.sourcePath !== entry.installedPath && entry.sourcePresent !== false) {
    urls.push(catalogFontUrl(entry, 'source'))
  }
  return urls
}

export function catalogPreviewFingerprint(entry: CatalogEntry): string {
  return `${entry.id}\t${faceDescriptorKey(entry.faces)}\t${catalogEntryPreviewUrls(entry).join(' ')}`
}

export type SystemPreviewFace = Pick<SystemFace, 'path' | 'weight' | 'italic' | 'isVariable'>

export function systemPreviewFingerprint(face: SystemPreviewFace): string {
  return `${systemFontUrl(face.path)}\t${faceDescriptorKey([face])}`
}

export function systemPathPreviewFingerprint(faces: SystemPreviewFace[]): string {
  const filePath = faces[0]?.path ?? ''
  const descriptors = faces
    .map((face) => faceDescriptorKey([face]))
    .sort()
    .join(',')
  return `${systemFontUrl(filePath)}\t${descriptors}`
}

export function previewStylesFingerprint(
  entries: CatalogEntry[],
  systemFaces: SystemPreviewFace[],
): string {
  const catalog = entries.map(catalogPreviewFingerprint)
  const system = systemFaces.map(systemPreviewFingerprint)
  return `${catalog.join('\n')}\n--\n${system.join('\n')}`
}

export function catalogPreviewFingerprintSet(entries: CatalogEntry[]): string {
  return entries.map(catalogPreviewFingerprint).join('\n')
}

export function systemPreviewFingerprintSet(systemFaces: SystemPreviewFace[]): string {
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

export function catalogEntriesNeedingPreviewCss(
  entries: CatalogEntry[],
  previousFingerprints: ReadonlyMap<string, string>,
  options: { refresh?: boolean; mounted?: ReadonlySet<string> } = {},
): { keep: Set<string>; changed: CatalogEntry[]; fingerprints: Map<string, string> } {
  const keep = new Set<string>()
  const fingerprints = new Map<string, string>()
  const changed: CatalogEntry[] = []
  const refresh = Boolean(options.refresh)
  const mounted = options.mounted
  for (const entry of entries) {
    keep.add(entry.id)
    const fingerprint = catalogPreviewFingerprint(entry)
    fingerprints.set(entry.id, fingerprint)
    if (
      !refresh &&
      previousFingerprints.get(entry.id) === fingerprint &&
      (!mounted || mounted.has(entry.id))
    ) {
      continue
    }
    changed.push(entry)
  }
  return { keep, changed, fingerprints }
}

export type SystemPathPreviewGroup<T extends SystemPreviewFace = SystemPreviewFace> = {
  path: string
  faces: T[]
}

export function systemFacesNeedingPreviewCss<T extends SystemPreviewFace>(
  faces: T[],
  previousFingerprints: ReadonlyMap<string, string>,
  options: { refresh?: boolean; mounted?: ReadonlySet<string> } = {},
): { keep: Set<string>; changed: Array<SystemPathPreviewGroup<T>>; fingerprints: Map<string, string> } {
  const groups = new Map<string, T[]>()
  for (const face of faces) {
    const group = groups.get(face.path)
    if (group) group.push(face)
    else groups.set(face.path, [face])
  }
  const keep = new Set<string>()
  const fingerprints = new Map<string, string>()
  const changed: Array<SystemPathPreviewGroup<T>> = []
  const refresh = Boolean(options.refresh)
  const mounted = options.mounted
  for (const [filePath, group] of groups) {
    keep.add(filePath)
    const fingerprint = systemPathPreviewFingerprint(group)
    fingerprints.set(filePath, fingerprint)
    if (
      !refresh &&
      previousFingerprints.get(filePath) === fingerprint &&
      (!mounted || mounted.has(filePath))
    ) {
      continue
    }
    changed.push({ path: filePath, faces: group })
  }
  return { keep, changed, fingerprints }
}

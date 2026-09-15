import { signFontAccess, withFontAccessQuery } from './font-access'
import { entryHasPreviewFile, hasManagedInstall } from './group'
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
  const live = entryHasPreviewFile(entry) ? 'file' : 'none'
  return `${entry.id}\t${faceDescriptorKey(entry.faces)}\t${catalogEntryPreviewUrls(entry).join(' ')}\t${live}`
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

export type PreviewCssOptions<TCatalog> = {
  refresh?: boolean
  mounted?: ReadonlySet<string>
  /**
   * Live catalog used to keep already-loaded preview CSS in memory.
   * Off-screen / unmounted-tab faces stay cached; missing ids are pruned;
   * fingerprint changes rebuild only the affected faces.
   */
  catalog?: readonly TCatalog[]
}

function catalogAliveById(catalog: readonly CatalogEntry[]): Map<string, CatalogEntry> {
  const alive = new Map<string, CatalogEntry>()
  for (const entry of catalog) {
    if (!entryHasPreviewFile(entry)) continue
    alive.set(entry.id, entry)
  }
  return alive
}

function shouldRebuildPreviewCss(
  refresh: boolean,
  previous: string | undefined,
  fingerprint: string,
  mounted: ReadonlySet<string> | undefined,
  key: string,
): boolean {
  return refresh || previous !== fingerprint || Boolean(mounted && !mounted.has(key))
}

export function catalogEntriesNeedingPreviewCss(
  entries: CatalogEntry[],
  previousFingerprints: ReadonlyMap<string, string>,
  options: PreviewCssOptions<CatalogEntry> = {},
): { keep: Set<string>; changed: CatalogEntry[]; fingerprints: Map<string, string> } {
  const keep = new Set<string>()
  const fingerprints = new Map<string, string>()
  const changed: CatalogEntry[] = []
  const refresh = Boolean(options.refresh)
  const mounted = options.mounted
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entryHasPreviewFile(entry)) continue
    seen.add(entry.id)
    keep.add(entry.id)
    const fingerprint = catalogPreviewFingerprint(entry)
    fingerprints.set(entry.id, fingerprint)
    if (!shouldRebuildPreviewCss(refresh, previousFingerprints.get(entry.id), fingerprint, mounted, entry.id)) {
      continue
    }
    changed.push(entry)
  }
  if (options.catalog) {
    const alive = catalogAliveById(options.catalog)
    for (const [id, previous] of previousFingerprints) {
      if (seen.has(id)) continue
      const live = alive.get(id)
      if (!live) continue
      const fingerprint = catalogPreviewFingerprint(live)
      keep.add(id)
      fingerprints.set(id, fingerprint)
      if (!shouldRebuildPreviewCss(refresh, previous, fingerprint, mounted, id)) continue
      changed.push(live)
    }
  }
  return { keep, changed, fingerprints }
}

export type SystemPathPreviewGroup<T extends SystemPreviewFace = SystemPreviewFace> = {
  path: string
  faces: T[]
}

function groupSystemPreviewFaces<T extends SystemPreviewFace>(faces: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const face of faces) {
    const group = groups.get(face.path)
    if (group) group.push(face)
    else groups.set(face.path, [face])
  }
  return groups
}

export function systemFacesNeedingPreviewCss<T extends SystemPreviewFace>(
  faces: T[],
  previousFingerprints: ReadonlyMap<string, string>,
  options: PreviewCssOptions<T> = {},
): { keep: Set<string>; changed: Array<SystemPathPreviewGroup<T>>; fingerprints: Map<string, string> } {
  const groups = groupSystemPreviewFaces(faces)
  const keep = new Set<string>()
  const fingerprints = new Map<string, string>()
  const changed: Array<SystemPathPreviewGroup<T>> = []
  const refresh = Boolean(options.refresh)
  const mounted = options.mounted
  const seen = new Set<string>()
  for (const [filePath, group] of groups) {
    seen.add(filePath)
    keep.add(filePath)
    const fingerprint = systemPathPreviewFingerprint(group)
    fingerprints.set(filePath, fingerprint)
    if (!shouldRebuildPreviewCss(refresh, previousFingerprints.get(filePath), fingerprint, mounted, filePath)) {
      continue
    }
    changed.push({ path: filePath, faces: group })
  }
  if (options.catalog) {
    const alive = groupSystemPreviewFaces(options.catalog)
    for (const [filePath, previous] of previousFingerprints) {
      if (seen.has(filePath)) continue
      const live = alive.get(filePath)
      if (!live) continue
      const fingerprint = systemPathPreviewFingerprint(live)
      keep.add(filePath)
      fingerprints.set(filePath, fingerprint)
      if (!shouldRebuildPreviewCss(refresh, previous, fingerprint, mounted, filePath)) continue
      changed.push({ path: filePath, faces: live })
    }
  }
  return { keep, changed, fingerprints }
}

import { useEffect, useMemo, useRef } from 'react'
import { getApiToken } from '@/lib/api'
import {
  cachedSignedCatalogFontUrl,
  cachedSignedSystemFontUrl,
  catalogEntriesNeedingPreviewCss,
  catalogFontFaceRules,
  catalogPreviewFingerprint,
  catalogPreviewWhich,
  systemFacesNeedingPreviewCss,
  type PreviewUrlCache,
  type PreviewWhich,
} from '@/lib/preview'
import type { CatalogEntry, SystemFace } from '@/lib/types'

const REFRESH_MS = 15 * 60 * 1000

type PreviewFaceSession = {
  catalogStyles: Map<string, HTMLStyleElement>
  systemStyles: Map<string, HTMLStyleElement>
  urls: PreviewUrlCache
  catalogFingerprints: Map<string, string>
  systemFingerprints: Map<string, string>
}

const previewFaceSession: PreviewFaceSession = {
  catalogStyles: new Map(),
  systemStyles: new Map(),
  urls: new Map(),
  catalogFingerprints: new Map(),
  systemFingerprints: new Map(),
}

function cssFamily(id: string, which?: PreviewWhich): string {
  return which ? `fc-${id}-${which}` : `fc-${id}`
}

function hashPath(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return `sys-${Math.abs(hash).toString(36)}`
}

export function catalogFontFamily(id: string, which?: PreviewWhich): string {
  return cssFamily(id, which)
}

export function systemFontFamily(path: string): string {
  return hashPath(path)
}

async function catalogEntryCss(
  entry: CatalogEntry,
  secret: string,
  cache: PreviewUrlCache,
  refresh: boolean,
): Promise<string> {
  const which = catalogPreviewWhich(entry)
  const defaultUrl = await cachedSignedCatalogFontUrl(cache, entry, which, secret, { refresh })
  const installedUrl = await cachedSignedCatalogFontUrl(cache, entry, 'installed', secret, { refresh })
  const faces = [
    ...catalogFontFaceRules(cssFamily(entry.id), defaultUrl, entry.faces),
    ...catalogFontFaceRules(cssFamily(entry.id, 'installed'), installedUrl, entry.faces),
  ]
  if (entry.sourcePath && entry.sourcePath !== entry.installedPath && entry.sourcePresent !== false) {
    const sourceUrl = await cachedSignedCatalogFontUrl(cache, entry, 'source', secret, { refresh })
    faces.push(...catalogFontFaceRules(cssFamily(entry.id, 'source'), sourceUrl, entry.faces))
  }
  return faces.join('\n')
}

async function systemPathCss(
  faces: Array<Pick<SystemFace, 'path' | 'weight' | 'italic' | 'isVariable'>>,
  secret: string,
  cache: PreviewUrlCache,
  refresh: boolean,
): Promise<string> {
  const filePath = faces[0]?.path
  if (!filePath) return ''
  const url = await cachedSignedSystemFontUrl(cache, filePath, secret, { refresh })
  return catalogFontFaceRules(hashPath(filePath), url, faces).join('\n')
}

function ensureStyle(
  map: Map<string, HTMLStyleElement>,
  key: string,
  attr: string,
): HTMLStyleElement {
  const existing = map.get(key)
  if (existing) return existing
  const style = document.createElement('style')
  style.setAttribute(attr, key)
  document.head.append(style)
  map.set(key, style)
  return style
}

function pruneStyles(map: Map<string, HTMLStyleElement>, keep: Set<string>) {
  for (const [key, style] of map) {
    if (keep.has(key)) continue
    style.remove()
    map.delete(key)
  }
}

export function FontFaceStyles({
  entries,
  catalog,
  systemFaces,
  systemCatalog,
}: {
  entries: CatalogEntry[]
  catalog?: CatalogEntry[]
  systemFaces: SystemFace[]
  systemCatalog?: SystemFace[]
}) {
  const entriesRef = useRef(entries)
  const catalogRef = useRef(catalog)
  const systemFacesRef = useRef(systemFaces)
  const systemCatalogRef = useRef(systemCatalog)
  const catalogWindowKey = useMemo(
    () => entries.map((entry) => `${entry.id}:${catalogPreviewFingerprint(entry)}`).join('\n'),
    [entries],
  )
  const catalogRetainKey = useMemo(() => {
    if (!catalog) return ''
    let latest = 0
    for (const item of catalog) {
      if (item.updatedAt > latest) latest = item.updatedAt
    }
    return `${catalog.length}:${latest}`
  }, [catalog])
  const systemWindowKey = useMemo(
    () => systemFaces.map((face) => `${face.path}:${face.familyName ?? ''}`).join('\n'),
    [systemFaces],
  )
  const systemRetainKey = useMemo(() => String(systemCatalog?.length ?? 0), [systemCatalog])

  useEffect(() => {
    entriesRef.current = entries
    catalogRef.current = catalog
    systemFacesRef.current = systemFaces
    systemCatalogRef.current = systemCatalog
  })

  useEffect(() => {
    const styles = previewFaceSession.catalogStyles
    const cache = previewFaceSession.urls
    let cancelled = false

    async function apply(refresh: boolean) {
      try {
        const secret = await getApiToken()
        const nextEntries = entriesRef.current
        const { keep, changed, fingerprints } = catalogEntriesNeedingPreviewCss(
          nextEntries,
          previewFaceSession.catalogFingerprints,
          {
            refresh,
            mounted: new Set(styles.keys()),
            catalog: catalogRef.current,
          },
        )
        const cssById = await Promise.all(
          changed.map(async (entry) => [entry.id, await catalogEntryCss(entry, secret, cache, refresh)] as const),
        )
        if (cancelled) return
        for (const [id, css] of cssById) {
          const style = ensureStyle(styles, id, 'data-font-butler-face')
          if (style.textContent !== css) style.textContent = css
        }
        pruneStyles(styles, keep)
        previewFaceSession.catalogFingerprints = fingerprints
      } catch {
        // Keep already-mounted @font-face rules; a signing blip must not blank cards.
      }
    }

    void apply(false)
    const timer = window.setInterval(() => void apply(true), REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [catalogWindowKey, catalogRetainKey])

  useEffect(() => {
    const styles = previewFaceSession.systemStyles
    const cache = previewFaceSession.urls
    let cancelled = false

    async function apply(refresh: boolean) {
      try {
        const secret = await getApiToken()
        const nextFaces = systemFacesRef.current
        const { keep, changed, fingerprints } = systemFacesNeedingPreviewCss(
          nextFaces,
          previewFaceSession.systemFingerprints,
          {
            refresh,
            mounted: new Set(styles.keys()),
            catalog: systemCatalogRef.current,
          },
        )
        const cssByKey = await Promise.all(
          changed.map(async (group) => [group.key, await systemPathCss(group.faces, secret, cache, refresh)] as const),
        )
        if (cancelled) return
        for (const [key, css] of cssByKey) {
          const style = ensureStyle(styles, key, 'data-font-butler-system')
          if (style.textContent !== css) style.textContent = css
        }
        pruneStyles(styles, keep)
        previewFaceSession.systemFingerprints = fingerprints
      } catch {
        // Keep already-mounted system @font-face rules.
      }
    }

    void apply(false)
    const timer = window.setInterval(() => void apply(true), REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [systemWindowKey, systemRetainKey])

  return null
}

import { useEffect, useRef } from 'react'
import { getApiToken } from '@/lib/api'
import {
  cachedSignedCatalogFontUrl,
  cachedSignedSystemFontUrl,
  catalogFontFaceRules,
  catalogPreviewFingerprintSet,
  catalogPreviewWhich,
  systemPreviewFingerprintSet,
  type PreviewUrlCache,
  type PreviewWhich,
} from '@/lib/preview'
import type { CatalogEntry, SystemFace } from '@/lib/types'

const REFRESH_MS = 15 * 60 * 1000

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
  if (entry.sourcePath && entry.sourcePath !== entry.installedPath) {
    const sourceUrl = await cachedSignedCatalogFontUrl(cache, entry, 'source', secret, { refresh })
    faces.push(...catalogFontFaceRules(cssFamily(entry.id, 'source'), sourceUrl, entry.faces))
  }
  return faces.join('\n')
}

async function systemFaceCss(
  face: SystemFace,
  secret: string,
  cache: PreviewUrlCache,
  refresh: boolean,
): Promise<string> {
  const url = await cachedSignedSystemFontUrl(cache, face.path, secret, { refresh })
  const weight = face.isVariable ? '1 1000' : face.weight ? String(face.weight) : '400'
  return `@font-face{font-family:"${hashPath(face.path)}";src:url("${url}");font-weight:${weight};font-display:swap;}`
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
  systemFaces,
}: {
  entries: CatalogEntry[]
  systemFaces: SystemFace[]
}) {
  const catalogStylesRef = useRef<Map<string, HTMLStyleElement>>(new Map())
  const systemStylesRef = useRef<Map<string, HTMLStyleElement>>(new Map())
  const cacheRef = useRef<PreviewUrlCache>(new Map())
  const entriesRef = useRef(entries)
  const systemFacesRef = useRef(systemFaces)
  const catalogFingerprint = catalogPreviewFingerprintSet(entries)
  const systemFingerprint = systemPreviewFingerprintSet(systemFaces)

  useEffect(() => {
    entriesRef.current = entries
    systemFacesRef.current = systemFaces
  })

  useEffect(() => {
    const styles = catalogStylesRef.current
    const cache = cacheRef.current
    let cancelled = false

    async function apply(refresh: boolean) {
      try {
        const secret = await getApiToken()
        const nextEntries = entriesRef.current
        const keep = new Set<string>()
        for (const entry of nextEntries) {
          keep.add(entry.id)
          const css = await catalogEntryCss(entry, secret, cache, refresh)
          if (cancelled) return
          const style = ensureStyle(styles, entry.id, 'data-font-butler-face')
          if (style.textContent !== css) style.textContent = css
        }
        if (!cancelled) pruneStyles(styles, keep)
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
  }, [catalogFingerprint])

  useEffect(() => {
    if (!systemFingerprint) return
    const styles = systemStylesRef.current
    const cache = cacheRef.current
    let cancelled = false

    async function apply(refresh: boolean) {
      try {
        const secret = await getApiToken()
        const nextFaces = systemFacesRef.current
        const keep = new Set<string>()
        for (const face of nextFaces) {
          keep.add(face.path)
          const css = await systemFaceCss(face, secret, cache, refresh)
          if (cancelled) return
          const style = ensureStyle(styles, face.path, 'data-font-butler-system')
          if (style.textContent !== css) style.textContent = css
        }
        if (!cancelled) pruneStyles(styles, keep)
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
  }, [systemFingerprint])

  useEffect(() => {
    const catalogStyles = catalogStylesRef.current
    const systemStyles = systemStylesRef.current
    return () => {
      pruneStyles(catalogStyles, new Set())
      pruneStyles(systemStyles, new Set())
    }
  }, [])

  return null
}

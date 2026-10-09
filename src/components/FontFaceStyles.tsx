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
import {
  invalidatePreviewReadyFamilies,
  notifyPreviewCssMounted,
  previewRetryGeneration,
  subscribePreviewRetries,
  withRetryParam,
} from '@/lib/previewReady'
import type { CatalogEntry, SystemFace } from '@/lib/types'

const REFRESH_MS = 15 * 60 * 1000
let previewFaceRefreshMs = REFRESH_MS
let previewCssWriteGate: (() => Promise<void>) | null = null

export function setPreviewFaceRefreshForTests(ms: number): void {
  previewFaceRefreshMs = ms
}

/** Pause after preview CSS is built and before it is written, so tests can bump the retry counter mid-refresh. */
export function setPreviewCssWriteGateForTests(gate: (() => Promise<void>) | null): void {
  previewCssWriteGate = gate
}

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

function bustedPreviewUrl(url: string, family: string): string {
  return withRetryParam(url, previewRetryGeneration(family))
}

async function catalogEntryCss(
  entry: CatalogEntry,
  secret: string,
  cache: PreviewUrlCache,
  refresh: boolean,
): Promise<string> {
  const which = catalogPreviewWhich(entry)
  const defaultFamily = cssFamily(entry.id)
  const installedFamily = cssFamily(entry.id, 'installed')
  const defaultSigned = await cachedSignedCatalogFontUrl(cache, entry, which, secret, { refresh })
  const installedSigned = await cachedSignedCatalogFontUrl(cache, entry, 'installed', secret, { refresh })
  let sourceSigned = ''
  const sourceFamily = cssFamily(entry.id, 'source')
  const includeSource = Boolean(
    entry.sourcePath && entry.sourcePath !== entry.installedPath && entry.sourcePresent !== false,
  )
  if (includeSource) {
    sourceSigned = await cachedSignedCatalogFontUrl(cache, entry, 'source', secret, { refresh })
  }
  const faces = [
    ...catalogFontFaceRules(defaultFamily, bustedPreviewUrl(defaultSigned, defaultFamily), entry.faces),
    ...catalogFontFaceRules(installedFamily, bustedPreviewUrl(installedSigned, installedFamily), entry.faces),
  ]
  if (includeSource) {
    faces.push(...catalogFontFaceRules(sourceFamily, bustedPreviewUrl(sourceSigned, sourceFamily), entry.faces))
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
  const family = hashPath(filePath)
  const signed = await cachedSignedSystemFontUrl(cache, filePath, secret, { refresh })
  return catalogFontFaceRules(family, bustedPreviewUrl(signed, family), faces).join('\n')
}

const FONT_FACE_RULE = 5

function quotedFamily(rule: string): string | null {
  return rule.match(/font-family:\s*["']([^"']+)["']/)?.[1] ?? null
}

function rewriteStyleRule(rule: string, family: string, generation: number): string {
  if (quotedFamily(rule) !== family || generation <= 0) return rule
  return rule.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/g, (match, doubleQuoted: string | undefined, singleQuoted: string | undefined, bare: string | undefined) => {
    const url = doubleQuoted ?? singleQuoted ?? bare ?? ''
    const next = withRetryParam(url, generation)
    return next === url ? match : `url("${next}")`
  })
}

function cssWithRetryCounters(css: string): string {
  return css
    .split('\n')
    .map((rule) => {
      const family = quotedFamily(rule)
      if (!family) return rule
      return rewriteStyleRule(rule, family, previewRetryGeneration(family))
    })
    .join('\n')
}

function fontFaceFamily(rule: CSSRule): string | null {
  if (rule.type !== FONT_FACE_RULE) return null
  const raw = (rule as CSSFontFaceRule).style.getPropertyValue('font-family')
  return raw.replace(/^["']+|["']+$/g, '').trim() || null
}

function bustFontFaceCss(cssText: string, generation: number): string {
  return cssText.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/g, (match, doubleQuoted: string | undefined, singleQuoted: string | undefined, bare: string | undefined) => {
    const url = doubleQuoted ?? singleQuoted ?? bare ?? ''
    const next = withRetryParam(url, generation)
    return next === url ? match : `url("${next}")`
  })
}

function rewriteStyleText(style: HTMLStyleElement, family: string, generation: number) {
  const css = style.textContent ?? ''
  const next = css
    .split('\n')
    .map((rule) => rewriteStyleRule(rule, family, generation))
    .join('\n')
  if (next !== css) style.textContent = next
}

function replaceFamilyRules(style: HTMLStyleElement, family: string, generation: number) {
  const sheet = style.sheet
  if (!sheet || generation <= 0) {
    rewriteStyleText(style, family, generation)
    return
  }
  const matches: Array<{ index: number; cssText: string }> = []
  for (let index = 0; index < sheet.cssRules.length; index += 1) {
    const rule = sheet.cssRules[index]
    if (!rule || fontFaceFamily(rule) !== family) continue
    const next = bustFontFaceCss(rule.cssText, generation)
    if (next === rule.cssText) continue
    matches.push({ index, cssText: next })
  }
  if (matches.length === 0) {
    if (!cssContainsFamily(style.textContent ?? '', family)) return
    rewriteStyleText(style, family, generation)
    return
  }
  try {
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index]!
      sheet.deleteRule(match.index)
      sheet.insertRule(match.cssText, match.index)
    }
  } catch {
    rewriteStyleText(style, family, generation)
  }
}

function cssContainsFamily(css: string, family: string): boolean {
  return css.split('\n').some((rule) => quotedFamily(rule) === family)
}

function rewriteMountedFamily(family: string, generation: number) {
  const maps = [previewFaceSession.catalogStyles, previewFaceSession.systemStyles]
  for (const map of maps) {
    for (const style of map.values()) {
      replaceFamilyRules(style, family, generation)
    }
  }
}

subscribePreviewRetries(rewriteMountedFamily)

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

function pruneStyles(
  map: Map<string, HTMLStyleElement>,
  keep: Set<string>,
  familiesForKey: (key: string) => string[],
) {
  const pruned: string[] = []
  for (const [key, style] of map) {
    if (keep.has(key)) continue
    style.remove()
    map.delete(key)
    pruned.push(...familiesForKey(key))
  }
  if (pruned.length > 0) invalidatePreviewReadyFamilies(pruned)
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
        const previousFingerprints = previewFaceSession.catalogFingerprints
        const { keep, changed, fingerprints } = catalogEntriesNeedingPreviewCss(
          nextEntries,
          previousFingerprints,
          {
            refresh,
            mounted: new Set(styles.keys()),
            catalog: catalogRef.current,
          },
        )
        // Drop cached readiness only when preview bytes actually changed; re-sign
        // refreshes and tab switches keep the session cache so cards render instantly.
        const bytesChanged = changed.filter(
          (entry) =>
            previousFingerprints.has(entry.id) &&
            previousFingerprints.get(entry.id) !== fingerprints.get(entry.id),
        )
        if (bytesChanged.length > 0) {
          invalidatePreviewReadyFamilies(
            bytesChanged.flatMap((entry) => [
              cssFamily(entry.id),
              cssFamily(entry.id, 'installed'),
              cssFamily(entry.id, 'source'),
            ]),
          )
        }
        const cssById = await Promise.all(
          changed.map(async (entry) => [entry.id, await catalogEntryCss(entry, secret, cache, refresh)] as const),
        )
        if (previewCssWriteGate) await previewCssWriteGate()
        if (cancelled) return
        for (const [id, css] of cssById) {
          const style = ensureStyle(styles, id, 'data-font-butler-face')
          const next = cssWithRetryCounters(css)
          if (style.textContent !== next) style.textContent = next
        }
        pruneStyles(styles, keep, (id) => [
          cssFamily(id),
          cssFamily(id, 'installed'),
          cssFamily(id, 'source'),
        ])
        previewFaceSession.catalogFingerprints = fingerprints
        if (cssById.length > 0) notifyPreviewCssMounted()
      } catch {
        // Keep already-mounted @font-face rules; a signing blip must not blank cards.
      }
    }

    void apply(false)
    const timer = window.setInterval(() => void apply(true), previewFaceRefreshMs)
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
        const previousFingerprints = previewFaceSession.systemFingerprints
        const { keep, changed, fingerprints } = systemFacesNeedingPreviewCss(
          nextFaces,
          previousFingerprints,
          {
            refresh,
            mounted: new Set(styles.keys()),
            catalog: systemCatalogRef.current,
          },
        )
        const bytesChanged = changed.filter(
          (group) =>
            previousFingerprints.has(group.key) &&
            previousFingerprints.get(group.key) !== fingerprints.get(group.key),
        )
        if (bytesChanged.length > 0) {
          invalidatePreviewReadyFamilies(bytesChanged.map((group) => systemFontFamily(group.path)))
        }
        const cssByKey = await Promise.all(
          changed.map(async (group) => [group.key, await systemPathCss(group.faces, secret, cache, refresh)] as const),
        )
        if (previewCssWriteGate) await previewCssWriteGate()
        if (cancelled) return
        for (const [key, css] of cssByKey) {
          const style = ensureStyle(styles, key, 'data-font-butler-system')
          const next = cssWithRetryCounters(css)
          if (style.textContent !== next) style.textContent = next
        }
        pruneStyles(styles, keep, (key) => [systemFontFamily(key.split('\t')[0] ?? key)])
        previewFaceSession.systemFingerprints = fingerprints
        if (cssByKey.length > 0) notifyPreviewCssMounted()
      } catch {
        // Keep already-mounted system @font-face rules.
      }
    }

    void apply(false)
    const timer = window.setInterval(() => void apply(true), previewFaceRefreshMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [systemWindowKey, systemRetainKey])

  return null
}

import { useEffect } from 'react'
import { getApiToken } from '@/lib/api'
import {
  catalogFontFaceRules,
  signedCatalogFontUrl,
  signedSystemFontUrl,
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

async function previewCss(entries: CatalogEntry[], systemFaces: SystemFace[], secret: string): Promise<string> {
  const catalogRules = await Promise.all(
    entries.map(async (entry) => {
      const defaultUrl = await signedCatalogFontUrl(entry, 'installed', secret)
      const installedUrl = await signedCatalogFontUrl(entry, 'installed', secret)
      const faces = [
        ...catalogFontFaceRules(cssFamily(entry.id), defaultUrl, entry.faces),
        ...catalogFontFaceRules(cssFamily(entry.id, 'installed'), installedUrl, entry.faces),
      ]
      if (entry.sourcePath && entry.sourcePath !== entry.installedPath) {
        const sourceUrl = await signedCatalogFontUrl(entry, 'source', secret)
        faces.push(...catalogFontFaceRules(cssFamily(entry.id, 'source'), sourceUrl, entry.faces))
      }
      return faces
    }),
  )
  const systemRules = await Promise.all(
    systemFaces.map(async (face) => {
      const url = await signedSystemFontUrl(face.path, secret)
      return `@font-face{font-family:"${hashPath(face.path)}";src:url("${url}");font-display:swap;}`
    }),
  )
  return [...catalogRules.flat(), ...systemRules].join('\n')
}

export function FontFaceStyles({
  entries,
  systemFaces,
}: {
  entries: CatalogEntry[]
  systemFaces: SystemFace[]
}) {
  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-font-butler-faces', 'true')
    document.head.append(style)
    let cancelled = false

    async function apply() {
      try {
        const secret = await getApiToken()
        const css = await previewCss(entries, systemFaces, secret)
        if (!cancelled) style.textContent = css
      } catch {
        if (!cancelled) style.textContent = ''
      }
    }

    void apply()
    const timer = window.setInterval(() => void apply(), REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      style.remove()
    }
  }, [entries, systemFaces])

  return null
}

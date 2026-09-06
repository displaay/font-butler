import { useEffect } from 'react'
import {
  catalogFontFaceRules,
  catalogFontUrl,
  systemFontUrl,
  type PreviewWhich,
} from '@/lib/preview'
import type { CatalogEntry, SystemFace } from '@/lib/types'

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

export function FontFaceStyles({
  entries,
  systemFaces,
}: {
  entries: CatalogEntry[]
  systemFaces: SystemFace[]
}) {
  const css = [
    ...entries.flatMap((entry) => {
      const faces = [
        ...catalogFontFaceRules(cssFamily(entry.id), catalogFontUrl(entry), entry.faces),
        ...catalogFontFaceRules(
          cssFamily(entry.id, 'installed'),
          catalogFontUrl(entry, 'installed'),
          entry.faces,
        ),
      ]
      if (entry.sourcePath && entry.sourcePath !== entry.installedPath) {
        faces.push(
          ...catalogFontFaceRules(
            cssFamily(entry.id, 'source'),
            catalogFontUrl(entry, 'source'),
            entry.faces,
          ),
        )
      }
      return faces
    }),
    ...systemFaces.map(
      (face) =>
        `@font-face{font-family:"${hashPath(face.path)}";src:url("${systemFontUrl(face.path)}");font-display:swap;}`,
    ),
  ].join('\n')

  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-font-butler-faces', 'true')
    style.textContent = css
    document.head.append(style)
    return () => style.remove()
  }, [css])

  return null
}

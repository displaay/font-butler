import { useEffect } from 'react'
import type { CatalogEntry, SystemFace } from '@/lib/types'

function cssFamily(id: string): string {
  return `fc-${id}`
}

function hashPath(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return `sys-${Math.abs(hash).toString(36)}`
}

export function catalogFontFamily(id: string): string {
  return cssFamily(id)
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
    ...entries.map(
      (entry) =>
        `@font-face{font-family:"${cssFamily(entry.id)}";src:url("/api/font-file/${entry.id}");font-display:swap;}`,
    ),
    ...systemFaces.map(
      (face) =>
        `@font-face{font-family:"${hashPath(face.path)}";src:url("/api/system-font?path=${encodeURIComponent(face.path)}");font-display:swap;}`,
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

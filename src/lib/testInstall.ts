import type { CatalogEntry, FontFaceInfo } from './types'

export type TestInstallFont = {
  id: string
  path: string
  familyName: string
  styleName: string
  fullName: string
  postscriptName: string
  isVariable: boolean
  instanceCount: number
  instanceNames: string[]
  weight: number
  italic: boolean
  format: string
  previewSample?: string
  mtimeMs: number
  size: number
  faces: FontFaceInfo[]
}

export function testInstallMenuLabels(): string[] {
  return ['Uninstall']
}

export function showTestInstallFolder(count: number): boolean {
  return count > 0
}

export function testInstallToCatalog(fonts: TestInstallFont[]): CatalogEntry[] {
  return fonts.map((font) => ({
    id: font.id,
    sourcePath: font.path,
    sourceMtimeMs: font.mtimeMs,
    sourceSize: font.size,
    sourcePresent: true,
    status: 'installed',
    installedPath: font.path,
    faces: font.faces,
    format: font.format,
    previewSample: font.previewSample,
    addedAt: font.mtimeMs,
    updatedAt: font.mtimeMs,
  }))
}

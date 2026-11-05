/** Shared helpers for the document font sheet. No filesystem access. */

export type DocumentFontStatus = 'on' | 'in-library-off' | 'missing'

export type DocumentFontRow = {
  postscriptName: string
  familyName: string
  styleName: string
  status: DocumentFontStatus
  assetId?: string
  /** Every asset when a family name matched several styles. None of them is pinned. */
  assetIds?: string[]
  installedFingerprint?: string
  matchedBy?: 'postscript' | 'family-style' | 'family'
}

export type DocumentFontReport = {
  path: string
  kind: 'pdf' | 'idml' | 'docx' | 'pptx' | 'indd' | 'ai' | 'psd'
  fonts: DocumentFontRow[]
}

const DOCUMENT_FONT_EXTENSION = /\.(pdf|idml|docx|pptx|indd|indt|ai|psd|psb)$/i

export function isDocumentFontPath(filePath: string): boolean {
  return DOCUMENT_FONT_EXTENSION.test(filePath)
}

export function documentPathsFrom(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const documents: string[] = []
  for (const filePath of paths) {
    if (!filePath || !isDocumentFontPath(filePath) || seen.has(filePath)) continue
    seen.add(filePath)
    documents.push(filePath)
  }
  return documents
}

export function withoutDocumentPaths(paths: readonly string[]): string[] {
  return paths.filter((filePath) => !isDocumentFontPath(filePath))
}

/** File name without a document extension, or an explicit name when one was given. */
export function documentProjectName(filePath: string, requested = ''): string {
  const trimmed = requested.trim()
  if (trimmed) return trimmed
  const base = filePath.split(/[/\\]/).pop() ?? ''
  const stripped = base.replace(DOCUMENT_FONT_EXTENSION, '').trim()
  return stripped || 'Untitled project'
}

export function documentFontLabel(font: {
  postscriptName?: string
  familyName?: string
  styleName?: string
}): string {
  const family = font.familyName?.trim() ?? ''
  const style = font.styleName?.trim() ?? ''
  const postscript = font.postscriptName?.trim() ?? ''
  if (family && style) return `${family} ${style}`
  if (family) return family
  if (postscript) return postscript
  return 'Unnamed font'
}

export function groupDocumentFonts<T extends { status: string }>(fonts: readonly T[]): {
  on: T[]
  off: T[]
  missing: T[]
} {
  const on: T[] = []
  const off: T[] = []
  const missing: T[] = []
  for (const font of fonts) {
    if (font.status === 'on') on.push(font)
    else if (font.status === 'in-library-off') off.push(font)
    else missing.push(font)
  }
  return { on, off, missing }
}

/** Catalog assets named by one document font row. A multi-style family lists every asset. */
export function documentFontAssetIds(font: { assetId?: string; assetIds?: readonly string[] }): string[] {
  const listed = (font.assetIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0)
  const source = listed.length > 0 ? listed : font.assetId?.trim() ? [font.assetId.trim()] : []
  const ids: string[] = []
  const seen = new Set<string>()
  for (const id of source) {
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** Library faces the sheet can activate. Missing names are never included. */
export function offAssetIds(
  fonts: readonly { status: string; assetId?: string; assetIds?: readonly string[] }[],
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const font of fonts) {
    if (font.status !== 'in-library-off') continue
    for (const assetId of documentFontAssetIds(font)) {
      if (seen.has(assetId)) continue
      seen.add(assetId)
      ids.push(assetId)
    }
  }
  return ids
}

/** Display names for missing faces. These are names only — there is no file to reveal. */
export function missingFontLabels(
  fonts: readonly { status: string; postscriptName?: string; familyName?: string; styleName?: string }[],
): string[] {
  return fonts.filter((font) => font.status === 'missing').map((font) => documentFontLabel(font))
}

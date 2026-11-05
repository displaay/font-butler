import { isDroppedFontName } from './drop.ts'
import type { CatalogEntry } from './types.ts'

export {
  COMPARE_DEFAULT_SIZE,
  COMPARE_LIMIT,
  COMPARE_PLACEHOLDER,
  COMPARE_SIZE_MAX,
  COMPARE_SIZE_MIN,
  COMPARE_SIZE_STEPS,
  COMPARE_TINTS,
  addCompareFamilies,
  addDroppedFiles,
  automaticFace,
  clampCompareSize,
  compareAnotherStyle,
  compareCandidates,
  compareSizeStep,
  emptyCompare,
  familyIdForName,
  isCompareFull,
  moveCompareEntry,
  removeCompareEntry,
  removeCompareFamily,
  replaceCompareFamilies,
  replaceCompareFiles,
  resolvedCompareFace,
  setCompareStyle,
  setCompareTint,
} from '../../shared/compare.ts'
export type { CompareEntry, CompareFace, CompareFamily, CompareLayout, CompareModel } from '../../shared/compare.ts'

/** The file Compare should read for a library font. Missing sources are skipped. */
export function comparePathForEntry(entry: CatalogEntry): string | null {
  const installed = entry.installedPath?.trim() || ''
  const disabled = entry.disabledPath?.trim() || ''
  const source = entry.sourcePath?.trim() || ''
  if (entry.status === 'deactivated' && disabled) return disabled
  if ((entry.status === 'installed' || entry.status === 'outdated') && installed) return installed
  if (source && entry.sourcePresent !== false) return source
  return installed || disabled || source || null
}

export function compareCssFamily(faceId: string): string {
  let hash = 0
  for (let i = 0; i < faceId.length; i++) hash = (hash * 31 + faceId.charCodeAt(i)) | 0
  return `cmp-${Math.abs(hash).toString(36)}`
}

/**
 * Paths a drop should add to Compare: font files, including WOFF, and folders
 * of fonts. Other files are left out so a drop does not import them.
 */
export function compareDropPaths(payload: {
  paths: string[]
  files: Array<{ name: string; path?: string }>
  folders?: string[]
}): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined, folder = false) => {
    const filePath = value?.trim()
    if (!filePath || seen.has(filePath)) return
    if (!folder && !isDroppedFontName(filePath)) return
    seen.add(filePath)
    out.push(filePath)
  }
  for (const folder of payload.folders ?? []) add(folder, true)
  for (const filePath of payload.paths) add(filePath)
  for (const file of payload.files) add(file.path)
  return out
}

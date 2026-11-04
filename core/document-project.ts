import type { DocumentFontReport } from './document-fonts.ts'
import type { ProjectUnresolvedFont } from './types.ts'
import { documentProjectName } from '../shared/document-project.ts'

export { documentProjectName }

export type DocumentProjectDraft = {
  memberIds: string[]
  /** Pin only when the report already carried this cut's installed fingerprint. */
  pins: Record<string, string>
  unresolved: ProjectUnresolvedFont[]
}

/**
 * Members are matched asset ids. A missing name is stored, never added as a member.
 * `pinFingerprint` is copied from `installedFingerprint` when that field is present.
 * The parser leaves it empty for a library face that is off, and for a family+style
 * match of a different PostScript cut, so this does not invent a pin.
 * Two different fingerprints for one asset are left unpinned.
 */
export function documentProjectDraft(report: DocumentFontReport): DocumentProjectDraft {
  const memberIds: string[] = []
  const seenMembers = new Set<string>()
  const pinState = new Map<string, { value?: string; conflict: boolean }>()
  const unresolved: ProjectUnresolvedFont[] = []
  const seenMissing = new Set<string>()
  const sourceFile = report.path

  for (const font of report.fonts) {
    const assetId = font.assetId?.trim()
    if (font.status === 'missing' || !assetId) {
      const postscriptName = font.postscriptName.trim()
      const familyName = font.familyName.trim()
      const styleName = font.styleName.trim()
      if (!postscriptName && !familyName) continue
      const key = [postscriptName.toLowerCase(), familyName.toLowerCase(), styleName.toLowerCase(), sourceFile].join('\0')
      if (seenMissing.has(key)) continue
      seenMissing.add(key)
      unresolved.push({ postscriptName, familyName, styleName, sourceFile })
      continue
    }
    if (!seenMembers.has(assetId)) {
      seenMembers.add(assetId)
      memberIds.push(assetId)
    }
    const fingerprint = font.installedFingerprint?.trim()
    if (!fingerprint) continue
    const slot = pinState.get(assetId) ?? { conflict: false }
    if (slot.value && slot.value !== fingerprint) slot.conflict = true
    else slot.value = fingerprint
    pinState.set(assetId, slot)
  }

  const pins: Record<string, string> = {}
  for (const [assetId, slot] of pinState) {
    if (slot.value && !slot.conflict) pins[assetId] = slot.value
  }
  return { memberIds, pins, unresolved }
}

/**
 * Cicero Compare, adapted for any font file.
 *
 * Matched to Sources/Cicero/Windows/CompareWindow.swift and the Compare fonts
 * section of help/browsing.md: one shared sample, Stacked rows or an Overlay,
 * a style menu per row, and a size of the window's own (24–720 pt).
 */

export const COMPARE_LIMIT = 12
export const COMPARE_PLACEHOLDER = 'Hamburgefonstiv'
export const COMPARE_SIZE_MIN = 24
export const COMPARE_SIZE_MAX = 720
export const COMPARE_DEFAULT_SIZE = 72
/** Each step is about a fifth to a third larger than the one before, as in CompareWindow.steps. */
export const COMPARE_SIZE_STEPS = [24, 30, 36, 48, 60, 72, 96, 120, 144, 192, 240, 288, 384, 480, 576, 720] as const

export const COMPARE_TINTS = [
  { title: 'Blue', color: '#007aff' },
  { title: 'Red', color: '#ff3b30' },
  { title: 'Green', color: '#34c759' },
  { title: 'Orange', color: '#ff9500' },
  { title: 'Purple', color: '#af52de' },
  { title: 'Pink', color: '#ff2d55' },
  { title: 'Teal', color: '#5ac8fa' },
  { title: 'Indigo', color: '#5856d6' },
  { title: 'Brown', color: '#a2845e' },
  { title: 'Cyan', color: '#32ade6' },
  { title: 'Mint', color: '#00c7be' },
  { title: 'Yellow', color: '#ffcc00' },
] as const

export type CompareLayout = 'stacked' | 'overlay'

export type CompareFace = {
  id: string
  styleName: string
  weight: number
  italic: boolean
  postscriptName: string
  /** Real path of the font file. Not a catalog id. */
  filePath: string
  faceIndex: number
  isVariable?: boolean
}

export type CompareFamily = {
  id: string
  name: string
  faces: CompareFace[]
}

export type CompareEntry = {
  id: string
  familyId: string
  /** null follows Automatic (the upright face nearest Regular). */
  styleId: string | null
  tint: number
}

export type CompareModel = {
  entries: CompareEntry[]
  families: CompareFamily[]
}

export function familyIdForName(name: string): string {
  return `family:${name.trim().toLocaleLowerCase()}`
}

export function emptyCompare(): CompareModel {
  return { entries: [], families: [] }
}

export function isCompareFull(model: CompareModel): boolean {
  return model.entries.length >= COMPARE_LIMIT
}

export function clampCompareSize(size: number): number {
  if (!Number.isFinite(size)) return COMPARE_DEFAULT_SIZE
  return Math.min(COMPARE_SIZE_MAX, Math.max(COMPARE_SIZE_MIN, Math.round(size)))
}

export function compareSizeStep(size: number, direction: 1 | -1): number {
  const current = clampCompareSize(size)
  if (direction > 0) {
    return COMPARE_SIZE_STEPS.find((step) => step > current) ?? COMPARE_SIZE_MAX
  }
  const smaller = [...COMPARE_SIZE_STEPS].reverse().find((step) => step < current)
  return smaller ?? COMPARE_SIZE_MIN
}

export function automaticFace(family: CompareFamily): CompareFace | undefined {
  const faces = family.faces
  if (faces.length === 0) return undefined
  const upright = faces.filter((face) => !face.italic)
  const pool = upright.length > 0 ? upright : faces
  return pool.reduce((best, face) =>
    Math.abs(face.weight - 400) < Math.abs(best.weight - 400) ? face : best,
  )
}

export function resolvedCompareFace(entry: CompareEntry, family: CompareFamily): CompareFace | undefined {
  if (entry.styleId) {
    const chosen = family.faces.find((face) => face.id === entry.styleId)
    if (chosen) return chosen
  }
  return automaticFace(family)
}

export function compareCandidates<T extends { name: string }>(families: T[], query: string): T[] {
  const text = query.trim().toLocaleLowerCase()
  if (!text) return families
  return families.filter((family) => {
    const name = family.name.toLocaleLowerCase()
    if (name.startsWith(text)) return true
    return name.split(/\s+/).some((word) => word.startsWith(text))
  })
}

function nextEntryId(): string {
  const cryptoRef = globalThis.crypto
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID()
  return `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function mergeFamilies(current: CompareFamily[], incoming: CompareFamily[]): CompareFamily[] {
  const families = current.map((family) => ({ ...family, faces: [...family.faces] }))
  for (const family of incoming) {
    const found = families.find((item) => item.id === family.id)
    if (!found) {
      families.push({ ...family, faces: [...family.faces] })
      continue
    }
    if (!found.name && family.name) found.name = family.name
    const seen = new Set(found.faces.map((face) => face.id))
    for (const face of family.faces) {
      if (seen.has(face.id)) continue
      found.faces.push(face)
      seen.add(face.id)
    }
  }
  return families
}

/**
 * An Automatic row follows the upright face nearest Regular. Merging a closer
 * face would retarget that row and hide the style it was showing. Pin it to
 * the face it resolved to before the merge.
 */
function pinShiftedAutomaticRows(model: CompareModel, families: CompareFamily[]): CompareEntry[] {
  return model.entries.map((entry) => {
    if (entry.styleId) return entry
    const previous = model.families.find((item) => item.id === entry.familyId)
    const next = families.find((item) => item.id === entry.familyId)
    if (!previous || !next) return entry
    const previousId = automaticFace(previous)?.id
    const nextId = automaticFace(next)?.id
    if (!previousId || !nextId || previousId === nextId) return entry
    return { ...entry, styleId: previousId }
  })
}

function withEntry(model: CompareModel, familyId: string, styleId: string | null): CompareModel {
  if (model.entries.length >= COMPARE_LIMIT) return model
  const family = model.families.find((item) => item.id === familyId)
  if (!family || family.faces.length === 0) return model
  const resolved = styleId ?? automaticFace(family)?.id ?? null
  const already = model.entries.some((entry) => {
    if (entry.familyId !== familyId) return false
    const shown = entry.styleId ?? automaticFace(family)?.id ?? null
    return shown === resolved
  })
  if (already) return model
  return {
    ...model,
    entries: [
      ...model.entries,
      {
        id: nextEntryId(),
        familyId,
        styleId,
        tint: model.entries.length % COMPARE_TINTS.length,
      },
    ],
  }
}

/** Several families start a comparison over. One family joins what is already there as a single Automatic row. */
export function addCompareFamilies(model: CompareModel, incoming: CompareFamily[]): CompareModel {
  const families = mergeFamilies(model.families, incoming)
  let next: CompareModel = { families, entries: pinShiftedAutomaticRows(model, families) }
  for (const family of incoming) {
    if (next.entries.some((entry) => entry.familyId === family.id)) continue
    next = withEntry(next, family.id, null)
  }
  return next
}

export function replaceCompareFamilies(incoming: CompareFamily[]): CompareModel {
  return addCompareFamilies(emptyCompare(), incoming)
}

/** A file selection replaces the comparison with one row per file, including two files of one family. */
export function replaceCompareFiles(incoming: CompareFamily[]): CompareModel {
  return addDroppedFiles(emptyCompare(), incoming)
}

/**
 * A dropped file joins the comparison as its own row.
 * A second file of a family already shown is added in that style.
 */
export function addDroppedFiles(model: CompareModel, incoming: CompareFamily[]): CompareModel {
  const families = mergeFamilies(model.families, incoming)
  let next: CompareModel = { families, entries: pinShiftedAutomaticRows(model, families) }
  for (const family of incoming) {
    const stored = next.families.find((item) => item.id === family.id)
    if (!stored) continue
    for (const face of family.faces) {
      const shown = next.entries.some((entry) => {
        if (entry.familyId !== family.id) return false
        return (entry.styleId ?? automaticFace(stored)?.id) === face.id
      })
      if (shown) continue
      const automatic = automaticFace(stored)?.id === face.id
      const before = next.entries.length
      next = withEntry(next, family.id, automatic ? null : face.id)
      if (next.entries.length === before) return next
    }
  }
  return next
}

export function removeCompareEntry(model: CompareModel, entryId: string): CompareModel {
  return { ...model, entries: model.entries.filter((entry) => entry.id !== entryId) }
}

export function removeCompareFamily(model: CompareModel, familyId: string): CompareModel {
  return {
    entries: model.entries.filter((entry) => entry.familyId !== familyId),
    families: model.families.filter((family) => family.id !== familyId),
  }
}

export function setCompareStyle(model: CompareModel, entryId: string, styleId: string | null): CompareModel {
  return {
    ...model,
    entries: model.entries.map((entry) => (entry.id === entryId ? { ...entry, styleId } : entry)),
  }
}

export function setCompareTint(model: CompareModel, entryId: string, tint: number): CompareModel {
  const index = ((tint % COMPARE_TINTS.length) + COMPARE_TINTS.length) % COMPARE_TINTS.length
  return {
    ...model,
    entries: model.entries.map((entry) => (entry.id === entryId ? { ...entry, tint: index } : entry)),
  }
}

/** Adds the same family again in a style that is not already in the comparison. */
export function compareAnotherStyle(model: CompareModel, entryId: string): CompareModel {
  const entry = model.entries.find((item) => item.id === entryId)
  if (!entry) return model
  const family = model.families.find((item) => item.id === entry.familyId)
  if (!family) return model
  const shown = new Set(
    model.entries
      .filter((item) => item.familyId === family.id)
      .map((item) => item.styleId ?? automaticFace(family)?.id)
      .filter((id): id is string => Boolean(id)),
  )
  const nextFace = family.faces.find((face) => !shown.has(face.id))
  if (!nextFace) return model
  return withEntry(model, family.id, nextFace.id)
}

/** Family ids that still have a visible row. Leftover family metadata does not count. */
export function shownCompareFamilyIds(model: CompareModel): Set<string> {
  return new Set(model.entries.map((entry) => entry.familyId))
}

export function moveCompareEntry(model: CompareModel, entryId: string, beforeId: string): CompareModel {
  if (entryId === beforeId) return model
  const entries = [...model.entries]
  const from = entries.findIndex((entry) => entry.id === entryId)
  const to = entries.findIndex((entry) => entry.id === beforeId)
  if (from < 0 || to < 0) return model
  const [item] = entries.splice(from, 1)
  if (!item) return model
  // Removing an earlier row shifts the target left. Insert before that row.
  entries.splice(from < to ? to - 1 : to, 0, item)
  return { ...model, entries }
}

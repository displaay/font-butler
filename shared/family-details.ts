/**
 * Per-family rating (stars) and comment, stored on the catalog.
 *
 * Keyed by `familyTagKey` (the library card), like family tag assignments.
 * A rating is 1–5 stars; no rating is stored as an absent row/value.
 * Comments are free text. Font Book stores neither; FontExplorer X import
 * fills them per family (highest style rating; comments joined only when
 * the family has none yet).
 */

export type FamilyDetail = {
  familyKey: string
  /** 1–5. Absent when the family has no rating. */
  rating?: number
  /** Absent when the family has no comment. */
  comment?: string
}

export type FamilyDetailCatalog = {
  familyDetails?: FamilyDetail[]
}

export function normalizeFamilyDetails(
  details: readonly FamilyDetail[] | undefined,
): FamilyDetail[] {
  if (!Array.isArray(details)) return []
  const rows: FamilyDetail[] = []
  const seen = new Set<string>()
  for (const row of details) {
    if (!row || typeof row !== 'object') continue
    const familyKey = typeof row.familyKey === 'string' ? row.familyKey.trim() : ''
    if (!familyKey || seen.has(familyKey)) continue
    const rating = cleanRating(row.rating)
    const comment = typeof row.comment === 'string' ? row.comment.trim() : ''
    if (rating === null && !comment) continue
    seen.add(familyKey)
    rows.push({
      familyKey,
      ...(rating !== null ? { rating } : {}),
      ...(comment ? { comment } : {}),
    })
  }
  return rows
}

/** A valid 1–5 star rating, or null for anything else (including clear). */
export function cleanRating(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const stars = Math.round(value)
  return stars >= 1 && stars <= 5 ? stars : null
}

export function cleanComment(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, 2000)
}

export function detailForFamily(
  details: readonly FamilyDetail[] | undefined,
  familyKey: string,
): FamilyDetail | undefined {
  return details?.find((row) => row.familyKey === familyKey)
}

export function ratingForFamily(
  details: readonly FamilyDetail[] | undefined,
  familyKey: string,
): number | null {
  return detailForFamily(details, familyKey)?.rating ?? null
}

export function commentForFamily(
  details: readonly FamilyDetail[] | undefined,
  familyKey: string,
): string {
  return detailForFamily(details, familyKey)?.comment ?? ''
}

function writeDetail(
  catalog: FamilyDetailCatalog,
  familyKey: string,
  patch: { rating?: number | null; comment?: string },
): void {
  const key = familyKey.trim()
  if (!key) throw new Error('Choose a family first.')
  const rows = new Map(
    normalizeFamilyDetails(catalog.familyDetails).map((row) => [row.familyKey, { ...row }]),
  )
  const row = rows.get(key) ?? { familyKey: key }
  if ('rating' in patch) {
    const rating = cleanRating(patch.rating)
    if (rating === null) delete row.rating
    else row.rating = rating
  }
  if ('comment' in patch) {
    const comment = cleanComment(patch.comment)
    if (!comment) delete row.comment
    else row.comment = comment
  }
  if (row.rating === undefined && !row.comment) rows.delete(key)
  else rows.set(key, row)
  catalog.familyDetails = [...rows.values()]
}

/** Set (1–5) or clear (null/invalid) a family's star rating. */
export function setFamilyRating(
  catalog: FamilyDetailCatalog,
  familyKey: string,
  rating: number | null,
): void {
  writeDetail(catalog, familyKey, { rating })
}

/** Set or clear (empty text) a family's comment. */
export function setFamilyComment(
  catalog: FamilyDetailCatalog,
  familyKey: string,
  comment: string,
): void {
  writeDetail(catalog, familyKey, { comment })
}

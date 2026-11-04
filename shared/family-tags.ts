/**
 * Family tags stored on the catalog.
 *
 * A later smart-project rule `tag is` / `tag is not` should use `entryHasFamilyTag`
 * (or `tagIdsForFamily` with `familyTagKey`). Rules read `tagIds` only.
 * `autoTagIds` records the retail Trial default and is not a rule input.
 *
 * The Trial default looks at whether a Displaay worker token is saved and whether
 * the family is in the retail collection (`retailRelativePath`). It does not read
 * font bytes or file names.
 */

export type FamilyTagSeed = 'licensed' | 'trial' | 'open-source' | 'unlicensed'

export type FamilyTag = {
  id: string
  name: string
  /** CSS color for the dot on a family card. */
  color: string
  /** Set for the four seed tags. Rename changes `name` only, so the Trial rule keeps this id. */
  seed?: FamilyTagSeed
}

export type FamilyTagAssignment = {
  /** Library card key: custom name, else retail family, else parsed family. */
  familyKey: string
  tagIds: string[]
  /** Tag ids applied by a default rule. Manual apply or remove drops the id from this list. */
  autoTagIds?: string[]
}

export type FamilyTagCatalog = {
  tags?: FamilyTag[]
  familyTags?: FamilyTagAssignment[]
  /** Seed tags the user deleted. They are not recreated on the next load. */
  retiredTagSeeds?: FamilyTagSeed[]
}

export type FamilyTagEntry = {
  customFamilyName?: string | null
  retailFamilyName?: string | null
  retailRelativePath?: string | null
  faces?: ReadonlyArray<{ familyName?: string | null }> | null
}

export const SEED_FAMILY_TAGS: readonly FamilyTag[] = [
  { id: 'licensed', name: 'Licensed', color: '#1f8a4c', seed: 'licensed' },
  { id: 'trial', name: 'Trial', color: '#e39b2b', seed: 'trial' },
  { id: 'open-source', name: 'Open Source', color: '#3b6fd8', seed: 'open-source' },
  { id: 'unlicensed', name: 'Unlicensed', color: '#d24b4b', seed: 'unlicensed' },
]

const CUSTOM_TAG_COLORS = ['#7c5cbf', '#c45c8a', '#2a9d8f', '#c47b3a', '#4c7c8a', '#8a6232']

/** Colors offered when editing a tag. Seed colors first, then the custom palette. */
export const TAG_COLOR_CHOICES: readonly string[] = [
  ...SEED_FAMILY_TAGS.map((tag) => tag.color),
  ...CUSTOM_TAG_COLORS,
]

const SEED_KEYS = new Set<FamilyTagSeed>(SEED_FAMILY_TAGS.map((tag) => tag.seed!))

const MAX_TAG_NAME = 40

export function familyTagKey(entry: FamilyTagEntry): string {
  const custom = entry.customFamilyName?.trim()
  if (custom) return custom
  const retail = entry.retailFamilyName?.trim()
  if (retail) return retail
  return entry.faces?.[0]?.familyName || 'Unknown'
}

/** Displaay retail collection membership. Not a guess from the font file. */
export function isDisplaayRetailEntry(entry: FamilyTagEntry): boolean {
  return typeof entry.retailRelativePath === 'string' && entry.retailRelativePath.trim().length > 0
}

export function tagIdsForFamily(
  familyTags: readonly FamilyTagAssignment[] | undefined,
  familyKey: string,
): string[] {
  const row = familyTags?.find((item) => item.familyKey === familyKey)
  return row ? [...row.tagIds] : []
}

/**
 * `tag is` when this returns true, `tag is not` when it returns false.
 * Match a tag by id, seed, or current name. The smart-project predicate is
 * `familyTagRulePredicate`; `isNot` is applied by the rule matcher.
 */
export function entryHasFamilyTag(
  catalog: FamilyTagCatalog,
  entry: FamilyTagEntry,
  rule: { id?: string; name?: string; seed?: FamilyTagSeed },
): boolean {
  const ids = tagIdsForFamily(catalog.familyTags, familyTagKey(entry))
  if (rule.id) return ids.includes(rule.id)
  if (rule.seed) {
    const tag = catalog.tags?.find((item) => item.seed === rule.seed)
    return Boolean(tag && ids.includes(tag.id))
  }
  if (rule.name) {
    const wanted = rule.name.trim().toLowerCase()
    const tag = catalog.tags?.find((item) => item.name.trim().toLowerCase() === wanted)
    return Boolean(tag && ids.includes(tag.id))
  }
  return false
}

/** Positive `tag is <value>` check. Value may be a tag id, seed, or current name. */
export function entryMatchesFamilyTagValue(
  catalog: FamilyTagCatalog,
  entry: FamilyTagEntry,
  value: string,
): boolean {
  const wanted = value.trim()
  if (!wanted) return false
  if (entryHasFamilyTag(catalog, entry, { id: wanted })) return true
  if (isSeed(wanted) && entryHasFamilyTag(catalog, entry, { seed: wanted })) return true
  return entryHasFamilyTag(catalog, entry, { name: wanted })
}

/** `predicates.tag` for `matchingSmartEntries`. Does not read font bytes. */
export function familyTagRulePredicate<TEntry extends FamilyTagEntry>(catalog: FamilyTagCatalog) {
  return (entry: TEntry, rule: { value: string }): boolean =>
    entryMatchesFamilyTagValue(catalog, entry, rule.value)
}

function isSeed(value: unknown): value is FamilyTagSeed {
  return typeof value === 'string' && SEED_KEYS.has(value as FamilyTagSeed)
}

function readTag(value: unknown): FamilyTag | null {
  if (!value || typeof value !== 'object') return null
  const tag = value as Partial<FamilyTag>
  if (typeof tag.id !== 'string' || !tag.id.trim()) return null
  if (typeof tag.name !== 'string' || !tag.name.trim()) return null
  if (typeof tag.color !== 'string' || !tag.color.trim()) return null
  const seed = isSeed(tag.seed) ? tag.seed : undefined
  return {
    id: tag.id.trim(),
    name: tag.name.trim(),
    color: tag.color.trim(),
    ...(seed ? { seed } : {}),
  }
}

export function ensureSeedTags(
  tags: readonly FamilyTag[] | undefined,
  retired: readonly FamilyTagSeed[] | undefined = [],
): FamilyTag[] {
  const retiredSet = new Set(retired)
  const stored = (tags ?? []).flatMap((tag) => {
    const read = readTag(tag)
    return read ? [read] : []
  })
  const seeds: FamilyTag[] = []
  for (const seed of SEED_FAMILY_TAGS) {
    if (seed.seed && retiredSet.has(seed.seed)) continue
    const existing = stored.find((tag) => tag.seed === seed.seed || tag.id === seed.id)
    seeds.push(
      existing
        ? {
            id: existing.seed === seed.seed ? existing.id : seed.id,
            name: existing.name,
            color: existing.color,
            seed: seed.seed,
          }
        : { ...seed },
    )
  }
  const seedIds = new Set(seeds.map((tag) => tag.id))
  const custom = stored.filter((tag) => !tag.seed && !seedIds.has(tag.id))
  return [...seeds, ...custom]
}

export function normalizeFamilyTagAssignments(
  familyTags: readonly FamilyTagAssignment[] | undefined,
  tags: readonly FamilyTag[],
): FamilyTagAssignment[] {
  const valid = new Set(tags.map((tag) => tag.id))
  if (!Array.isArray(familyTags)) return []
  const rows: FamilyTagAssignment[] = []
  const seen = new Set<string>()
  for (const row of familyTags) {
    if (!row || typeof row !== 'object') continue
    const familyKey = typeof row.familyKey === 'string' ? row.familyKey.trim() : ''
    if (!familyKey || seen.has(familyKey)) continue
    const tagIds = uniqueIds(row.tagIds).filter((id) => valid.has(id))
    if (tagIds.length === 0) continue
    const autoTagIds = uniqueIds(row.autoTagIds).filter((id) => tagIds.includes(id))
    seen.add(familyKey)
    rows.push({ familyKey, tagIds, ...(autoTagIds.length > 0 ? { autoTagIds } : {}) })
  }
  return rows
}

function uniqueIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue
    seen.add(item)
    ids.push(item)
  }
  return ids
}

type WorkingAssignment = { familyKey: string; tagIds: string[]; autoTagIds: string[] }

function storedAssignment(row: WorkingAssignment): FamilyTagAssignment {
  return {
    familyKey: row.familyKey,
    tagIds: row.tagIds,
    ...(row.autoTagIds.length > 0 ? { autoTagIds: row.autoTagIds } : {}),
  }
}

function sameTagList(left: readonly FamilyTag[], right: readonly FamilyTag[]): boolean {
  if (left.length !== right.length) return false
  return left.every((tag, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      tag.id === other.id &&
      tag.name === other.name &&
      tag.color === other.color &&
      tag.seed === other.seed
    )
  })
}

function sameAssignments(left: readonly FamilyTagAssignment[], right: readonly FamilyTagAssignment[]): boolean {
  if (left.length !== right.length) return false
  const byKey = new Map(left.map((row) => [row.familyKey, row]))
  return right.every((row) => {
    const other = byKey.get(row.familyKey)
    if (!other || other.tagIds.length !== row.tagIds.length) return false
    if (other.tagIds.some((id, index) => id !== row.tagIds[index])) return false
    const auto = other.autoTagIds ?? []
    const nextAuto = row.autoTagIds ?? []
    return auto.length === nextAuto.length && auto.every((id, index) => id === nextAuto[index])
  })
}

/**
 * Set or clear the Trial default on Displaay retail families.
 * No saved worker token → Trial is present (marked automatic).
 * A saved worker token → that automatic Trial is removed.
 * Manual tags, including a manual Trial, stay. Other families are left alone.
 */
export function reconcileRetailTrialTags(
  catalog: FamilyTagCatalog & { entries: readonly FamilyTagEntry[] },
  options: { hasWorkerToken: boolean },
): boolean {
  const tags = ensureSeedTags(catalog.tags, catalog.retiredTagSeeds)
  const tagsChanged = !sameTagList(catalog.tags ?? [], tags)
  catalog.tags = tags
  const trial = tags.find((tag) => tag.seed === 'trial')
  const before = normalizeFamilyTagAssignments(catalog.familyTags, tags)
  const rows = new Map<string, WorkingAssignment>(
    before.map((row) => [row.familyKey, { familyKey: row.familyKey, tagIds: [...row.tagIds], autoTagIds: [...(row.autoTagIds ?? [])] }]),
  )
  if (trial) {
    const retailKeys = new Set<string>()
    for (const entry of catalog.entries) {
      if (isDisplaayRetailEntry(entry)) retailKeys.add(familyTagKey(entry))
    }
    for (const key of retailKeys) {
      const row = rows.get(key) ?? { familyKey: key, tagIds: [], autoTagIds: [] }
      if (!options.hasWorkerToken) {
        if (!row.tagIds.includes(trial.id)) {
          row.tagIds.push(trial.id)
          row.autoTagIds.push(trial.id)
        }
      } else if (row.autoTagIds.includes(trial.id)) {
        row.autoTagIds = row.autoTagIds.filter((id) => id !== trial.id)
        row.tagIds = row.tagIds.filter((id) => id !== trial.id)
      }
      if (row.tagIds.length === 0) rows.delete(key)
      else rows.set(key, row)
    }
  }
  const familyTags = [...rows.values()].map(storedAssignment)
  catalog.familyTags = familyTags
  return tagsChanged || !sameAssignments(before, familyTags)
}

const TAG_COLOR_RE = /^#(?:[0-9a-fA-F]{6})$/

export function cleanTagColor(color: string): string {
  const trimmed = color.trim().toLowerCase()
  if (!TAG_COLOR_RE.test(trimmed)) throw new Error('Pick a tag color.')
  return trimmed
}

export function cleanTagName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (!trimmed) throw new Error('Enter a tag name.')
  if (trimmed.length > MAX_TAG_NAME) throw new Error('Tag names can be 40 characters.')
  return trimmed
}

function assertUniqueName(tags: readonly FamilyTag[], name: string, exceptId?: string): void {
  const key = name.toLowerCase()
  if (tags.some((tag) => tag.id !== exceptId && tag.name.toLowerCase() === key)) {
    throw new Error('A tag with that name already exists.')
  }
}

export function nextCustomTagColor(tags: readonly FamilyTag[]): string {
  const used = new Set(tags.map((tag) => tag.color.toLowerCase()))
  for (const color of CUSTOM_TAG_COLORS) {
    if (!used.has(color)) return color
  }
  return CUSTOM_TAG_COLORS[tags.length % CUSTOM_TAG_COLORS.length]!
}

export function addFamilyTag(catalog: FamilyTagCatalog, name: string, id: string): FamilyTag {
  const tags = ensureSeedTags(catalog.tags, catalog.retiredTagSeeds)
  const clean = cleanTagName(name)
  assertUniqueName(tags, clean)
  const tag: FamilyTag = { id, name: clean, color: nextCustomTagColor(tags) }
  catalog.tags = [...tags, tag]
  catalog.familyTags = normalizeFamilyTagAssignments(catalog.familyTags, catalog.tags)
  return tag
}

export function renameFamilyTag(catalog: FamilyTagCatalog, tagId: string, name: string): FamilyTag {
  return updateFamilyTag(catalog, tagId, { name })
}

export function updateFamilyTag(
  catalog: FamilyTagCatalog,
  tagId: string,
  input: { name: string; color?: string },
): FamilyTag {
  const tags = ensureSeedTags(catalog.tags, catalog.retiredTagSeeds)
  const tag = tags.find((item) => item.id === tagId)
  if (!tag) throw new Error('That tag does not exist.')
  const clean = cleanTagName(input.name)
  assertUniqueName(tags, clean, tagId)
  tag.name = clean
  if (input.color !== undefined) tag.color = cleanTagColor(input.color)
  catalog.tags = tags
  catalog.familyTags = normalizeFamilyTagAssignments(catalog.familyTags, tags)
  return tag
}

/** Remove the tag and take it off every family. A deleted seed stays deleted. */
export function deleteFamilyTag(catalog: FamilyTagCatalog, tagId: string): void {
  const tags = ensureSeedTags(catalog.tags, catalog.retiredTagSeeds)
  const tag = tags.find((item) => item.id === tagId)
  if (!tag) throw new Error('That tag does not exist.')
  if (tag.seed) {
    const retired = new Set(catalog.retiredTagSeeds ?? [])
    retired.add(tag.seed)
    catalog.retiredTagSeeds = [...retired]
  }
  const nextTags = tags.filter((item) => item.id !== tagId)
  catalog.tags = nextTags
  const stripped = normalizeFamilyTagAssignments(catalog.familyTags, tags).map((row) => ({
    familyKey: row.familyKey,
    tagIds: row.tagIds.filter((id) => id !== tagId),
    autoTagIds: (row.autoTagIds ?? []).filter((id) => id !== tagId),
  }))
  catalog.familyTags = normalizeFamilyTagAssignments(stripped, nextTags)
}

export function setFamilyTagPresent(
  catalog: FamilyTagCatalog,
  familyKeys: readonly string[],
  tagId: string,
  present: boolean,
): void {
  const tags = ensureSeedTags(catalog.tags, catalog.retiredTagSeeds)
  catalog.tags = tags
  if (!tags.some((tag) => tag.id === tagId)) throw new Error('That tag does not exist.')
  const keys = [...new Set(familyKeys.map((key) => key.trim()).filter(Boolean))]
  if (keys.length === 0) throw new Error('Choose a family first.')
  const rows = new Map<string, WorkingAssignment>(
    normalizeFamilyTagAssignments(catalog.familyTags, tags).map((row) => [
      row.familyKey,
      { familyKey: row.familyKey, tagIds: [...row.tagIds], autoTagIds: [...(row.autoTagIds ?? [])] },
    ]),
  )
  for (const key of keys) {
    const row = rows.get(key) ?? { familyKey: key, tagIds: [], autoTagIds: [] }
    if (present) {
      if (!row.tagIds.includes(tagId)) row.tagIds.push(tagId)
      row.autoTagIds = row.autoTagIds.filter((id) => id !== tagId)
    } else {
      row.tagIds = row.tagIds.filter((id) => id !== tagId)
      row.autoTagIds = row.autoTagIds.filter((id) => id !== tagId)
    }
    if (row.tagIds.length === 0) rows.delete(key)
    else rows.set(key, row)
  }
  catalog.familyTags = [...rows.values()].map(storedAssignment)
}

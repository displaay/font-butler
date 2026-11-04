/**
 * Smart projects: a named All/Any rule set.
 *
 * Manual projects keep an explicit member list. A smart project stores rules only;
 * membership is computed from the current catalog.
 *
 * `tag` is `tag is` / `tag is not`. This module does not decide tag membership.
 * Callers pass `predicates.tag` from `familyTagRulePredicate`. The predicate
 * reports the positive condition (the family has that tag). `isNot` is applied here.
 *
 * `styleCount` is the family's style count. `classification` is the class the
 * font declares or that its name table spells out. An unclassified family
 * matches neither `is` nor `is not`.
 */

import { familyTagKey } from './family-tags.ts'
import {
  classificationOfFace,
  fontClassificationId,
  type FontClassification,
} from './font-classification.ts'

export const SMART_RETAIL_FOLDER = '__retail__'

export const SMART_RULE_FIELDS = [
  'status',
  'variable',
  'source',
  'destination',
  'format',
  'folder',
  'query',
  'tag',
  'styleCount',
  'classification',
] as const

export type SmartRuleField = (typeof SMART_RULE_FIELDS)[number]

/** Fields the built-in matcher decides. `tag` is stored and matched only via a predicate. */
export const BUILTIN_SMART_RULE_FIELDS = [
  'status',
  'variable',
  'source',
  'destination',
  'format',
  'folder',
  'query',
  'styleCount',
  'classification',
] as const

export type BuiltinSmartRuleField = (typeof BUILTIN_SMART_RULE_FIELDS)[number]

export type SmartChipField = 'status' | 'variable' | 'source' | 'destination' | 'format'

export type SmartRuleOperator =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'notContains'
  | 'isMoreThan'
  | 'isLessThan'
  | 'isAtLeast'
  | 'isAtMost'

export type SmartRule = {
  id: string
  field: SmartRuleField
  operator: SmartRuleOperator
  value: string
}

export type SmartRuleMatch = 'all' | 'any'

export type SmartRuleSet = {
  match: SmartRuleMatch
  rules: SmartRule[]
}

export type ProjectKind = 'manual' | 'smart'

export type SmartMatchFace = {
  familyName?: string
  styleName?: string
  fullName?: string
  postscriptName?: string
  isVariable?: boolean
  instanceCount?: number
  instanceNames?: string[]
  /** Set when a parse already classified the face. `null` means the file said nothing. */
  classification?: string | null
}

export type SmartMatchCopy = {
  destinationId?: string
  verification?: string
  parkedPath?: string
}

/** Structural slice of a catalog entry. Extra fields stay available to predicates. */
export type SmartMatchEntry = {
  id: string
  status?: string
  format?: string
  sourcePath?: string
  faces?: SmartMatchFace[]
  sourcePresent?: boolean
  sourceAvailability?: string
  retailRelativePath?: string | null
  customFamilyName?: string | null
  retailFamilyName?: string | null
  previewOnly?: boolean
  installedPath?: string
  disabledPath?: string
  installations?: SmartMatchCopy[]
}

export type SmartRulePredicate<TEntry extends SmartMatchEntry = SmartMatchEntry> = (
  entry: TEntry,
  rule: SmartRule,
) => boolean

export type SmartMatchOptions<TEntry extends SmartMatchEntry = SmartMatchEntry> = {
  /**
   * Handlers for fields this module does not decide. `tag` is the reserved one:
   * return whether the positive condition holds (`tag is <value>`).
   */
  predicates?: Partial<Record<string, SmartRulePredicate<TEntry>>>
}

export const SMART_RULE_FIELD_OPTIONS: { field: SmartRuleField; label: string }[] = [
  { field: 'status', label: 'Status' },
  { field: 'variable', label: 'Type' },
  { field: 'source', label: 'Source' },
  { field: 'destination', label: 'Destination' },
  { field: 'format', label: 'Format' },
  { field: 'folder', label: 'Folder' },
  { field: 'query', label: 'Text' },
  { field: 'tag', label: 'Tag' },
  { field: 'styleCount', label: 'Number of Styles' },
  { field: 'classification', label: 'Classification' },
]

export const SMART_RULE_CHIP_VALUES: Record<SmartChipField, { value: string; label: string }[]> = {
  status: [
    { value: 'installed', label: 'Installed' },
    { value: 'deactivated', label: 'Deactivated' },
    { value: 'uninstalled', label: 'Not installed' },
  ],
  variable: [
    { value: 'vf', label: 'VF' },
    { value: 'static', label: 'Static' },
  ],
  source: [
    { value: 'source', label: 'Source' },
    { value: 'no-source', label: 'No source' },
  ],
  destination: [
    { value: 'computer', label: 'Computer' },
    { value: 'adobe', label: 'Adobe' },
    { value: 'no-destination', label: 'None' },
  ],
  format: [
    { value: 'otf', label: 'OTF' },
    { value: 'ttf', label: 'TTF' },
  ],
}

export const SMART_RULE_OPERATOR_LABELS: Record<SmartRuleOperator, string> = {
  is: 'is',
  isNot: 'is not',
  contains: 'contains',
  notContains: 'does not contain',
  isMoreThan: 'is more than',
  isLessThan: 'is less than',
  isAtLeast: 'is at least',
  isAtMost: 'is at most',
}

export const SMART_MATCH_LABELS: Record<SmartRuleMatch, string> = {
  all: 'All of the rules',
  any: 'Any of the rules',
}

const FIELD_SET = new Set<string>(SMART_RULE_FIELDS)
const BUILTIN_SET = new Set<string>(BUILTIN_SMART_RULE_FIELDS)

export function isSmartRuleField(value: string): value is SmartRuleField {
  return FIELD_SET.has(value)
}

export function isSmartProject(project: { kind?: string | null }): boolean {
  return project.kind === 'smart'
}

export function operatorsForField(field: SmartRuleField): SmartRuleOperator[] {
  if (field === 'query') return ['contains', 'notContains']
  if (field === 'styleCount') return ['is', 'isMoreThan', 'isLessThan', 'isAtLeast', 'isAtMost']
  return ['is', 'isNot']
}

export function emptySmartRuleSet(): SmartRuleSet {
  return { match: 'all', rules: [] }
}

export function newSmartRuleId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function defaultChipValue(field: SmartRuleField): string {
  if (
    field === 'status' ||
    field === 'variable' ||
    field === 'source' ||
    field === 'destination' ||
    field === 'format'
  ) {
    return SMART_RULE_CHIP_VALUES[field][0]!.value
  }
  if (field === 'styleCount') return '1'
  if (field === 'classification') return 'serif'
  return ''
}

export function createSmartRule(partial: Partial<SmartRule> = {}): SmartRule {
  const field: SmartRuleField =
    partial.field && isSmartRuleField(partial.field) ? partial.field : 'status'
  const operators = operatorsForField(field)
  const operator = partial.operator && operators.includes(partial.operator) ? partial.operator : operators[0]!
  const value = typeof partial.value === 'string' ? partial.value : defaultChipValue(field)
  return {
    id: partial.id?.trim() || newSmartRuleId(),
    field,
    operator,
    value,
  }
}

export function normalizeSmartRuleSet(value: unknown): SmartRuleSet {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const match: SmartRuleMatch = source.match === 'any' ? 'any' : 'all'
  const rawRules = Array.isArray(source.rules) ? source.rules : []
  const rules: SmartRule[] = []
  for (const raw of rawRules) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    if (typeof row.field !== 'string' || !isSmartRuleField(row.field)) continue
    const field = row.field
    const operators = operatorsForField(field)
    if (typeof row.operator !== 'string' || !operators.includes(row.operator as SmartRuleOperator)) {
      continue
    }
    if (typeof row.value !== 'string') continue
    const ruleValue = canonicalRuleValue(field, row.value)
    if (!ruleValue) continue
    rules.push({
      id: typeof row.id === 'string' && row.id.trim() ? row.id : newSmartRuleId(),
      field,
      operator: row.operator as SmartRuleOperator,
      value: ruleValue,
    })
  }
  return { match, rules }
}

export function smartRuleSummary(rules: SmartRuleSet | null | undefined): string {
  const count = rules?.rules.length ?? 0
  if (count === 0) return 'No rules yet'
  const noun = count === 1 ? 'rule' : 'rules'
  return rules?.match === 'any' ? `Any of ${count} ${noun}` : `All of ${count} ${noun}`
}

export function smartSnapshotName(name: string): string {
  const base = name.trim() || 'Untitled project'
  return base.toLowerCase().endsWith(' snapshot') ? base : `${base} snapshot`
}

export function entryMatchesSmartRules<TEntry extends SmartMatchEntry>(
  entry: TEntry,
  rules: SmartRuleSet | null | undefined,
  options?: SmartMatchOptions<TEntry>,
): boolean {
  return entryMatchesWithFacts(entry, rules, options, familyFactsFor([entry]))
}

export function matchingSmartEntries<TEntry extends SmartMatchEntry>(
  entries: readonly TEntry[],
  rules: SmartRuleSet | null | undefined,
  options?: SmartMatchOptions<TEntry>,
): TEntry[] {
  const facts = familyFactsFor(entries)
  return entries.filter((entry) => entryMatchesWithFacts(entry, rules, options, facts))
}

/** Distinct families in the current match. The sheet's live count. */
export function matchingSmartFamilyCount<TEntry extends SmartMatchEntry>(
  entries: readonly TEntry[],
  rules: SmartRuleSet | null | undefined,
  options?: SmartMatchOptions<TEntry>,
): number {
  const keys = new Set<string>()
  for (const entry of matchingSmartEntries(entries, rules, options)) keys.add(familyTagKey(entry))
  return keys.size
}

/** Current match, copied into a manual project. Rules are not part of the snapshot. */
export function smartProjectSnapshot<TEntry extends SmartMatchEntry>(
  project: { name: string },
  entries: readonly TEntry[],
  rules: SmartRuleSet | null | undefined,
  options?: SmartMatchOptions<TEntry>,
): { name: string; memberIds: string[] } {
  return {
    name: smartSnapshotName(project.name),
    memberIds: matchingSmartEntries(entries, rules, options).map((entry) => entry.id),
  }
}

type FamilyFacts = {
  styleCount: number
  classifications: Set<FontClassification>
}

function entryMatchesWithFacts<TEntry extends SmartMatchEntry>(
  entry: TEntry,
  rules: SmartRuleSet | null | undefined,
  options: SmartMatchOptions<TEntry> | undefined,
  facts: Map<string, FamilyFacts>,
): boolean {
  const list = rules?.rules ?? []
  if (list.length === 0) return false
  const family = facts.get(familyTagKey(entry)) ?? { styleCount: 0, classifications: new Set() }
  const passes = (rule: SmartRule) => rulePasses(entry, rule, options, family)
  if (rules?.match === 'any') return list.some(passes)
  return list.every(passes)
}

function rulePasses<TEntry extends SmartMatchEntry>(
  entry: TEntry,
  rule: SmartRule,
  options: SmartMatchOptions<TEntry> | undefined,
  family: FamilyFacts,
): boolean {
  if (rule.field === 'styleCount') return styleCountPasses(family.styleCount, rule)
  if (rule.field === 'classification') return classificationPasses(family.classifications, rule)
  const predicate = options?.predicates?.[rule.field]
  const positive = predicate ? predicate(entry, rule) : builtinPositive(entry, rule)
  if (positive === undefined) return false
  if (rule.operator === 'isNot' || rule.operator === 'notContains') return !positive
  return positive
}

function canonicalRuleValue(field: SmartRuleField, value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (field === 'styleCount') {
    if (!/^\d+$/.test(trimmed)) return null
    const count = Number(trimmed)
    if (!Number.isSafeInteger(count)) return null
    return String(count)
  }
  if (field === 'classification') return fontClassificationId(trimmed)
  const chips = SMART_RULE_CHIP_VALUES[field as SmartChipField]
  if (chips && !chips.some((chip) => chip.value === trimmed)) return null
  return trimmed
}

function styleCountPasses(count: number, rule: SmartRule): boolean {
  if (!/^\d+$/.test(rule.value)) return false
  const value = Number(rule.value)
  switch (rule.operator) {
    case 'is':
      return count === value
    case 'isMoreThan':
      return count > value
    case 'isLessThan':
      return count < value
    case 'isAtLeast':
      return count >= value
    case 'isAtMost':
      return count <= value
    default:
      return false
  }
}

function classificationPasses(classes: Set<FontClassification>, rule: SmartRule): boolean {
  const wanted = fontClassificationId(rule.value)
  if (!wanted || classes.size === 0) return false
  if (rule.operator === 'isNot') return !classes.has(wanted)
  if (rule.operator === 'is') return classes.has(wanted)
  return false
}

function familyFactsFor<TEntry extends SmartMatchEntry>(entries: readonly TEntry[]): Map<string, FamilyFacts> {
  const grouped = new Map<string, TEntry[]>()
  for (const entry of entries) {
    const key = familyTagKey(entry)
    const list = grouped.get(key) ?? []
    list.push(entry)
    grouped.set(key, list)
  }
  const facts = new Map<string, FamilyFacts>()
  for (const [key, group] of grouped) {
    const styles = new Set<string>()
    const classifications = new Set<FontClassification>()
    for (const entry of group) {
      for (const face of entry.faces ?? []) {
        for (const styleKey of styleKeysForFace(face)) styles.add(styleKey)
        const klass = classificationOfFace(face)
        if (klass) classifications.add(klass)
      }
    }
    facts.set(key, { styleCount: styles.size, classifications })
  }
  return facts
}

function styleKeysForFace(face: SmartMatchFace): string[] {
  const family = (face.familyName ?? '').trim().toLowerCase()
  if (face.isVariable && face.instanceNames && face.instanceNames.length > 0) {
    return face.instanceNames.map((name) => `${family}::${name.trim().toLowerCase()}`)
  }
  if (face.isVariable) {
    const count = Math.max(face.instanceCount ?? 1, 1)
    const style = (face.styleName ?? 'regular').trim().toLowerCase()
    return Array.from({ length: count }, (_, index) => `${family}::${style}#${index}`)
  }
  return [`${family}::${(face.styleName ?? 'regular').trim().toLowerCase() || 'regular'}`]
}

/** `undefined` means this module does not decide the field (reserved `tag`, or unknown). */
function builtinPositive(entry: SmartMatchEntry, rule: SmartRule): boolean | undefined {
  if (!BUILTIN_SET.has(rule.field)) return undefined
  switch (rule.field) {
    case 'status':
      return matchesStatus(entry, rule.value)
    case 'variable':
      return matchesVariable(entry, rule.value)
    case 'source':
      return matchesSource(entry, rule.value)
    case 'destination':
      return matchesDestination(entry, rule.value)
    case 'format':
      return formatOf(entry) === rule.value
    case 'folder':
      return matchesFolder(entry, rule.value)
    case 'query':
      return queryContains(entry, rule.value)
    default:
      return undefined
  }
}

function matchesStatus(entry: SmartMatchEntry, value: string): boolean {
  if (value === 'installed') return entry.status === 'installed' || entry.status === 'outdated'
  if (value === 'deactivated') return entry.status === 'deactivated'
  if (value === 'uninstalled') return entry.status === 'uninstalled' || entry.status === 'source-missing'
  return false
}

function matchesVariable(entry: SmartMatchEntry, value: string): boolean {
  const faces = entry.faces ?? []
  if (value === 'vf') return faces.some((face) => face.isVariable)
  if (value === 'static') return faces.some((face) => !face.isVariable)
  return false
}

function matchesSource(entry: SmartMatchEntry, value: string): boolean {
  const tracked = smartEntryHasTrackedSource(entry)
  if (value === 'source') return tracked
  if (value === 'no-source') return !tracked
  return false
}

function matchesDestination(entry: SmartMatchEntry, value: string): boolean {
  const dest = copyDestinations(entry)
  if (value === 'computer') return dest.macos
  if (value === 'adobe') return dest.adobe
  if (value === 'no-destination') return !dest.macos && !dest.adobe
  return false
}

function matchesFolder(entry: SmartMatchEntry, value: string): boolean {
  if (value === SMART_RETAIL_FOLDER) return Boolean(entry.retailRelativePath)
  return smartEntryHasTrackedSource(entry) && pathUnder(entry.sourcePath ?? '', value)
}

function queryContains(entry: SmartMatchEntry, value: string): boolean {
  const needle = value.trim().toLowerCase()
  if (!needle) return false
  return queryHaystack(entry).toLowerCase().includes(needle)
}

function queryHaystack(entry: SmartMatchEntry): string {
  const parts: string[] = []
  if (entry.customFamilyName) parts.push(entry.customFamilyName)
  for (const face of entry.faces ?? []) {
    if (face.familyName) parts.push(face.familyName)
    if (face.styleName) parts.push(face.styleName)
    if (face.fullName) parts.push(face.fullName)
    if (face.postscriptName) parts.push(face.postscriptName)
  }
  return parts.join(' ')
}

function formatOf(entry: SmartMatchEntry): string {
  const raw = (entry.format ?? '').trim().toLowerCase().replace(/^\./, '')
  if (raw) return raw
  const match = /\.([a-z0-9]+)$/i.exec(entry.sourcePath ?? '')
  return match?.[1]?.toLowerCase() ?? ''
}

/** Same source notion as the library “Source” chip. */
export function smartEntryHasTrackedSource(entry: SmartMatchEntry): boolean {
  if (entry.retailRelativePath) return false
  if (entry.customFamilyName) return false
  if (isSelfSourced(entry)) return false
  if (entry.sourceAvailability === 'offline' || entry.sourceAvailability === 'unreadable') return true
  if (typeof entry.sourcePresent === 'boolean') return entry.sourcePresent
  return entry.status !== 'source-missing'
}

function isSelfSourced(entry: SmartMatchEntry): boolean {
  if (!entry.sourcePath) return true
  if (entry.installedPath && entry.sourcePath === entry.installedPath) return true
  if (entry.disabledPath && entry.sourcePath === entry.disabledPath) return true
  return false
}

/** Same destination notion as the library Destination chips. */
function copyDestinations(entry: SmartMatchEntry): { macos: boolean; adobe: boolean } {
  if (entry.previewOnly) return { macos: false, adobe: false }
  const copies = entry.installations ?? []
  const adobe = copies.some(
    (copy) =>
      copy.destinationId === 'adobe-shared' &&
      copy.verification === 'file-present' &&
      !copy.parkedPath,
  )
  if (entry.status === 'deactivated') return { macos: false, adobe: adobe && !entry.disabledPath }
  const macosCopy = copies.some(
    (copy) => copy.destinationId === 'macos' && copy.verification === 'file-present',
  )
  const macos = copies.length > 0 ? macosCopy : Boolean(entry.installedPath)
  return { macos, adobe }
}

function pathUnder(filePath: string, folder: string): boolean {
  const file = normalizePath(filePath)
  const root = normalizePath(folder)
  if (!file || !root) return false
  return file === root || file.startsWith(`${root}/`)
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

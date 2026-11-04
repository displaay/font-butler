/**
 * Library import from other font managers (Stage D).
 *
 * Verified formats (see the spike note in `core/library-import.ts`):
 * Font Book `.collection` keyed archives and FontExplorer X SQLite
 * databases (`.fexdb`, `FontDatabase.db` inside a `.fexconfig` folder, or
 * inside a `.fexbackup` ZIP), both as read by Cicero's importers.
 *
 * This module holds only the shared plan shapes. It does not read files.
 */
import type { SmartRuleSet } from './smart-projects.ts'

export type LibraryImportSourceApp = 'font-book' | 'font-explorer-x' | 'unknown'

export type LibraryImportUnsupportedConcept =
  | 'sets'
  | 'smart-sets'
  | 'labels'
  | 'ratings'
  | 'comments'
  | 'file'

export type LibraryImportUnsupported = {
  concept: LibraryImportUnsupportedConcept
  reason: string
  /** Null when the source cannot be read well enough to count. */
  count?: number | null
  detail?: string
}

export type ParsedLibrarySet = {
  name: string
  kind: 'set' | 'smart'
  /** Font identifiers as stored by the source: path, PostScript name, or family name. */
  members: string[]
  /** PostScript names the source explicitly excludes from a family. */
  excluded?: string[]
  /** Font Book's own collections start unchecked in the preview. */
  isBuiltIn?: boolean
  /** Translated smart rules, present only when every rule translated. */
  rules?: SmartRuleSet
  /** Rule descriptions that could not be translated, verbatim. */
  unsupportedRules?: string[]
}

export type ParsedLabelAssignment = {
  label: string
  members: string[]
}

export type ParsedLibrary = {
  sourceApp: LibraryImportSourceApp
  sourceName: string
  sets: ParsedLibrarySet[]
  labels: ParsedLabelAssignment[]
  /** Null means the source could not be read well enough to count. */
  ratingsCount: number | null
  commentsCount: number | null
  unsupported: LibraryImportUnsupported[]
  warnings: string[]
}

export type LibraryImportSetChoice = 'create' | 'merge' | 'imported-name' | 'skip'

export type LibraryImportUnresolved = {
  raw: string
  postscriptName: string
  familyName: string
  sourceFile: string
}

export type LibraryImportSetPlan = {
  id: string
  name: string
  kind: 'manual' | 'smart'
  collision: boolean
  existingProjectId?: string
  existingIsSmart?: boolean
  /** Shown disabled in the preview and skipped on apply (unsupported smart rules). */
  disabled?: boolean
  /** Font Book built-in collection: starts unchecked. */
  isBuiltIn?: boolean
  memberAssetIds: string[]
  alreadyMemberAssetIds: string[]
  unresolved: LibraryImportUnresolved[]
  rules?: SmartRuleSet
  untranslatableRules: string[]
  defaultChoice: LibraryImportSetChoice
}

export type LibraryImportLabelPlan = {
  id: string
  name: string
  existingTagId: string | null
  familyKeys: string[]
  unresolvedCount: number
  /** Present when the label cannot be applied as a tag. */
  skipReason?: string
}

export type LibraryImportPlan = {
  id: string
  createdAt: number
  sourceApp: LibraryImportSourceApp
  sourceName: string
  sets: LibraryImportSetPlan[]
  labels: LibraryImportLabelPlan[]
  unsupported: LibraryImportUnsupported[]
  warnings: string[]
  summary: {
    sets: number
    smartSets: number
    labels: number
    reusedLabels: number
    unresolvedFonts: number
    ratingsSkipped: number | null
    commentsSkipped: number | null
  }
}

export type LibraryImportApplyResult = {
  createdProjects: string[]
  mergedProjects: string[]
  skippedSets: string[]
  createdTags: string[]
  reusedTags: string[]
  assignedFamilies: number
  unresolvedFonts: number
}

export type LibraryImportFileInput = {
  name: string
  /** Text content for plist files. Binary files use `contentBase64`. */
  content: string
  contentBase64?: string
}

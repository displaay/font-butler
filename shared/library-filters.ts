import { FONT_CLASSIFICATIONS, type FontClassification, isFontClassification } from './font-classification.ts'

export const CHIP_LIBRARY_FILTERS = [
  'installed',
  'deactivated',
  'uninstalled',
  'vf',
  'static',
  'source',
  'no-source',
  'computer',
  'adobe',
  'no-destination',
  'otf',
  'ttf',
] as const

export type ChipLibraryFilter = (typeof CHIP_LIBRARY_FILTERS)[number]
export type ClassificationFilter = `classification:${FontClassification}`
export type FoundryFilter = `foundry:${string}`
export type LibraryFilter = ChipLibraryFilter | ClassificationFilter | FoundryFilter

const CHIP_SET = new Set<string>(CHIP_LIBRARY_FILTERS)

export function classificationFilterId(id: FontClassification): ClassificationFilter {
  return `classification:${id}`
}

export function foundryFilterId(name: string): string {
  return `foundry:${name}`
}

export function isLibraryFilter(value: unknown): value is LibraryFilter {
  if (typeof value !== 'string' || !value.trim()) return false
  if (CHIP_SET.has(value)) return true
  if (value.startsWith('classification:')) {
    return isFontClassification(value.slice('classification:'.length))
  }
  if (value.startsWith('foundry:')) {
    const name = value.slice('foundry:'.length).trim()
    return name.length > 0 && name.length <= 200 && !/[\r\n]/.test(name)
  }
  return false
}

export const CLASSIFICATION_FILTERS: ClassificationFilter[] = FONT_CLASSIFICATIONS.map(
  (id): ClassificationFilter => `classification:${id}`,
)

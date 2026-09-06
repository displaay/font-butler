import type { ImportPlan, ImportPlanItem } from './types'

export function planNeedsReview(plan: ImportPlan): boolean {
  return plan.items.some(
    (item) =>
      item.classification === 'alt-format' ||
      item.classification === 'collection-overlap' ||
      item.classification === 'unsupported' ||
      item.parallelCopy === true ||
      (item.classification === 'revision' && item.choices.includes('add-inactive')),
  )
}

export function planChoiceLabel(choice: ImportPlanItem['defaultChoice']): string {
  switch (choice) {
    case 'keep':
      return 'Keep installed'
    case 'replace':
      return 'Replace active'
    case 'add-inactive':
      return 'Add inactive copy'
    case 'switch':
      return 'Switch'
    case 'install-as':
      return 'Install as…'
    case 'relink':
      return 'Relink source'
    default:
      return 'Skip incoming'
  }
}

export function classificationLabel(item: ImportPlanItem): string {
  switch (item.classification) {
    case 'new':
      return item.previewOnly ? 'Web font · Preview only' : 'New font'
    case 'new-style':
      return 'New style'
    case 'identical':
      return 'Identical copy'
    case 'revision':
      return item.parallelCopy ? 'Same-identity copy' : 'Changed version'
    case 'alt-format':
      return 'Alternative format'
    case 'collection-overlap':
      return 'Collection overlap'
    case 'preview-only':
      return 'Web font · Preview only'
    case 'unsupported':
      return 'Unsupported'
    default:
      return item.classification
  }
}

export function collectionImportScope(item: ImportPlanItem): string | null {
  const names = item.affectedFaces?.length
    ? item.affectedFaces
    : (item.faces ?? []).map((face) => `${face.familyName} ${face.styleName}`.trim())
  const collection = item.classification === 'collection-overlap' || (item.faces?.length ?? 0) > 1
  if (!collection || names.length === 0) return null
  return `This changes all ${names.length} faces in this collection: ${names.join(', ')}`
}

import type { ImportPlan, ImportPlanItem } from './types'

export function planNeedsReview(plan: ImportPlan): boolean {
  return plan.items.some(
    (item) =>
      item.classification === 'alt-format' ||
      item.classification === 'collection-overlap' ||
      item.classification === 'unsupported',
  )
}

export function planChoiceLabel(choice: ImportPlanItem['defaultChoice']): string {
  switch (choice) {
    case 'keep':
      return 'Keep installed'
    case 'replace':
      return 'Replace'
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
      return 'Changed version'
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

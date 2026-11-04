import { loadCatalog, runCatalogTask, saveCatalog } from './catalog.ts'
import type { AppPaths } from './paths.ts'
import { emitEvent } from './events.ts'
import { catalogEvent } from './service-helpers.ts'
import {
  normalizeFamilyDetails,
  setFamilyComment,
  setFamilyRating,
  type FamilyDetail,
} from '../shared/family-details.ts'

export type FamilyDetailPayload = { familyDetails: FamilyDetail[] }

function commit(paths: AppPaths, catalog: ReturnType<typeof loadCatalog>): FamilyDetailPayload {
  saveCatalog(paths, catalog)
  const familyDetails = normalizeFamilyDetails(catalog.familyDetails)
  emitEvent(
    catalogEvent(catalog.entries, {
      tags: catalog.tags,
      familyTags: catalog.familyTags,
      familyDetails,
    }),
  )
  return { familyDetails }
}

export async function persistFamilyRating(
  paths: AppPaths,
  familyKey: string,
  rating: number | null,
): Promise<FamilyDetailPayload> {
  return runCatalogTask(() => {
    const catalog = loadCatalog(paths)
    setFamilyRating(catalog, familyKey, rating)
    return commit(paths, catalog)
  })
}

export async function persistFamilyComment(
  paths: AppPaths,
  familyKey: string,
  comment: string,
): Promise<FamilyDetailPayload> {
  return runCatalogTask(() => {
    const catalog = loadCatalog(paths)
    setFamilyComment(catalog, familyKey, comment)
    return commit(paths, catalog)
  })
}

import { readRetailToken } from './auth.ts'
import { loadCatalog, runCatalogTask, saveCatalog } from './catalog.ts'
import { retailTokenPath } from './paths.ts'
import type { AppPaths } from './paths.ts'
import { emitEvent } from './events.ts'
import { catalogEvent, newId } from './service-helpers.ts'
import {
  addFamilyTag,
  reconcileRetailTrialTags,
  renameFamilyTag,
  setFamilyTagPresent,
  type FamilyTag,
  type FamilyTagAssignment,
} from '../shared/family-tags.ts'

export type FamilyTagPayload = {
  tags: FamilyTag[]
  familyTags: FamilyTagAssignment[]
}

function payloadOf(catalog: { tags?: FamilyTag[]; familyTags?: FamilyTagAssignment[] }): FamilyTagPayload {
  return { tags: catalog.tags ?? [], familyTags: catalog.familyTags ?? [] }
}

function commit(paths: AppPaths, catalog: ReturnType<typeof loadCatalog>): FamilyTagPayload {
  saveCatalog(paths, catalog)
  const payload = payloadOf(catalog)
  emitEvent(catalogEvent(catalog.entries, payload))
  return payload
}

/** Apply the Trial default to the current catalog. No-op when nothing changed. */
export async function applyRetailTrialDefault(paths: AppPaths): Promise<boolean> {
  return runCatalogTask(() => {
    const catalog = loadCatalog(paths)
    const hasWorkerToken = readRetailToken(retailTokenPath(paths)).length > 0
    if (!reconcileRetailTrialTags(catalog, { hasWorkerToken })) return false
    commit(paths, catalog)
    return true
  })
}

export async function persistNewFamilyTag(
  paths: AppPaths,
  name: string,
  familyKeys: readonly string[] = [],
): Promise<FamilyTagPayload> {
  return runCatalogTask(() => {
    const catalog = loadCatalog(paths)
    const tag = addFamilyTag(catalog, name, newId())
    if (familyKeys.length > 0) setFamilyTagPresent(catalog, familyKeys, tag.id, true)
    return commit(paths, catalog)
  })
}

export async function persistFamilyTagName(
  paths: AppPaths,
  tagId: string,
  name: string,
): Promise<FamilyTagPayload> {
  return runCatalogTask(() => {
    const catalog = loadCatalog(paths)
    renameFamilyTag(catalog, tagId, name)
    return commit(paths, catalog)
  })
}

export async function persistFamilyTagPresence(
  paths: AppPaths,
  familyKeys: readonly string[],
  tagId: string,
  present: boolean,
): Promise<FamilyTagPayload> {
  return runCatalogTask(() => {
    const catalog = loadCatalog(paths)
    setFamilyTagPresent(catalog, familyKeys, tagId, present)
    return commit(paths, catalog)
  })
}

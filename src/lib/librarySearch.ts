import { tagIdsForFamily, type FamilyTag, type FamilyTagAssignment } from '../../shared/family-tags.ts'
import {
  familyMatchesLibrarySearch,
  type SearchFace,
  type SearchFamily,
  type SearchToken,
} from '../../shared/library-search.ts'
import type { FamilyGroup, SystemFamilyGroup } from './types'

function facesOf(faces: readonly SearchFace[]): SearchFace[] {
  return faces.map((face) => ({
    familyName: face.familyName,
    styleName: face.styleName,
    fullName: face.fullName,
    postscriptName: face.postscriptName,
    isVariable: face.isVariable,
    italic: face.italic,
    weight: face.weight,
    foundry: face.foundry,
    designer: face.designer,
    classification: face.classification,
    features: face.features,
    widthClass: face.widthClass,
    instanceNames: face.instanceNames,
    languages: face.languages,
  }))
}

export function catalogGroupMatchesSearch(
  group: FamilyGroup,
  text: string,
  tokens: readonly SearchToken[],
  tags: readonly FamilyTag[] | undefined,
  assignments: readonly FamilyTagAssignment[] | undefined,
): boolean {
  const ids = tagIdsForFamily(assignments, group.familyName)
  const knownTagNames = (tags ?? []).map((tag) => tag.name)
  const tagNames = (tags ?? []).filter((tag) => ids.includes(tag.id)).map((tag) => tag.name)
  const family: SearchFamily = {
    familyName: group.familyName,
    tagNames,
    faces: facesOf(group.faces),
  }
  return familyMatchesLibrarySearch(family, text, tokens, knownTagNames)
}

export function systemGroupMatchesSearch(
  group: SystemFamilyGroup,
  text: string,
  tokens: readonly SearchToken[],
): boolean {
  const family: SearchFamily = {
    familyName: group.familyName,
    faces: facesOf(group.faces),
  }
  return familyMatchesLibrarySearch(family, text, tokens)
}

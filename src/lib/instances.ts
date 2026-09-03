import type {
  CatalogEntry,
  FamilyGroup,
  FontFaceInfo,
  SystemFace,
  SystemFamilyGroup,
} from './types'

export type InstanceRow = {
  key: string
  label: string
  sublabel?: string
  catalogEntryId?: string
  systemPath?: string
  weight?: number
  italic?: boolean
}

function rowsFromFace(
  face: FontFaceInfo,
  entryId: string,
): InstanceRow[] {
  if (face.isVariable && face.instanceNames.length > 0) {
    return face.instanceNames.map((name) => ({
      key: `${entryId}-${face.postscriptName}-${name}`,
      label: name,
      sublabel: face.postscriptName,
      catalogEntryId: entryId,
      weight: face.weight,
      italic: face.italic,
    }))
  }
  return [
    {
      key: `${entryId}-${face.postscriptName}`,
      label: face.styleName,
      sublabel: face.postscriptName,
      catalogEntryId: entryId,
      weight: face.weight,
      italic: face.italic,
    },
  ]
}

export function catalogInstanceRows(group: FamilyGroup): InstanceRow[] {
  const rows: InstanceRow[] = []
  for (const entry of group.entries) {
    for (const face of entry.faces) {
      rows.push(...rowsFromFace(face, entry.id))
    }
  }
  return rows
}

function rowsFromSystemFace(face: SystemFace): InstanceRow[] {
  const names = face.instanceNames ?? []
  if (face.isVariable && names.length > 0) {
    return names.map((name) => ({
      key: `${face.path}-${name}`,
      label: name,
      sublabel: face.postscriptName,
      systemPath: face.path,
      weight: face.weight,
      italic: face.italic,
    }))
  }
  return [
    {
      key: `${face.path}-${face.postscriptName}`,
      label: face.styleName,
      sublabel: face.postscriptName,
      systemPath: face.path,
      weight: face.weight,
      italic: face.italic,
    },
  ]
}

export function systemInstanceRows(group: SystemFamilyGroup): InstanceRow[] {
  return group.faces.flatMap((face) => rowsFromSystemFace(face))
}

export function entryInstanceRows(entry: CatalogEntry): InstanceRow[] {
  return entry.faces.flatMap((face) => rowsFromFace(face, entry.id))
}

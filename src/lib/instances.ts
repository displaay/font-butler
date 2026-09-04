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

export function weightFromStyleName(name: string, fallback = 400): number {
  const compact = name.replace(/[\s\-_]/g, '').toLowerCase()
  if (/hairline|ultrathin|extrathin/.test(compact)) return 100
  if (/thin/.test(compact)) return 100
  if (/ultralight|extralight/.test(compact)) return 200
  if (/light/.test(compact)) return 300
  if (/medium/.test(compact)) return 500
  if (/semibold|demibold/.test(compact)) return 600
  if (/extrabold|ultrabold/.test(compact)) return 800
  if (/bold/.test(compact)) return 700
  if (/ultrablack|extrablack/.test(compact)) return 950
  if (/black|heavy/.test(compact)) return 900
  if (/book|roman|regular|normal|text/.test(compact)) return 400
  return fallback
}

export function italicFromStyleName(name: string, fallback = false): boolean {
  return /italic|oblique/i.test(name) || fallback
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
      weight: weightFromStyleName(name, face.weight),
      italic: italicFromStyleName(name, face.italic),
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
      weight: weightFromStyleName(name, face.weight),
      italic: italicFromStyleName(name, face.italic),
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

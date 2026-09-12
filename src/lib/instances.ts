import { entryFormatOf } from './formats.ts'
import { entryHasTrackedSource } from './group.ts'
import { entryCopyDestinations, instanceInstallState, type InstanceInstallState } from './state'
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
  format?: string
  weight?: number
  italic?: boolean
  variation?: string
  installState?: InstanceInstallState
  hasSource?: boolean
  retailSynced?: boolean
  macosCopy?: boolean
  adobeCopy?: boolean
  previewSample?: string
}

export function variationSettings(coordinates?: Record<string, number>): string | undefined {
  if (!coordinates) return undefined
  const parts = Object.entries(coordinates)
    .filter(([, value]) => Number.isFinite(value))
    .map(([tag, value]) => `'${tag}' ${value}`)
  return parts.length > 0 ? parts.join(', ') : undefined
}

function weightFromStyleName(name: string, fallback = 400): number {
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

function italicFromStyleName(name: string, fallback = false): boolean {
  return /italic|oblique/i.test(name) || fallback
}

function rowsFromFace(
  face: FontFaceInfo,
  entry: Pick<
    CatalogEntry,
    | 'id'
    | 'format'
    | 'sourcePath'
    | 'previewOnly'
    | 'status'
    | 'installedPath'
    | 'disabledPath'
    | 'installations'
    | 'previewSample'
  >,
  installState: InstanceInstallState,
  hasSource = false,
  retailSynced = false,
): InstanceRow[] {
  const format = entryFormatOf(entry) || undefined
  const dest = entryCopyDestinations(entry)
  if (face.isVariable && face.instanceNames.length > 0) {
    return face.instanceNames.map((name) => {
      const named = face.namedInstances?.find((item) => item.name === name)
      return {
        key: `${entry.id}-${face.postscriptName}-${name}`,
        label: name,
        sublabel: face.postscriptName,
        catalogEntryId: entry.id,
        weight: weightFromStyleName(name, face.weight),
        italic: italicFromStyleName(name, face.italic),
        variation: variationSettings(named?.coordinates),
        previewSample: entry.previewSample,
        hasSource,
        retailSynced,
      }
    })
  }
  return [
    {
      key: `${entry.id}-${face.postscriptName}`,
      label: face.styleName,
      sublabel: face.postscriptName,
      catalogEntryId: entry.id,
      format,
      weight: face.weight,
      italic: face.italic,
      installState,
      hasSource,
      retailSynced,
      macosCopy: dest.macos,
      adobeCopy: dest.adobe,
      previewSample: entry.previewSample,
    },
  ]
}

export function catalogInstanceRows(group: FamilyGroup): InstanceRow[] {
  const rows: InstanceRow[] = []
  for (const entry of group.entries) {
    const installState = instanceInstallState(entry)
    const hasSource = entryHasTrackedSource(entry)
    const retailSynced = Boolean(entry.retailRelativePath)
    for (const face of entry.faces) {
      rows.push(...rowsFromFace(face, entry, installState, hasSource, retailSynced))
    }
  }
  return rows
}

function rowsFromSystemFace(face: SystemFace): InstanceRow[] {
  const names = face.instanceNames ?? []
  const installState: InstanceInstallState = face.deactivated ? 'deactivated' : 'installed'
  const row = {
    systemPath: face.path,
    format: face.format,
    installState,
    macosCopy: !face.deactivated,
  }
  if (face.isVariable && names.length > 0) {
    return names.map((name) => ({
      key: `${face.path}-${name}`,
      label: name,
      sublabel: face.postscriptName,
      weight: weightFromStyleName(name, face.weight),
      italic: italicFromStyleName(name, face.italic),
      previewSample: face.previewSample,
    }))
  }
  return [
    {
      key: `${face.path}-${face.postscriptName}`,
      label: face.styleName,
      sublabel: face.postscriptName,
      weight: face.weight,
      italic: face.italic,
      previewSample: face.previewSample,
      ...row,
    },
  ]
}

export function systemInstanceRows(group: SystemFamilyGroup): InstanceRow[] {
  return group.faces.flatMap((face) => rowsFromSystemFace(face))
}

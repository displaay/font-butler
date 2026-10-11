import { entryFormatOf } from './formats.ts'
import { entryHasTrackedSource } from './group.ts'
import { entryCopyDestinations, instanceInstallState, type InstanceInstallState } from './state'
import { entryHasActiveRetailSync, type RetailSyncView } from '../../shared/retail.ts'
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
  /** The synced copy is the Displaay trial cut. */
  retailTrial?: boolean
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

function parseVariation(value?: string): Record<string, number> {
  const coordinates: Record<string, number> = {}
  if (!value) return coordinates
  for (const match of value.matchAll(/'([^']+)'\s+(-?\d+(?:\.\d+)?)/g)) {
    const tag = match[1]
    const number = Number(match[2])
    if (tag && Number.isFinite(number)) coordinates[tag] = number
  }
  return coordinates
}

/**
 * Hover steps must list the same axes. A step that drops an axis (or adds one)
 * cannot interpolate, so the preview snaps to that instance.
 */
function shareVariationAxes(rows: InstanceRow[]): InstanceRow[] {
  const parsed = rows.map((row) => parseVariation(row.variation))
  const tags: string[] = []
  for (const coordinates of parsed) {
    for (const tag of Object.keys(coordinates)) {
      if (!tags.includes(tag)) tags.push(tag)
    }
  }
  if (tags.length === 0) return rows
  return rows.map((row, index) => {
    const coordinates = parsed[index] ?? {}
    let missing = false
    const filled: Record<string, number> = {}
    for (const tag of tags) {
      const value = coordinates[tag]
      if (value !== undefined) {
        filled[tag] = value
        continue
      }
      missing = true
      filled[tag] = parsed.find((item) => item[tag] !== undefined)?.[tag] ?? 0
    }
    if (!missing) return row
    return { ...row, variation: variationSettings(filled) }
  })
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

export function variableInstanceNames(face: FontFaceInfo): string[] {
  if (face.instanceNames.length > 0) return face.instanceNames
  return face.namedInstances?.map((item) => item.name) ?? []
}

/** CSS variation for a VF named instance, including wght fallback when fvar coords are absent. */
export function instanceRowVariation(face: FontFaceInfo, instanceName: string): string | undefined {
  const named = face.namedInstances?.find((item) => item.name === instanceName)
  if (named?.coordinates && Object.keys(named.coordinates).length > 0) {
    return variationSettings(named.coordinates)
  }
  if (!face.isVariable) return undefined
  return variationSettings({ wght: weightFromStyleName(instanceName, face.weight) })
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
  retailTrial = false,
): InstanceRow[] {
  const format = entryFormatOf(entry) || undefined
  const dest = entryCopyDestinations(entry)
  const instanceNames = variableInstanceNames(face)
  if (face.isVariable && instanceNames.length > 0) {
    return instanceNames.map((name) => ({
      key: `${entry.id}-${face.postscriptName}-${name}`,
      label: name,
      sublabel: face.postscriptName,
      catalogEntryId: entry.id,
      weight: weightFromStyleName(name, face.weight),
      italic: italicFromStyleName(name, face.italic),
      variation: instanceRowVariation(face, name),
      previewSample: entry.previewSample,
      hasSource,
      retailSynced,
      retailTrial,
    }))
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
      retailTrial,
      macosCopy: dest.macos,
      adobeCopy: dest.adobe,
      previewSample: entry.previewSample,
    },
  ]
}

export function catalogInstanceRows(group: FamilyGroup, retail?: RetailSyncView | null): InstanceRow[] {
  const rows: InstanceRow[] = []
  for (const entry of group.entries) {
    const installState = instanceInstallState(entry)
    const hasSource = entryHasTrackedSource(entry)
    const retailSynced = entryHasActiveRetailSync(entry, retail)
    const retailTrial = retailSynced && retail?.mode === 'trial'
    for (const face of entry.faces) {
      rows.push(...rowsFromFace(face, entry, installState, hasSource, retailSynced, retailTrial))
    }
  }
  return rows
}

function entryHasHoverInstances(entry: CatalogEntry): boolean {
  return entry.faces.some((face) => face.isVariable && variableInstanceNames(face).length > 0)
}

/**
 * The variable file the card is showing. A family can hold several VF files; hover
 * uses the preview file, or the only VF when static cuts share the card with it.
 */
function hoverVariableEntry(group: FamilyGroup): CatalogEntry | undefined {
  const vfEntries = group.entries.filter(entryHasHoverInstances)
  if (vfEntries.length === 0) return undefined
  const preview = vfEntries.find((entry) => entry.id === group.previewEntryId)
  if (preview) return preview
  return vfEntries.length === 1 ? vfEntries[0] : undefined
}

/** Face the card rests on: the first upright variable face, or the only face in an italic file. */
function restingHoverFace(entry: CatalogEntry): FontFaceInfo | undefined {
  const faces = entry.faces.filter((face) => face.isVariable && variableInstanceNames(face).length > 0)
  return faces.find((face) => !face.italic) ?? faces[0]
}

/**
 * Instance rows for grid hover preview. Rows come from the variable file behind
 * the card and keep the resting face's italic flag. `rowsFromFace` sets that
 * flag per instance name, so a file that mixes upright and italic instances
 * would otherwise fail the smooth check. Widths stay in the cycle: they are
 * other values of the same axes.
 */
export function catalogHoverInstanceRows(group: FamilyGroup, retail?: RetailSyncView | null): InstanceRow[] {
  const rows = catalogInstanceRows(group, retail)
  const chosen = hoverVariableEntry(group)
  if (!chosen) return rows
  const rest = restingHoverFace(chosen)
  if (!rest) return rows.filter((row) => row.catalogEntryId === chosen.id)
  const italic = Boolean(rest.italic)
  const cut: InstanceRow[] = []
  for (const face of chosen.faces) {
    if (face.familyName !== rest.familyName) continue
    if (!face.isVariable || variableInstanceNames(face).length === 0) continue
    for (const row of rows) {
      if (row.catalogEntryId !== chosen.id || row.sublabel !== face.postscriptName) continue
      if (Boolean(row.italic) !== italic) continue
      cut.push(row)
    }
  }
  return shareVariationAxes(cut)
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

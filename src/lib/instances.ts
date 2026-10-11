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

export type WidthClass =
  | 'ultra-condensed'
  | 'extra-condensed'
  | 'condensed'
  | 'semi-condensed'
  | 'normal'
  | 'semi-expanded'
  | 'expanded'
  | 'extra-expanded'
  | 'ultra-expanded'

const WIDTH_CLASS_PATTERNS: Array<[WidthClass, RegExp]> = [
  ['ultra-condensed', /ultracondensed/],
  ['extra-condensed', /extracondensed|extracompressed/],
  ['semi-condensed', /semicondensed|semicompressed/],
  ['condensed', /condensed|compressed/],
  ['ultra-expanded', /ultraexpanded|ultraextended/],
  ['extra-expanded', /extraexpanded|extraextended/],
  ['semi-expanded', /semiexpanded|semiextended/],
  ['expanded', /expanded|extended/],
]

/** Width cut named in a family, style, or instance, ignoring weight and italic words. */
export function widthClassFromName(name: string): WidthClass | undefined {
  const compact = name.replace(/[\s\-_]/g, '').toLowerCase()
  for (const [width, pattern] of WIDTH_CLASS_PATTERNS) {
    if (pattern.test(compact)) return width
  }
  return undefined
}

function faceWidthClass(face: FontFaceInfo): WidthClass {
  return widthClassFromName(face.styleName) ?? widthClassFromName(face.familyName) ?? 'normal'
}

/** wdth 100 is the normal cut. Other values follow the OpenType width-class percentages. */
function widthClassFromAxis(coordinates?: Record<string, number>): WidthClass | undefined {
  const wdth = coordinates?.wdth
  if (wdth === undefined || !Number.isFinite(wdth)) return undefined
  if (wdth <= 50) return 'ultra-condensed'
  if (wdth <= 62.5) return 'extra-condensed'
  if (wdth <= 75) return 'condensed'
  if (wdth < 100) return 'semi-condensed'
  if (wdth === 100) return 'normal'
  if (wdth < 125) return 'semi-expanded'
  if (wdth === 125) return 'expanded'
  if (wdth <= 150) return 'extra-expanded'
  return 'ultra-expanded'
}

function rowWidthClass(face: FontFaceInfo, label: string): WidthClass {
  const named = face.namedInstances?.find((item) => item.name === label)
  return widthClassFromAxis(named?.coordinates) ?? widthClassFromName(label) ?? faceWidthClass(face)
}

export type InstanceRow = {
  key: string
  label: string
  sublabel?: string
  catalogEntryId?: string
  systemPath?: string
  format?: string
  weight?: number
  italic?: boolean
  /** Width cut of this named instance, so hover can stay inside one width family. */
  widthClass?: WidthClass
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

function namedWidth(face: FontFaceInfo): WidthClass | undefined {
  return widthClassFromName(face.styleName) ?? widthClassFromName(face.familyName)
}

/** Width of the cut the card is showing, including a width that lives only on the first instance. */
function restingWidth(face: FontFaceInfo): WidthClass {
  const named = namedWidth(face)
  if (named) return named
  const first = variableInstanceNames(face)[0]
  return first ? rowWidthClass(face, first) : faceWidthClass(face)
}

/**
 * Instance rows for grid hover preview. Rows come from the single VF entry behind
 * the card and keep that resting face's family, width class, and italic flag, so
 * every row shares the file's variation axes and preview text.
 */
export function catalogHoverInstanceRows(group: FamilyGroup, retail?: RetailSyncView | null): InstanceRow[] {
  const rows = catalogInstanceRows(group, retail)
  const chosen = hoverVariableEntry(group)
  if (!chosen) return rows
  const rest = restingHoverFace(chosen)
  if (!rest) return rows.filter((row) => row.catalogEntryId === chosen.id)
  const italic = Boolean(rest.italic)
  const width = restingWidth(rest)
  const cut: InstanceRow[] = []
  for (const face of chosen.faces) {
    if (face.familyName !== rest.familyName || Boolean(face.italic) !== italic) continue
    const faceWidth = namedWidth(face)
    if (faceWidth && faceWidth !== width) continue
    if (!face.isVariable || variableInstanceNames(face).length === 0) continue
    for (const row of rows) {
      if (row.catalogEntryId !== chosen.id || row.sublabel !== face.postscriptName) continue
      if (Boolean(row.italic) !== italic || rowWidthClass(face, row.label) !== width) continue
      cut.push({ ...row, widthClass: width })
    }
  }
  return cut
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

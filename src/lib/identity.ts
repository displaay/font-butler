import { entryFormatOf, instancesOverlap, normalizeFormat } from './formats.ts'
import type { CatalogEntry, DestinationId, FontFaceInfo } from './types.ts'

function faceIdentityKey(faces: FontFaceInfo[], format?: string): string | null {
  const names = faces.map((face) => face.postscriptName.trim()).filter(Boolean)
  if (names.length === 0 || names.length !== faces.length) {
    return null
  }
  const faceKey = names.slice().sort().join('\0')
  if (format === undefined) {
    return faceKey
  }
  return `${normalizeFormat(format)}\0${faceKey}`
}

export function sameFaceIdentity(
  left: Pick<CatalogEntry, 'faces' | 'format' | 'sourcePath'>,
  right: Pick<CatalogEntry, 'faces' | 'format' | 'sourcePath'>,
  options: { sameFormat?: boolean } = {},
): boolean {
  const requireFormat = options.sameFormat !== false
  const leftKey = faceIdentityKey(left.faces, requireFormat ? entryFormatOf(left) : undefined)
  const rightKey = faceIdentityKey(right.faces, requireFormat ? entryFormatOf(right) : undefined)
  if (leftKey && rightKey && leftKey === rightKey) return true
  if (!instancesOverlap(left, right)) return false
  if (!requireFormat) return true
  return normalizeFormat(entryFormatOf(left)) === normalizeFormat(entryFormatOf(right))
}

export function catalogOccupiedDestinations(entry: CatalogEntry): DestinationId[] {
  if (entry.occupiedDestinations) {
    return entry.occupiedDestinations
  }
  const dests: DestinationId[] = []
  const macos = entry.installations?.find((copy) => copy.destinationId === 'macos')
  if (macos) {
    if (!macos.parkedPath && macos.verification === 'file-present') dests.push('macos')
  } else if (
    entry.installedPath &&
    !entry.disabledPath &&
    (entry.status === 'installed' || entry.status === 'outdated')
  ) {
    dests.push('macos')
  }
  const adobe = entry.installations?.find((copy) => copy.destinationId === 'adobe-shared')
  if (adobe && !adobe.parkedPath && adobe.verification === 'file-present') {
    dests.push('adobe-shared')
  }
  return dests
}

export function occupyingSiblings(entry: CatalogEntry, catalog: CatalogEntry[]): CatalogEntry[] {
  return catalog.filter((other) => {
    if (other.id === entry.id) return false
    if (!sameFaceIdentity(entry, other, { sameFormat: true })) return false
    return catalogOccupiedDestinations(other).length > 0
  })
}

export function canSwitchTo(entry: CatalogEntry, catalog: CatalogEntry[]): boolean {
  if (entry.previewOnly) return false
  if (entry.status !== 'deactivated' && entry.status !== 'uninstalled') return false
  return occupyingSiblings(entry, catalog).length > 0
}

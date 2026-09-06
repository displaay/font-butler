import type { CatalogEntry } from './types'

export function displayStateParts(entry: CatalogEntry): string[] {
  const parts: string[] = []
  if (entry.previewOnly) {
    parts.push('Web font · Preview only')
  } else if (entry.status === 'deactivated') {
    parts.push('Deactivated')
  } else if (entry.status === 'uninstalled' || entry.status === 'source-missing') {
    parts.push(entry.installedPath || entry.disabledPath ? 'Deactivated' : 'Not installed')
  } else {
    parts.push('Installed')
    const copies = entry.installations ?? []
    const macos = copies.some((copy) => copy.destinationId === 'macos' && copy.verification !== 'unavailable')
    const adobe = copies.some((copy) => copy.destinationId === 'adobe-shared' && copy.verification !== 'unavailable')
    if (macos && adobe) parts.push('This Mac and Adobe testing folder')
    else if (adobe && !entry.installedPath) parts.push('Adobe testing folder')
    else if (adobe) parts.push('This Mac and Adobe testing folder')
  }
  const availability = entry.sourceAvailability
  if (availability === 'missing' || entry.status === 'source-missing') {
    parts.push('Source missing')
  } else if (availability === 'offline') {
    parts.push('Source drive offline')
  } else if (availability === 'unreadable') {
    parts.push('Source unreadable')
  } else if (entry.status === 'outdated' || entry.updateHold === 'relink-review') {
    parts.push('Update available')
  }
  if (entry.updateHold === 'restore') {
    parts.push('Updates paused after restore')
  } else if (entry.updateHold === 'relink-review') {
    parts.push('Review incoming source')
  }
  return [...new Set(parts)]
}

export function displayStateLabel(entry: CatalogEntry): string {
  return displayStateParts(entry).join(' · ')
}

export function isNotInstalledLabel(entry: CatalogEntry): boolean {
  return displayStateParts(entry).includes('Not installed')
}

export function needsLocateSource(entry: CatalogEntry): boolean {
  if (entry.previewOnly) return entry.sourceAvailability === 'missing' || entry.status === 'source-missing'
  return (
    entry.sourceAvailability === 'missing' ||
    entry.status === 'source-missing' ||
    (entry.sourceAvailability === 'none' && Boolean(entry.installedPath))
  )
}

export function collectionScopeLabel(entry: CatalogEntry): string | null {
  if (entry.faces.length <= 1) return null
  return `This changes all ${entry.faces.length} faces in this collection.`
}

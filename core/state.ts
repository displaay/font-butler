import fs from 'node:fs'
import path from 'node:path'
import { destinationSummary, hasManagedCopy, syncLegacyInstallations } from './destinations.ts'
import type {
  CatalogEntry,
  FontStatus,
  SourceAvailability,
  SourceComparison,
  UpdateHold,
  UpdatePolicy,
} from './types.ts'

function resolvedPath(value: string | undefined): string | undefined {
  if (!value) return undefined
  return path.resolve(value)
}

function isExternalSource(entry: CatalogEntry): boolean {
  const source = resolvedPath(entry.sourcePath)
  if (!source) return false
  if (source === resolvedPath(entry.installedPath) || source === resolvedPath(entry.disabledPath)) {
    return false
  }
  if (entry.installations?.some((copy) =>
    source === resolvedPath(copy.path) || source === resolvedPath(copy.parkedPath),
  )) {
    return false
  }
  return true
}

function fileExists(filePath: string | undefined): boolean {
  if (!filePath) return false
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

const VOLUME_ROOTS = new Set(['/Volumes', '/media', '/mnt', '/run/media'])

export function inspectSourceAvailability(
  sourcePath: string,
  options: { linked?: boolean; external?: boolean } = {},
): SourceAvailability {
  if (options.linked === false || options.external === false) {
    return 'none'
  }
  if (!sourcePath) {
    return 'none'
  }
  const resolved = path.resolve(sourcePath)
  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      fs.accessSync(resolved, fs.constants.R_OK)
      return 'present'
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code === 'EACCES' || code === 'EPERM') {
      return 'unreadable'
    }
  }
  let current = path.dirname(resolved)
  const root = path.parse(resolved).root
  while (true) {
    if (fs.existsSync(current)) {
      if (VOLUME_ROOTS.has(current) || /^[A-Za-z]:\\?$/.test(current)) {
        return 'offline'
      }
      return 'missing'
    }
    if (current === root || path.dirname(current) === current) {
      return current === root && !fs.existsSync(root) ? 'offline' : 'missing'
    }
    current = path.dirname(current)
  }
}

export function entryHasLinkedSource(entry: CatalogEntry): boolean {
  return isExternalSource(entry) && Boolean(entry.sourcePath)
}

export function deriveSourceAvailability(entry: CatalogEntry): SourceAvailability {
  if (!entryHasLinkedSource(entry)) {
    return 'none'
  }
  return inspectSourceAvailability(entry.sourcePath, { linked: true, external: true })
}

export function deriveSourceComparison(entry: CatalogEntry): SourceComparison {
  if (entry.updateHold === 'relink-review') {
    return 'update-available'
  }
  if (entry.status === 'outdated') {
    return 'update-available'
  }
  if (
    entry.installedFingerprint &&
    entry.sourceFingerprint &&
    entry.installedFingerprint !== entry.sourceFingerprint &&
    entry.sourceAvailability === 'present'
  ) {
    return 'update-available'
  }
  if (entry.previousRevisionId && entry.installedFingerprint !== entry.previousRevisionId) {
    if (entry.updateHold === 'restore') {
      return 'retained-different'
    }
  }
  if (entry.status === 'source-missing') {
    return 'pending'
  }
  return 'current'
}

export function displayStateParts(entry: CatalogEntry): string[] {
  const parts: string[] = []
  if (entry.previewOnly) {
    parts.push('Web font · Preview only')
  } else if (entry.status === 'deactivated') {
    parts.push('Deactivated')
  } else if (entry.status === 'uninstalled' || entry.status === 'source-missing') {
    parts.push(entry.installedPath || entry.disabledPath ? 'Deactivated' : 'Not installed')
  } else if (entry.status === 'installed' || entry.status === 'outdated') {
    parts.push('Installed')
    const destinations = destinationSummary(entry)
    if (destinations) parts.push(destinations)
  }
  const availability = entry.sourceAvailability ?? deriveSourceAvailability(entry)
  if (availability === 'missing') {
    parts.push('Source missing')
  } else if (availability === 'offline') {
    parts.push('Source drive offline')
  } else if (availability === 'unreadable') {
    parts.push('Source unreadable')
  } else if (entry.status === 'outdated' || deriveSourceComparison(entry) === 'update-available') {
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

export function applyEntryFacts(entry: CatalogEntry): boolean {
  syncLegacyInstallations(entry)
  const availability = deriveSourceAvailability(entry)
  let changed = entry.sourceAvailability !== availability
  entry.sourceAvailability = availability
  const present = availability === 'present'
  if (entry.sourcePresent !== present) {
    entry.sourcePresent = present
    changed = true
  }
  if (!entryHasLinkedSource(entry)) {
    return changed
  }
  if (availability === 'offline' || availability === 'unreadable') {
    return changed
  }
  if (!present) {
    const next = statusWhenSourceMissing(entry)
    if (entry.status !== next) {
      entry.status = next
      changed = true
    }
    return changed
  }
  if (entry.status === 'source-missing') {
    entry.status = statusWhenSourceFound(entry)
    changed = true
  }
  return changed
}

function statusForPresentCopy(entry: CatalogEntry): FontStatus | null {
  if (fileExists(entry.installedPath)) {
    return entry.status === 'deactivated' ? 'deactivated' : 'installed'
  }
  if (fileExists(entry.disabledPath)) {
    return 'deactivated'
  }
  if (entry.installations?.some((copy) => fileExists(copy.parkedPath))) {
    return 'deactivated'
  }
  if (hasManagedCopy(entry, 'adobe-shared')) {
    return 'installed'
  }
  return null
}

export function statusWhenSourceFound(entry: CatalogEntry): FontStatus {
  return statusForPresentCopy(entry) ?? 'uninstalled'
}

export function statusWhenSourceMissing(entry: CatalogEntry): FontStatus {
  return statusForPresentCopy(entry) ?? 'source-missing'
}

export function effectiveUpdatePolicy(
  entry: CatalogEntry,
  folder?: { paused?: boolean; autoUpdate?: boolean } | null,
  globalAuto = false,
): UpdatePolicy {
  if (entry.updatePolicy && entry.updatePolicy !== 'inherit') {
    return entry.updatePolicy
  }
  if (entry.updateHold) {
    return entry.updateHold === 'restore' ? 'paused-after-rollback' : 'manual'
  }
  if (folder?.paused) {
    return 'manual'
  }
  if (folder) {
    return folder.autoUpdate ? 'automatic' : 'manual'
  }
  return globalAuto ? 'automatic' : 'manual'
}

export function canAutomateUpdates(
  entry: CatalogEntry,
  folder?: { paused?: boolean; autoUpdate?: boolean } | null,
  globalAuto = false,
): boolean {
  if (entry.previewOnly) return false
  if (entry.updateHold) return false
  if (entry.status === 'deactivated' || entry.status === 'uninstalled') return false
  return effectiveUpdatePolicy(entry, folder, globalAuto) === 'automatic'
}

export function isCleanupEligible(entry: CatalogEntry): boolean {
  if (entry.status !== 'source-missing') return false
  if (entry.installedPath || entry.disabledPath) return false
  const availability = entry.sourceAvailability ?? deriveSourceAvailability(entry)
  return availability !== 'offline' && availability !== 'unreadable'
}

export function eligibleForInstall(entry: CatalogEntry): boolean {
  return entry.status === 'uninstalled' || entry.status === 'deactivated' || entry.status === 'outdated'
}

export function eligibleForDeactivate(entry: CatalogEntry): boolean {
  return entry.status === 'installed' || entry.status === 'outdated'
}

export function eligibleForReinstall(entry: CatalogEntry): boolean {
  return (
    entry.status === 'outdated' ||
    (entry.status === 'deactivated' && Boolean(entry.installedPath && fs.existsSync(entry.installedPath)))
  )
}

export function setUpdateHold(entry: CatalogEntry, hold: UpdateHold | null): void {
  entry.updateHold = hold
  if (hold === 'restore') {
    entry.updatePolicy = 'paused-after-rollback'
  } else if (hold === 'relink-review' || hold === 'undo-install') {
    if (entry.updatePolicy === 'automatic' || entry.updatePolicy === 'inherit') {
      entry.updatePolicy = 'manual'
    }
  }
}

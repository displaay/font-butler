import { canSwitchTo } from './identity.ts'
import {
  entryAddsUnoccupiedStyle,
  entryFormatOf,
  formatSwap,
  instanceFormatSwap,
  instanceSwapLabel,
  occupyingEntries,
  occupyingFormats,
  occupyingStyleKeys,
  preferredFormat,
  styleKeysForEntry,
  uniqueEntryFormats,
} from './formats.ts'
import type { FormatSwap } from './formats.ts'
import type { CatalogEntry, FamilyGroup } from './types'

function skipSwapIds(entries: CatalogEntry[]): Set<string> {
  return new Set(formatSwap(entries)?.incomingIds ?? [])
}

function isMissingStyle(entry: CatalogEntry, occupyingKeys: Set<string>): boolean {
  if (occupyingKeys.size === 0) return true
  return entryAddsUnoccupiedStyle(entry, occupyingKeys)
}

export function installableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  const skip = skipSwapIds(group.entries)
  const occupyingKeys = occupyingStyleKeys(group.entries)
  return group.entries.filter(
    (entry) =>
      entry.status === 'uninstalled' &&
      !entry.previewOnly &&
      !skip.has(entry.id) &&
      isMissingStyle(entry, occupyingKeys),
  )
}

export function activatableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  const skip = skipSwapIds(group.entries)
  const occupyingKeys = occupyingStyleKeys(group.entries)
  return group.entries.filter(
    (entry) =>
      entry.status === 'deactivated' &&
      !entry.previewOnly &&
      !skip.has(entry.id) &&
      isMissingStyle(entry, occupyingKeys),
  )
}

export function deactivatableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return group.entries.filter(
    (entry) => (entry.status === 'installed' || entry.status === 'outdated') && !entry.previewOnly,
  )
}

export function reinstallableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return group.entries.filter((entry) => entry.status === 'outdated' && !entry.previewOnly)
}

export function updateEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return reinstallableEntries(group)
}

function hasLiveMacCopy(entry: CatalogEntry): boolean {
  if (entry.installedPath || entry.disabledPath) return true
  return (entry.installations ?? []).some(
    (copy) => copy.destinationId === 'macos' && copy.verification === 'file-present',
  )
}

function managedCopyIsParked(entry: CatalogEntry, destinationId: 'macos' | 'adobe-shared'): boolean {
  if (destinationId === 'macos' && entry.disabledPath) return true
  const copy = (entry.installations ?? []).find((item) => item.destinationId === destinationId)
  return Boolean(copy?.parkedPath)
}

function copyNeedsRepair(entry: CatalogEntry): boolean {
  const adobeMissing =
    !managedCopyIsParked(entry, 'adobe-shared') &&
    (entry.installations ?? []).some(
      (copy) => copy.destinationId === 'adobe-shared' && copy.verification === 'unavailable',
    )
  const macosMissing =
    !managedCopyIsParked(entry, 'macos') &&
    (entry.installations ?? []).some(
      (copy) => copy.destinationId === 'macos' && copy.verification === 'unavailable',
    )
  if (adobeMissing || macosMissing) return true
  return Boolean(entry.previousRevisionId) && !hasLiveMacCopy(entry)
}

export function repairableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return group.entries.filter((entry) => !entry.previewOnly && copyNeedsRepair(entry))
}

export function uninstallableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return group.entries.filter(
    (entry) =>
      !entry.previewOnly &&
      (entry.status === 'installed' || entry.status === 'outdated' || entry.status === 'deactivated'),
  )
}

export function installableIds(group: { entries: CatalogEntry[] }): string[] {
  return installableEntries(group).map((entry) => entry.id)
}

export function activatableIds(group: { entries: CatalogEntry[] }): string[] {
  return activatableEntries(group).map((entry) => entry.id)
}

export function deactivatableIds(group: { entries: CatalogEntry[] }): string[] {
  return deactivatableEntries(group).map((entry) => entry.id)
}

export function reinstallableIds(group: { entries: CatalogEntry[] }): string[] {
  return reinstallableEntries(group).map((entry) => entry.id)
}

export function uninstallableIds(group: { entries: CatalogEntry[] }): string[] {
  return uninstallableEntries(group).map((entry) => entry.id)
}

export function repairableIds(group: { entries: CatalogEntry[] }): string[] {
  return repairableEntries(group).map((entry) => entry.id)
}

function adobeCopyPresent(entry: CatalogEntry): boolean {
  return (entry.installations ?? []).some(
    (copy) => copy.destinationId === 'adobe-shared' && copy.verification === 'file-present',
  )
}

export function adobeInstallableEntries(
  group: { entries: CatalogEntry[] },
  adobeAvailable = true,
): CatalogEntry[] {
  if (!adobeAvailable) return []
  const candidates = group.entries.filter((entry) => !entry.previewOnly && !adobeCopyPresent(entry))
  const covered = new Set<string>()
  for (const entry of group.entries) {
    if (!adobeCopyPresent(entry)) continue
    for (const key of styleKeysForEntry(entry)) covered.add(key)
  }
  const preferred =
    occupyingFormats(group.entries)[0] ?? preferredFormat(uniqueEntryFormats(candidates))
  const rank = (entry: CatalogEntry): number => {
    const occupying = occupyingEntries([entry]).length > 0
    const preferredMatch = Boolean(preferred) && entryFormatOf(entry) === preferred
    if (occupying && preferredMatch) return 0
    if (occupying) return 1
    if (preferredMatch) return 2
    return 3
  }
  const chosen: CatalogEntry[] = []
  for (const entry of [...candidates].sort((left, right) => rank(left) - rank(right))) {
    const keys = styleKeysForEntry(entry)
    if (keys.length === 0 || keys.every((key) => covered.has(key))) continue
    chosen.push(entry)
    for (const key of keys) covered.add(key)
  }
  return chosen
}

export function adobeInstallableIds(
  group: { entries: CatalogEntry[] },
  adobeAvailable = true,
): string[] {
  return adobeInstallableEntries(group, adobeAvailable).map((entry) => entry.id)
}

export type InstanceMenuPlan = {
  install: boolean
  activate: boolean
  deactivate: boolean
  uninstall: boolean
  adobeInstall: boolean
  formatSwap: FormatSwap | null
}

/** Per-catalog-entry actions for a list-row context menu (not family-scoped). */
export function instanceMenuPlan(
  entry: CatalogEntry,
  family: CatalogEntry[] = [entry],
  adobeAvailable = true,
): InstanceMenuPlan {
  if (entry.previewOnly) {
    return {
      install: false,
      activate: false,
      deactivate: false,
      uninstall: false,
      adobeInstall: false,
      formatSwap: null,
    }
  }
  const formatSwap = instanceFormatSwap(entry, family)
  return {
    install: entry.status === 'uninstalled' && !formatSwap,
    activate: entry.status === 'deactivated' && !formatSwap,
    deactivate: entry.status === 'installed' || entry.status === 'outdated',
    uninstall:
      entry.status === 'installed' ||
      entry.status === 'outdated' ||
      entry.status === 'deactivated',
    adobeInstall: adobeAvailable && !adobeCopyPresent(entry),
    formatSwap,
  }
}

export function hasInstanceMenuActions(plan: InstanceMenuPlan): boolean {
  return (
    plan.install ||
    plan.activate ||
    plan.deactivate ||
    plan.uninstall ||
    plan.adobeInstall ||
    Boolean(plan.formatSwap)
  )
}

export function instanceMenuLabels(
  entry: CatalogEntry,
  family: CatalogEntry[] = [entry],
  adobeAvailable = true,
): string[] {
  const plan = instanceMenuPlan(entry, family, adobeAvailable)
  const labels: string[] = []
  if (plan.formatSwap) labels.push(instanceSwapLabel(plan.formatSwap, entry.id))
  if (plan.install) labels.push('Install instance')
  if (plan.activate) labels.push('Activate instance')
  if (plan.adobeInstall) labels.push('Install to Adobe testing folder')
  if (plan.deactivate) labels.push('Deactivate instance')
  if (plan.uninstall) labels.push('Uninstall instance')
  return labels
}

export function switchableEntries(group: { entries: CatalogEntry[] }, catalog: CatalogEntry[]): CatalogEntry[] {
  return group.entries.filter((entry) => canSwitchTo(entry, catalog))
}

export function familyHasSwitch(group: { entries: CatalogEntry[] }, catalog: CatalogEntry[]): boolean {
  return switchableEntries(group, catalog).length > 0
}

export function familyHasAction(
  group: FamilyGroup,
  action: 'install' | 'activate' | 'deactivate' | 'reinstall' | 'uninstall',
): boolean {
  switch (action) {
    case 'install':
      return installableIds(group).length > 0
    case 'activate':
      return activatableIds(group).length > 0
    case 'deactivate':
      return deactivatableIds(group).length > 0
    case 'reinstall':
      return reinstallableIds(group).length > 0
    case 'uninstall':
      return uninstallableIds(group).length > 0
  }
}

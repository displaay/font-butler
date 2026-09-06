import type { CatalogEntry, FamilyGroup } from './types'

export function installableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return group.entries.filter((entry) => entry.status === 'uninstalled' && !entry.previewOnly)
}

export function activatableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return group.entries.filter((entry) => entry.status === 'deactivated' && !entry.previewOnly)
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

function copyNeedsRepair(entry: CatalogEntry): boolean {
  const adobeMissing = (entry.installations ?? []).some(
    (copy) => copy.destinationId === 'adobe-shared' && copy.verification === 'unavailable',
  )
  const macosMissing = (entry.installations ?? []).some(
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

export function adobeInstallableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return group.entries.filter((entry) => !entry.previewOnly && !adobeCopyPresent(entry))
}

export function adobeInstallableIds(group: { entries: CatalogEntry[] }): string[] {
  return adobeInstallableEntries(group).map((entry) => entry.id)
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

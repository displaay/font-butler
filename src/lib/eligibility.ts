import type { CatalogEntry, FamilyGroup } from './types'

export function installableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return group.entries.filter((entry) => entry.status === 'uninstalled')
}

export function activatableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return group.entries.filter((entry) => entry.status === 'deactivated')
}

export function deactivatableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return group.entries.filter((entry) => entry.status === 'installed' || entry.status === 'outdated')
}

export function reinstallableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return group.entries.filter((entry) => entry.status === 'outdated')
}

export function uninstallableEntries(group: { entries: CatalogEntry[] }): CatalogEntry[] {
  return group.entries.filter(
    (entry) =>
      entry.status === 'installed' || entry.status === 'outdated' || entry.status === 'deactivated',
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

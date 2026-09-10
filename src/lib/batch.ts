import {
  activatableEntries,
  activatableIds,
  adobeInstallableIds,
  adobeRemovableIds,
  deactivatableIds,
  installableIds,
  reinstallableIds,
  repairableIds,
  uninstallableIds,
} from './eligibility.ts'
import { uniqueEntryFormats } from './formats.ts'
import {
  deletableSourceIds,
  familyBadgeEntry,
  hasTrackedSource,
  isForgettableOnlyGroup,
  isUninstallableGroup,
} from './group.ts'
import { displayStateParts } from './state.ts'
import type { FamilyGroup, SystemFamilyGroup } from './types.ts'

export type CatalogBatchPlan = {
  count: number
  install: number
  installMissing: boolean
  adobeInstall: number
  adobeUninstall: number
  activate: number
  activateFormat?: string
  deactivate: number
  uninstall: number
  uninstallAndRemove: number
  reinstall: number
  repair: number
  forget: number
  deleteFiles: number
}

export type SystemBatchPlan = {
  count: number
  deactivate: number
  uninstall: number
}

export function catalogBatchPlan(groups: FamilyGroup[], adobeAvailable = true): CatalogBatchPlan {
  let install = 0
  let adobeInstall = 0
  let adobeUninstall = 0
  let activate = 0
  let deactivate = 0
  let uninstall = 0
  let uninstallAndRemove = 0
  let reinstall = 0
  let repair = 0
  let forget = 0
  let deleteFiles = 0
  let installMissing = false
  for (const group of groups) {
    const toInstall = installableIds(group)
    install += toInstall.length
    adobeInstall += adobeInstallableIds(group, adobeAvailable).length
    adobeUninstall += adobeRemovableIds(group).length
    if (
      toInstall.length > 0 &&
      group.entries.some(
        (entry) =>
          entry.status === 'installed' ||
          entry.status === 'outdated' ||
          entry.status === 'deactivated',
      )
    ) {
      installMissing = true
    }
    activate += activatableIds(group).length
    deactivate += deactivatableIds(group).length
    const toUninstall = uninstallableIds(group)
    if (toUninstall.length || isUninstallableGroup(group)) {
      uninstall += toUninstall.length || 1
      if (hasTrackedSource(group)) uninstallAndRemove += 1
    }
    reinstall += reinstallableIds(group).length
    repair += repairableIds(group).length
    if (isForgettableOnlyGroup(group)) forget += 1
    if (deletableSourceIds(group).length > 0) deleteFiles += 1
  }
  const activating = groups.flatMap((group) => activatableEntries(group))
  const familyFormats = uniqueEntryFormats(groups.flatMap((group) => group.entries))
  const activatingFormats = uniqueEntryFormats(activating)
  const activateFormat =
    familyFormats.length > 1 && activatingFormats.length === 1 ? activatingFormats[0] : undefined
  return {
    count: groups.length,
    install,
    installMissing,
    adobeInstall,
    adobeUninstall,
    activate,
    ...(activateFormat ? { activateFormat } : {}),
    deactivate,
    uninstall,
    uninstallAndRemove,
    reinstall,
    repair,
    forget,
    deleteFiles,
  }
}

/**
 * Hover/context actions for one family card. Mixed families keep honest
 * Install-missing + Deactivate-installed counts; a Not installed badge never
 * offers Deactivate / Uninstall / Activate / Update.
 */
export function familyCardPlan(group: FamilyGroup, adobeAvailable = true): CatalogBatchPlan {
  const plan = catalogBatchPlan([group], adobeAvailable)
  if (!displayStateParts(familyBadgeEntry(group)).includes('Not installed')) {
    return plan
  }
  if (
    plan.deactivate === 0 &&
    plan.uninstall === 0 &&
    plan.activate === 0 &&
    plan.reinstall === 0
  ) {
    return plan
  }
  return {
    ...plan,
    deactivate: 0,
    uninstall: 0,
    activate: 0,
    activateFormat: undefined,
    reinstall: 0,
  }
}

export function systemBatchPlan(groups: SystemFamilyGroup[]): SystemBatchPlan {
  const writable = groups.filter((group) => group.writable).length
  return {
    count: groups.length,
    deactivate: writable,
    uninstall: writable,
  }
}

export function catalogBatchSummary(groups: FamilyGroup[]): string {
  return countLabels(
    groups.map((group) => group.status),
    [
      ['installed', 'installed'],
      ['outdated', 'outdated'],
      ['deactivated', 'deactivated'],
      ['uninstalled', 'uninstalled'],
      ['source-missing', 'missing source'],
    ],
  )
}

export function systemBatchSummary(groups: SystemFamilyGroup[]): string {
  const writable = groups.filter((group) => group.writable).length
  const locked = groups.length - writable
  return [
    writable ? `${writable} removable` : '',
    locked ? `${locked} system` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function hasCatalogBatchActions(plan: CatalogBatchPlan): boolean {
  return (
    plan.install > 0 ||
    plan.adobeInstall > 0 ||
    plan.adobeUninstall > 0 ||
    plan.activate > 0 ||
    plan.deactivate > 0 ||
    plan.uninstall > 0 ||
    plan.uninstallAndRemove > 0 ||
    plan.reinstall > 0 ||
    plan.repair > 0 ||
    plan.forget > 0 ||
    plan.deleteFiles > 0
  )
}

export function hasSystemBatchActions(plan: SystemBatchPlan): boolean {
  return plan.deactivate > 0 || plan.uninstall > 0
}

export function actionLabel(verb: string, count: number, multi: boolean): string {
  if (verb === 'Install update') {
    return count === 1 && !multi ? 'Install update' : `Install ${count} updates`
  }
  if (verb === 'Install missing') {
    return count === 1 && !multi ? 'Install missing style' : `Install ${count} missing styles`
  }
  if (verb === 'Deactivate' || verb === 'Uninstall') {
    return verb
  }
  if (verb === 'Install to Adobe testing folder' || verb === 'Uninstall from Adobe testing folder') {
    return verb
  }
  if (verb === 'Uninstall and delete sources') {
    return count === 1 && !multi
      ? verb
      : `Uninstall and delete sources of ${count} ${count === 1 ? 'font' : 'fonts'}`
  }
  if (!multi) return verb
  return `${verb} ${count} ${count === 1 ? 'font' : 'fonts'}`
}

export function activateActionLabel(
  plan: Pick<CatalogBatchPlan, 'activate' | 'activateFormat'>,
  multi = false,
): string {
  if (plan.activateFormat) return `Activate ${plan.activateFormat.toUpperCase()}`
  return actionLabel('Activate', plan.activate, multi)
}

export function forgetSourcesLabel(count: number, multi: boolean): string {
  if (count <= 1 && !multi) return 'Remove from list'
  return `Remove ${count} source${count === 1 ? '' : 's'} from list`
}

export function deleteSourcesLabel(count: number, multi: boolean): string {
  if (count <= 1 && !multi) return 'Delete source files'
  return `Delete ${count} source file${count === 1 ? '' : 's'}`
}

export function fileActionLabel(
  verb: 'install' | 'update' | 'deactivate' | 'activate' | 'uninstall' | 'repair',
  count: number,
  mixed: boolean,
): string {
  if (verb === 'update') return count <= 1 ? 'Install update' : `Install ${count} updates`
  if (verb === 'install') {
    return mixed || count > 1 ? (count === 1 ? 'Install missing style' : `Install ${count} missing styles`) : 'Install'
  }
  if (verb === 'deactivate') return 'Deactivate'
  if (verb === 'uninstall') return 'Uninstall'
  if (verb === 'repair') return 'Reinstall installed version'
  if (!mixed && count <= 1) return verb[0]!.toUpperCase() + verb.slice(1)
  return `${verb[0]!.toUpperCase()}${verb.slice(1)} ${count} ${count === 1 ? 'file' : 'files'}`
}

function countLabels<T extends string>(values: T[], order: [T, string][]): string {
  const counts = new Map<T, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return order
    .filter(([key]) => counts.get(key))
    .map(([key, label]) => `${counts.get(key)} ${label}`)
    .join(' · ')
}

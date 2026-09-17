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
import { occupyingStyleCount, uniqueEntryFormats, uniqueStyleCount } from './formats.ts'
import {
  deletableSourceIds,
  familyBadgeEntry,
  hasTrackedSource,
  isForgettableOnlyGroup,
  isUninstallableGroup,
} from './group.ts'
import { displayStateParts } from './state.ts'
import type { FamilyGroup, FontStatus, SystemFamilyGroup } from './types.ts'

export type CatalogBatchPlan = {
  count: number
  install: number
  /** Families with something to install. The green Install button counts these, not styles. */
  installFonts: number
  installMissing: boolean
  adobeInstall: number
  adobeUninstall: number
  activate: number
  activateFormat?: string
  /** Occupying style count when some, but not all, family styles are active. */
  partialActiveStyles?: number
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

/**
 * Multi-select keeps only actions every selected family can take.
 * A single family still unions its styles (install-missing + deactivate-installed).
 */
export function catalogBatchPlan(groups: FamilyGroup[], adobeAvailable = true): CatalogBatchPlan {
  const plan = catalogBatchPlanUnion(groups, adobeAvailable)
  if (groups.length <= 1) return plan
  const parts = groups.map((group) => catalogBatchPlanUnion([group], adobeAvailable))
  const shared = (count: (part: CatalogBatchPlan) => number) =>
    parts.every((part) => count(part) > 0) ? count(plan) : 0
  const install = shared((part) => part.install)
  const activate = shared((part) => part.activate)
  return {
    count: plan.count,
    install,
    installFonts: install ? plan.installFonts : 0,
    installMissing: Boolean(install && parts.every((part) => part.installMissing)),
    adobeInstall: shared((part) => part.adobeInstall),
    adobeUninstall: shared((part) => part.adobeUninstall),
    activate,
    ...(activate && plan.activateFormat ? { activateFormat: plan.activateFormat } : {}),
    deactivate: shared((part) => part.deactivate),
    uninstall: shared((part) => part.uninstall),
    uninstallAndRemove: shared((part) => part.uninstallAndRemove),
    reinstall: shared((part) => part.reinstall),
    repair: shared((part) => part.repair),
    forget: shared((part) => part.forget),
    deleteFiles: shared((part) => part.deleteFiles),
  }
}

function catalogBatchPlanUnion(groups: FamilyGroup[], adobeAvailable = true): CatalogBatchPlan {
  let install = 0
  let installFonts = 0
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
    if (toInstall.length) installFonts += 1
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
    if (activatableIds(group).length) activate += 1
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
  let partialActiveStyles: number | undefined
  if (groups.length === 1) {
    const entries = groups[0]!.entries
    const total = uniqueStyleCount(entries)
    const active = occupyingStyleCount(entries)
    if (active > 0 && active < total) partialActiveStyles = active
  }
  const activateFormat =
    activatingFormats.length === 1 && (familyFormats.length > 1 || Boolean(partialActiveStyles))
      ? activatingFormats[0]
      : undefined
  return {
    count: groups.length,
    install,
    installFonts,
    installMissing,
    adobeInstall,
    adobeUninstall,
    activate,
    ...(activateFormat ? { activateFormat } : {}),
    ...(partialActiveStyles ? { partialActiveStyles } : {}),
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
    plan.uninstallAndRemove === 0 &&
    plan.activate === 0 &&
    plan.reinstall === 0
  ) {
    return plan
  }
  return {
    ...plan,
    deactivate: 0,
    uninstall: 0,
    uninstallAndRemove: 0,
    activate: 0,
    activateFormat: undefined,
    partialActiveStyles: undefined,
    reinstall: 0,
  }
}

export function systemBatchPlan(groups: SystemFamilyGroup[]): SystemBatchPlan {
  const writable = groups.filter((group) => group.writable).length
  const allWritable = groups.length > 0 && writable === groups.length
  return {
    count: groups.length,
    deactivate: allWritable ? writable : 0,
    uninstall: allWritable ? writable : 0,
  }
}

const CATALOG_STATUS_LABELS: [FontStatus, string][] = [
  ['installed', 'installed'],
  ['outdated', 'outdated'],
  ['deactivated', 'deactivated'],
  ['uninstalled', 'uninstalled'],
  ['source-missing', 'missing source'],
]

export type CatalogBatchSummaryPart = {
  status: FontStatus
  count: number
  label: string
}

export type SystemBatchSummaryPart = {
  kind: 'removable' | 'system'
  count: number
  label: string
}

export function catalogBatchSummaryParts(groups: FamilyGroup[]): CatalogBatchSummaryPart[] {
  const counts = new Map<FontStatus, number>()
  for (const group of groups) {
    counts.set(group.status, (counts.get(group.status) ?? 0) + 1)
  }
  return CATALOG_STATUS_LABELS.flatMap(([status, label]) => {
    const count = counts.get(status)
    return count ? [{ status, count, label }] : []
  })
}

export function catalogBatchSummary(groups: FamilyGroup[]): string {
  return joinSummaryParts(catalogBatchSummaryParts(groups))
}

export function catalogKeysForStatus(groups: FamilyGroup[], status: FontStatus): string[] {
  return groups.filter((group) => group.status === status).map((group) => group.familyName)
}

export function systemBatchSummaryParts(groups: SystemFamilyGroup[]): SystemBatchSummaryPart[] {
  const removable = groups.filter((group) => group.writable).length
  const locked = groups.length - removable
  return [
    removable ? { kind: 'removable' as const, count: removable, label: 'removable' } : null,
    locked ? { kind: 'system' as const, count: locked, label: 'system' } : null,
  ].filter((part) => part !== null)
}

export function systemBatchSummary(groups: SystemFamilyGroup[]): string {
  return joinSummaryParts(systemBatchSummaryParts(groups))
}

export function systemKeysForKind(
  groups: SystemFamilyGroup[],
  kind: SystemBatchSummaryPart['kind'],
): string[] {
  return groups
    .filter((group) => (kind === 'removable' ? group.writable : !group.writable))
    .map((group) => group.familyName)
}

function joinSummaryParts(parts: Array<{ count: number; label: string }>): string {
  return parts.map((part) => `${part.count} ${part.label}`).join(' · ')
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
  if (verb === 'Install to Adobe folder' || verb === 'Uninstall from Adobe folder') {
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

/** Green Install button: families when installing whole fonts, styles when filling in a mixed family. */
export function installActionLabel(
  plan: Pick<CatalogBatchPlan, 'install' | 'installFonts' | 'installMissing' | 'count'>,
  multi = false,
): string {
  if (plan.installMissing) {
    return actionLabel('Install missing', plan.install, plan.install > 1 || multi)
  }
  const fonts = plan.installFonts
  return actionLabel('Install', fonts, fonts > 1 || multi)
}

export function activateActionLabel(
  plan: Pick<CatalogBatchPlan, 'activate' | 'activateFormat' | 'partialActiveStyles'>,
  multi = false,
): string {
  const remaining = Boolean(plan.partialActiveStyles) && !multi
  if (remaining) {
    return plan.activateFormat
      ? `Activate remaining ${plan.activateFormat.toUpperCase()}`
      : 'Activate remaining'
  }
  if (plan.activateFormat) return `Activate ${plan.activateFormat.toUpperCase()}`
  return actionLabel('Activate', plan.activate, multi)
}

export function deactivateActionLabel(
  plan: Pick<CatalogBatchPlan, 'partialActiveStyles'>,
  multi = false,
): string {
  if (plan.partialActiveStyles && !multi) {
    const n = plan.partialActiveStyles
    return `Deactivate ${n} ${n === 1 ? 'style' : 'styles'}`
  }
  return 'Deactivate'
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

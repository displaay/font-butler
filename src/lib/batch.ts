import {
  activatableIds,
  deactivatableIds,
  installableIds,
  reinstallableIds,
  repairableIds,
  uninstallableIds,
} from './eligibility.ts'
import { hasTrackedSource, isUninstallableGroup } from './group.ts'
import type { FamilyGroup, SystemFamilyGroup } from './types.ts'

export type CatalogBatchPlan = {
  count: number
  install: number
  installMissing: boolean
  activate: number
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

export function catalogBatchPlan(groups: FamilyGroup[]): CatalogBatchPlan {
  let install = 0
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
    if (group.entries.some((entry) => entry.status === 'uninstalled' || entry.status === 'source-missing')) {
      forget += 1
    }
    if (group.entries.some((entry) => entry.status === 'uninstalled')) deleteFiles += 1
  }
  return {
    count: groups.length,
    install,
    installMissing,
    activate,
    deactivate,
    uninstall,
    uninstallAndRemove,
    reinstall,
    repair,
    forget,
    deleteFiles,
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
  if (verb === 'Deactivate') {
    if (!multi && count <= 1) return 'Deactivate'
    return `Deactivate ${count} ${count === 1 ? 'style' : 'styles'}`
  }
  if (!multi) return verb
  return `${verb} ${count} ${count === 1 ? 'font' : 'fonts'}`
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
  if (verb === 'deactivate') {
    return count <= 1 && !mixed ? 'Deactivate' : `Deactivate ${count} ${count === 1 ? 'style' : 'styles'}`
  }
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

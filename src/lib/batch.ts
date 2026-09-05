import {
  activatableIds,
  deactivatableIds,
  installableIds,
  reinstallableIds,
  uninstallableIds,
} from './eligibility.ts'
import { hasTrackedSource, isUninstallableGroup } from './group.ts'
import type { FamilyGroup, SystemFamilyGroup } from './types.ts'

export type CatalogBatchPlan = {
  count: number
  install: number
  activate: number
  deactivate: number
  uninstall: number
  uninstallAndRemove: number
  reinstall: number
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
  let forget = 0
  let deleteFiles = 0
  for (const group of groups) {
    if (installableIds(group).length) install += 1
    if (activatableIds(group).length) activate += 1
    if (deactivatableIds(group).length) deactivate += 1
    if (uninstallableIds(group).length || isUninstallableGroup(group)) {
      uninstall += 1
      if (hasTrackedSource(group)) uninstallAndRemove += 1
    }
    if (reinstallableIds(group).length) reinstall += 1
    if (group.entries.some((entry) => entry.status === 'uninstalled' || entry.status === 'source-missing')) {
      forget += 1
    }
    if (group.entries.some((entry) => entry.status === 'uninstalled')) deleteFiles += 1
  }
  return {
    count: groups.length,
    install,
    activate,
    deactivate,
    uninstall,
    uninstallAndRemove,
    reinstall,
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
    plan.forget > 0 ||
    plan.deleteFiles > 0
  )
}

export function hasSystemBatchActions(plan: SystemBatchPlan): boolean {
  return plan.deactivate > 0 || plan.uninstall > 0
}

export function actionLabel(verb: string, count: number, multi: boolean): string {
  if (!multi) return verb
  return `${verb} ${count} ${count === 1 ? 'font' : 'fonts'}`
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

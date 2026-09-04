import type { FamilyGroup, SystemFamilyGroup } from './types'

export type CatalogBatchPlan = {
  count: number
  install: number
  activate: number
  deactivate: number
  uninstall: number
  reinstall: number
  forget: number
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
  let reinstall = 0
  let forget = 0
  for (const group of groups) {
    if (group.status === 'uninstalled') install += 1
    if (group.status === 'deactivated') activate += 1
    if (group.status === 'installed' || group.status === 'outdated') deactivate += 1
    if (
      group.status === 'installed' ||
      group.status === 'outdated' ||
      group.status === 'deactivated'
    ) {
      uninstall += 1
    }
    if (group.status === 'outdated') reinstall += 1
    if (group.entries.some((entry) => entry.status === 'source-missing')) forget += 1
  }
  return {
    count: groups.length,
    install,
    activate,
    deactivate,
    uninstall,
    reinstall,
    forget,
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
    plan.reinstall > 0 ||
    plan.forget > 0
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

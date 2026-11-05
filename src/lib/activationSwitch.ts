import { activateActionLabel, deactivateActionLabel, type CatalogBatchPlan } from './batch.ts'
import { isNotInstalledLabel } from './state.ts'
import type { CatalogEntry } from './types.ts'

/** Cicero's family switch: off, on in one app only (knob halfway), or on. */
export type ActivationSwitchPosition = 'off' | 'app' | 'on'

export type ActivationSwitchModel = {
  position: ActivationSwitchPosition
  enabled: boolean
  help: string
  accessibilityValue: 'Off' | 'On' | 'Mixed'
}

function activeCatalogEntry(entry: CatalogEntry): boolean {
  return !entry.previewOnly && (entry.status === 'installed' || entry.status === 'outdated')
}

/**
 * Family cards without an app-folder cycle match Cicero: on when any style is
 * active, otherwise off. The middle position is only for that app-folder cycle,
 * which these cards do not have.
 */
export function catalogActivationSwitch(
  group: { entries: CatalogEntry[] },
  plan: Pick<CatalogBatchPlan, 'activate' | 'deactivate' | 'activateFormat' | 'partialActiveStyles'>,
): ActivationSwitchModel {
  const position: ActivationSwitchPosition = group.entries.some(activeCatalogEntry) ? 'on' : 'off'
  const enabled = plan.activate > 0 || plan.deactivate > 0
  if (!enabled) {
    const notInstalled =
      group.entries.length > 0 &&
      group.entries.every((entry) => entry.previewOnly || isNotInstalledLabel(entry))
    return {
      position,
      enabled: false,
      help: notInstalled ? 'Not installed' : position === 'on' ? 'Active' : 'Inactive',
      accessibilityValue: position === 'on' ? 'On' : 'Off',
    }
  }
  return {
    position,
    enabled: true,
    help: position === 'on' ? deactivateActionLabel(plan) : activateActionLabel(plan),
    accessibilityValue: position === 'on' ? 'On' : 'Off',
  }
}

/** On this Mac: a protected face stays on and locked, like Cicero's "Installed with macOS". */
export function systemActivationSwitch(group: {
  protected: boolean
  writable: boolean
  faces: ReadonlyArray<{ deactivated?: boolean; managedId?: string }>
}): ActivationSwitchModel {
  const position: ActivationSwitchPosition = group.faces.some((face) => !face.deactivated) ? 'on' : 'off'
  if (group.protected || !group.writable) {
    return {
      position,
      enabled: false,
      help: 'Installed with macOS',
      accessibilityValue: position === 'on' ? 'On' : 'Off',
    }
  }
  if (position === 'on') {
    return { position, enabled: true, help: 'Deactivate', accessibilityValue: 'On' }
  }
  const restorable = new Set(
    group.faces.flatMap((face) => (face.deactivated && face.managedId ? [face.managedId] : [])),
  )
  if (restorable.size > 0) {
    return {
      position,
      enabled: true,
      help: restorable.size === 1 ? 'Activate' : `Activate ${restorable.size} styles`,
      accessibilityValue: 'Off',
    }
  }
  return { position, enabled: false, help: 'Deactivated', accessibilityValue: 'Off' }
}

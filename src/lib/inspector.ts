export type InspectorDensity = 'compact' | 'expanded' | 'specimen'

export const DEFAULT_INSPECTOR_DENSITY: InspectorDensity = 'expanded'

const DENSITIES: InspectorDensity[] = ['compact', 'expanded', 'specimen']

export function expandInspector(current: InspectorDensity): InspectorDensity {
  return DENSITIES[Math.min(DENSITIES.indexOf(current) + 1, DENSITIES.length - 1)] ?? current
}

export function collapseInspector(current: InspectorDensity): InspectorDensity | null {
  const index = DENSITIES.indexOf(current)
  if (index <= 0) return null
  return DENSITIES[index - 1] ?? null
}

export function clickOpensInspector(
  current: string[],
  target: string,
  modifiers: { toggle?: boolean; range?: boolean },
): boolean {
  return !modifiers.toggle && !modifiers.range && current.length === 1 && current[0] === target
}

export function inspectorPaneClass(density: InspectorDensity): string {
  if (density === 'compact') return 'w-full md:w-96 md:shrink-0'
  return 'w-full min-w-0 flex-1'
}

export function inspectorRailClass(density: InspectorDensity): string {
  if (density === 'compact') return 'hidden min-w-0 md:flex md:min-w-0 md:flex-1 md:flex-col md:overflow-hidden'
  if (density === 'specimen') return 'hidden min-w-0 md:flex md:w-44 md:shrink-0 md:flex-col md:overflow-hidden'
  return 'hidden min-w-0 md:flex md:w-56 md:shrink-0 md:flex-col md:overflow-hidden'
}

export function inspectorUsesCardRail(density: InspectorDensity): boolean {
  return density === 'expanded' || density === 'specimen'
}

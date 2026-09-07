export type InspectorDensity = 'expanded' | 'specimen'

export const DEFAULT_INSPECTOR_DENSITY: InspectorDensity = 'expanded'

export function expandInspector(_current: InspectorDensity): InspectorDensity {
  return 'specimen'
}

export function collapseInspector(_current: InspectorDensity): InspectorDensity | null {
  return null
}

export function clickOpensInspector(
  current: string[],
  target: string,
  modifiers: { toggle?: boolean; range?: boolean },
): boolean {
  return !modifiers.toggle && !modifiers.range && current.length === 1 && current[0] === target
}

export function inspectorHidesBrowseGrid(open: boolean): boolean {
  return open
}

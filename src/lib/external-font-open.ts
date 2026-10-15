export const EXTERNAL_FONT_OPEN_LOADING = 'Loading fonts…'

export type ExternalFontOpenDepthState = {
  depth: number
}

export function externalFontOpenStarted(state: ExternalFontOpenDepthState): ExternalFontOpenDepthState {
  return { depth: state.depth + 1 }
}

export function externalFontOpenFinished(state: ExternalFontOpenDepthState): ExternalFontOpenDepthState {
  return { depth: Math.max(0, state.depth - 1) }
}

export function externalFontOpenLoadingMessage(state: ExternalFontOpenDepthState): string | null {
  return state.depth > 0 ? EXTERNAL_FONT_OPEN_LOADING : null
}

export function shouldShowSingleActionProgress(total: number, externalOpenDepth: number): boolean {
  return total > 1 || (total >= 1 && externalOpenDepth > 0)
}

/** Clear ActionStatus when an external open owned the pill (including install progress). */
export function shouldClearExternalFontOpenStatus(ownsStatus: boolean, depth: number): boolean {
  return ownsStatus && depth === 0
}

export function applyExternalFontOpenDepth(payload: { depth?: number } | undefined, fallback = 0): number {
  const depth = payload?.depth
  return typeof depth === 'number' && depth >= 0 ? depth : fallback
}

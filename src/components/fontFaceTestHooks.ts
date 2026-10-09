const PREVIEW_FACE_REFRESH_MS = 15 * 60 * 1000

let previewFaceRefreshMs = PREVIEW_FACE_REFRESH_MS
let previewCssWriteGate: (() => Promise<void>) | null = null

export function previewFaceRefreshInterval(): number {
  return previewFaceRefreshMs
}

export function setPreviewFaceRefreshForTests(ms: number): void {
  previewFaceRefreshMs = ms
}

export function runPreviewCssWriteGate(): Promise<void> {
  return previewCssWriteGate ? previewCssWriteGate() : Promise.resolve()
}

/** Pause after preview CSS is built and before it is written, so tests can bump the retry counter mid-refresh. */
export function setPreviewCssWriteGateForTests(gate: (() => Promise<void>) | null): void {
  previewCssWriteGate = gate
}

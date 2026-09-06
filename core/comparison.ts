export const COMPARISON_STALE_ERROR =
  'A newer source is available. Refresh comparison before installing.'

export function assertExpectedSourceFingerprint(
  liveFingerprint: string | undefined,
  expected: string | undefined,
): void {
  if (!expected) return
  if (liveFingerprint !== expected) {
    throw new Error(COMPARISON_STALE_ERROR)
  }
}

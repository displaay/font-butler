export type LogoutProbeResultNotice = { message?: string }

const listeners = new Set<(notice: LogoutProbeResultNotice) => void>()

export function subscribeLogoutProbeResult(
  listener: (notice: LogoutProbeResultNotice) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Late Allow on a test build. The Settings panel moves to the probe result. */
export function publishLogoutProbeResult(notice: LogoutProbeResultNotice): void {
  for (const listener of [...listeners]) listener(notice)
}

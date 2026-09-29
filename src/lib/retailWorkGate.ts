/**
 * Serial queue for onboarding retail configure/check calls.
 * Continue, close, and finish await `settle` so completion sync sees the choices that landed.
 */
export type RetailWorkGate = {
  track<T>(work: () => Promise<T>): Promise<T>
  settle(): Promise<void>
}

export function createRetailWorkGate(): RetailWorkGate {
  let chain: Promise<void> = Promise.resolve()
  return {
    track(work) {
      const run = chain.then(work, work)
      chain = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
    async settle() {
      let seen = chain
      for (;;) {
        await seen
        if (chain === seen) return
        seen = chain
      }
    },
  }
}

/**
 * Settings events arrive many times per launch. SMAppService logs an error on every
 * rejected call (ad-hoc builds), so only touch the login item when the value changes.
 */
export function createLoginItemApplier({ get, set }) {
  let applied
  return function applyOpenAtLogin(enabled) {
    const next = enabled === true
    if (applied === undefined) {
      try {
        applied = get()?.openAtLogin === true
      } catch {
        applied = undefined
      }
    }
    if (applied === next) {
      return false
    }
    applied = next
    set({ openAtLogin: next })
    return true
  }
}

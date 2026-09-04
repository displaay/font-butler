export function nextSelection(
  orderedKeys: string[],
  current: string[],
  target: string,
  modifiers: { toggle?: boolean; range?: boolean },
  anchor: string | null,
): string[] {
  if (modifiers.range && anchor) {
    const from = orderedKeys.indexOf(anchor)
    const to = orderedKeys.indexOf(target)
    if (from === -1 || to === -1) return [target]
    const start = Math.min(from, to)
    const end = Math.max(from, to)
    return orderedKeys.slice(start, end + 1)
  }
  if (modifiers.toggle) {
    if (current.includes(target)) {
      const next = current.filter((key) => key !== target)
      return next.length > 0 ? next : [target]
    }
    return [...current, target]
  }
  return [target]
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export type ShortcutAction = 'remove' | 'install' | 'deactivate'

export function shortcutAction(event: KeyboardEvent): ShortcutAction | null {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
    return null
  }
  if (isTypingTarget(event.target)) return null
  if (event.key === 'Backspace' || event.key === 'Delete') return 'remove'
  if (event.key === 'i' || event.key === 'I') return 'install'
  if (event.key === 'd' || event.key === 'D') return 'deactivate'
  return null
}

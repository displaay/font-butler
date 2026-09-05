export type Rect = {
  left: number
  top: number
  right: number
  bottom: number
}

export function clientRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export function keysInMarquee(
  items: Array<{ key: string; rect: Rect }>,
  marquee: Rect,
): string[] {
  return items.filter((item) => rectsIntersect(item.rect, marquee)).map((item) => item.key)
}

export function mergeMarqueeSelection(base: string[], hit: string[], additive: boolean): string[] {
  if (!additive) return hit
  const seen = new Set(base)
  const next = [...base]
  for (const key of hit) {
    if (seen.has(key)) continue
    seen.add(key)
    next.push(key)
  }
  return next
}

export function canStartMarquee(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false
  if (
    target.closest(
      '[role="dialog"], [data-radix-popper-content-wrapper], [data-keep-selection], [data-radix-scroll-area-scrollbar], [data-no-marquee], input, textarea, select, a',
    )
  ) {
    return false
  }
  return true
}

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
      return current.filter((key) => key !== target)
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

export type ShortcutAction = 'remove' | 'install' | 'deactivate' | 'selectAll'

export function shortcutAction(event: KeyboardEvent): ShortcutAction | null {
  if (event.defaultPrevented) return null
  if (isTypingTarget(event.target)) return null
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'a') {
    return 'selectAll'
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  if (event.key === 'Backspace' || event.key === 'Delete') return 'remove'
  if (event.key === 'i' || event.key === 'I') return 'install'
  if (event.key === 'd' || event.key === 'D') return 'deactivate'
  return null
}

import { yieldEventLoop } from './event-loop.ts'
import { emitEvent } from './events.ts'
import type { BatchProgressAction } from './types.ts'

export type FamilyProgressItem = {
  id: string
  familyName: string
}

export function familyProgressReporter(
  action: BatchProgressAction,
  items: readonly FamilyProgressItem[],
  options?: { onFamilyDone?: () => void },
): {
  start: () => void
  mark: (id: string) => Promise<void>
} {
  const families = new Map<string, string[]>()
  for (const item of items) {
    const name = item.familyName.trim() || item.id
    const ids = families.get(name) ?? []
    ids.push(item.id)
    families.set(name, ids)
  }
  const total = families.size
  const processed = new Set<string>()
  let lastDone = -1

  const emit = () => {
    if (total === 0) return false
    let done = 0
    for (const ids of families.values()) {
      if (ids.every((id) => processed.has(id))) done += 1
    }
    if (done === lastDone) return false
    const completedFamily = done > lastDone
    lastDone = done
    emitEvent({ type: 'action-progress', action, done, total })
    if (completedFamily && done > 0) options?.onFamilyDone?.()
    return true
  }

  return {
    start() {
      lastDone = -1
      emit()
    },
    async mark(id: string) {
      processed.add(id)
      const advanced = emit()
      if (advanced) await yieldEventLoop()
    },
  }
}

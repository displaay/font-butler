import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCheck, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { activityActionLabel, unreadActivityCount } from '@/lib/activityInbox'
import { cn, formatRelativeTime } from '@/lib/utils'
import type { Operation } from '@/lib/types'

export function ActivityView({
  operations,
  highlightId,
  onUndo,
  onMarkAllRead,
}: {
  operations: Operation[]
  highlightId?: string | null
  onUndo: (id: string) => void
  onMarkAllRead?: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(highlightId ?? null)
  const unreadCount = unreadActivityCount(operations)

  useEffect(() => {
    if (highlightId) setExpanded(highlightId)
  }, [highlightId])

  if (operations.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Activity appears here after imports, updates, restores, repairs, and activation changes.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {unreadCount > 0 && onMarkAllRead ? (
        <div className="flex shrink-0 items-center justify-end px-4 pt-1 pb-2">
          <Button type="button" size="sm" variant="ghost" onClick={onMarkAllRead}>
            <CheckCheck /> Mark all as read
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ul className="space-y-2">
          {operations.map((operation) => {
            const open = expanded === operation.id
            return (
              <li
                key={operation.id}
                className={cn('rounded-lg border px-3 py-2', operation.unread && 'border-foreground/20 bg-muted/40')}
                data-operation-id={operation.id}
                data-unread={operation.unread ? 'true' : 'false'}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setExpanded(open ? null : operation.id)}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {operation.unread ? (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-red-600 dark:bg-red-400"
                          aria-hidden
                        />
                      ) : null}
                      <div className="truncate text-sm font-medium">
                        {activityActionLabel(operation.action)}
                        {operation.familyName ? ` · ${operation.familyName}` : ''}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelativeTime(operation.startedAt)} · {operation.trigger} · {operation.outcome}
                      {operation.undone ? ' · undone' : ''}
                    </div>
                  </button>
                  {operation.undoable && !operation.undone ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onUndo(operation.id)}
                    >
                      <Undo2 /> Undo
                    </Button>
                  ) : null}
                </div>
                {open && (
                  <ul className="mt-2 space-y-1 border-t pt-2 text-xs">
                    {operation.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-3">
                        <span className="truncate">{item.label}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {item.outcome}
                          {item.reason ? ` · ${item.reason}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export async function loadActivity(): Promise<Operation[]> {
  try {
    return (await api.activity()).operations
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not load activity')
    return []
  }
}

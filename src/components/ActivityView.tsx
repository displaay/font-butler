import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import type { Operation } from '@/lib/types'

const ACTION_LABELS: Record<string, string> = {
  deactivate: 'Deactivate',
  activate: 'Activate',
  install: 'Install',
  'install-update': 'Install update',
  uninstall: 'Uninstall',
  reinstall: 'Reinstall',
  repair: 'Repair',
  'apply-plan': 'Import',
  'relink-source': 'Link source',
  'relink-folder': 'Relink folder',
  'restore-revision': 'Restore version',
  'activate-project': 'Activate project',
  undo: 'Undo',
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

export function ActivityView({
  operations,
  highlightId,
  onUndo,
}: {
  operations: Operation[]
  highlightId?: string | null
  onUndo: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(highlightId ?? null)

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
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <ul className="space-y-2">
        {operations.map((operation) => {
          const open = expanded === operation.id
          return (
            <li
              key={operation.id}
              className="rounded-lg border px-3 py-2"
              data-operation-id={operation.id}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setExpanded(open ? null : operation.id)}
                >
                  <div className="truncate text-sm font-medium">
                    {actionLabel(operation.action)}
                    {operation.familyName ? ` · ${operation.familyName}` : ''}
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

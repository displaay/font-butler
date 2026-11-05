import { useState } from 'react'
import { GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  LIBRARY_FILTER_GROUP_LABELS,
  moveLibraryFilterGroup,
  type LibraryFilterGroupId,
  type LibraryFilterGroupPref,
} from '../../shared/library-filter-groups.ts'

function ShowSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`Show ${label}`}
      draggable={false}
      onDragStart={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={() => onCheckedChange(!checked)}
      className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors',
          checked ? 'bg-primary' : 'bg-foreground/15',
        )}
      >
        <span
          className={cn(
            'size-3 rounded-full shadow-[0_0.5px_1px_rgba(0,0,0,0.28)] transition-transform',
            checked ? 'translate-x-3 bg-primary-foreground' : 'translate-x-0 bg-background',
          )}
        />
      </span>
      Show
    </button>
  )
}

export function EditFiltersDialog({
  open,
  groups,
  onClose,
  onChange,
}: {
  open: boolean
  groups: LibraryFilterGroupPref[]
  onClose: () => void
  onChange: (groups: LibraryFilterGroupPref[]) => void
}) {
  const [dragging, setDragging] = useState<LibraryFilterGroupId | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="w-[min(92vw,420px)]">
        <DialogHeader>
          <DialogTitle>Edit filters</DialogTitle>
          <DialogDescription>
            Choose which groups stay in the sidebar, and drag them into the order you want.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1">
          {groups.map((group) => (
            <li
              key={group.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', group.id)
                setDragging(group.id)
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => {
                event.preventDefault()
                if (!dragging || dragging === group.id) return
                onChange(moveLibraryFilterGroup(groups, dragging, group.id))
              }}
              className={cn(
                'flex items-center gap-2 rounded-md border px-2 py-1.5',
                dragging === group.id && 'opacity-60',
              )}
            >
              <span className="cursor-grab text-muted-foreground" aria-hidden>
                <GripVertical className="size-4" />
              </span>
              <span className="min-w-0 flex-1 text-[13px]">{LIBRARY_FILTER_GROUP_LABELS[group.id]}</span>
              <ShowSwitch
                checked={group.visible}
                label={LIBRARY_FILTER_GROUP_LABELS[group.id]}
                onCheckedChange={(visible) =>
                  onChange(
                    groups.map((item) => (item.id === group.id ? { ...item, visible } : item)),
                  )
                }
              />
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

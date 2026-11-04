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
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={group.visible}
                  aria-label={`Show ${LIBRARY_FILTER_GROUP_LABELS[group.id]}`}
                  onChange={(event) =>
                    onChange(
                      groups.map((item) =>
                        item.id === group.id ? { ...item, visible: event.target.checked } : item,
                      ),
                    )
                  }
                />
                Show
              </label>
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

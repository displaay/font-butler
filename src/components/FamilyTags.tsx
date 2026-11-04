import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TAG_COLOR_CHOICES, tagIdsForFamily, type FamilyTag, type FamilyTagAssignment } from '../../shared/family-tags.ts'

export function FamilyTagDots({
  definitions,
  appliedIds,
}: {
  definitions: readonly FamilyTag[]
  appliedIds: readonly string[]
}) {
  const byId = new Map(definitions.map((tag) => [tag.id, tag]))
  const tags = appliedIds.flatMap((id) => {
    const tag = byId.get(id)
    return tag ? [tag] : []
  })
  if (tags.length === 0) return null
  return (
    <span className="inline-flex items-center gap-1" aria-label="Tags">
      {tags.map((tag) => (
        <span
          key={tag.id}
          title={tag.name}
          aria-label={tag.name}
          className="inline-block size-2 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
          style={{ backgroundColor: tag.color }}
        />
      ))}
    </span>
  )
}

function presence(
  tagId: string,
  familyKeys: readonly string[],
  assignments: readonly FamilyTagAssignment[],
): 'all' | 'some' | 'none' {
  if (familyKeys.length === 0) return 'none'
  let count = 0
  for (const key of familyKeys) {
    if (tagIdsForFamily(assignments, key).includes(tagId)) count += 1
  }
  if (count === 0) return 'none'
  if (count === familyKeys.length) return 'all'
  return 'some'
}

export function FamilyTagMenuItems({
  definitions,
  assignments,
  familyKeys,
  onSet,
  onCreate,
  onEdit,
  onDelete,
  addOnly = false,
}: {
  definitions: readonly FamilyTag[]
  assignments: readonly FamilyTagAssignment[]
  familyKeys: readonly string[]
  onSet: (tagId: string, present: boolean) => void
  onCreate: () => void
  onEdit?: (tagId: string) => void
  onDelete?: (tagId: string) => void
  /** Folder and project menus only add. A font menu can still clear a tag that is on every selected family. */
  addOnly?: boolean
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Tag /> Add tag
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-52">
        {definitions.map((tag) => {
          const state = presence(tag.id, familyKeys, assignments)
          return (
            <ContextMenuItem
              key={tag.id}
              className="group/tag pr-1"
              onSelect={(event) => {
                if ((event.target as HTMLElement | null)?.closest?.('[data-tag-action]')) return
                event.preventDefault()
                onSet(tag.id, addOnly ? true : state !== 'all')
              }}
            >
              <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
                {state === 'all' ? <Check className="size-3.5" /> : state === 'some' ? '–' : null}
              </span>
              <TagSwatch color={tag.color} name={tag.name} />
              <TagHoverActions name={tag.name} onEdit={onEdit ? () => onEdit(tag.id) : undefined} onDelete={onDelete ? () => onDelete(tag.id) : undefined} />
            </ContextMenuItem>
          )
        })}
        {definitions.length > 0 ? <ContextMenuSeparator /> : null}
        <ContextMenuItem onSelect={onCreate}>
          <Plus /> New tag…
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

export function FamilyTagBatchButton({
  definitions,
  assignments,
  familyKeys,
  disabled,
  onSet,
  onCreate,
  onEdit,
  onDelete,
}: {
  definitions: readonly FamilyTag[]
  assignments: readonly FamilyTagAssignment[]
  familyKeys: readonly string[]
  disabled?: boolean
  onSet: (tagId: string, present: boolean) => void
  onCreate: () => void
  onEdit?: (tagId: string) => void
  onDelete?: (tagId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (definitions.length === 0 || familyKeys.length === 0) return null
  return (
    <div ref={rootRef} className="relative">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <Tag /> Tags
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 bottom-full z-40 mb-2 w-56 rounded-md border bg-popover p-1 shadow-md"
        >
          {definitions.map((tag) => {
            const state = presence(tag.id, familyKeys, assignments)
            return (
              <div
                key={tag.id}
                role="menuitemcheckbox"
                aria-checked={state === 'all'}
                className="group/tag flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => onSet(tag.id, state !== 'all')}
                >
                <span className="flex size-4 items-center justify-center" aria-hidden>
                  {state === 'all' ? <Check className="size-3.5" /> : state === 'some' ? '–' : null}
                </span>
                <TagSwatch color={tag.color} name={tag.name} />
                </button>
                <TagHoverActions
                  name={tag.name}
                  onEdit={
                    onEdit
                      ? () => {
                          setOpen(false)
                          onEdit(tag.id)
                        }
                      : undefined
                  }
                  onDelete={
                    onDelete
                      ? () => {
                          setOpen(false)
                          onDelete(tag.id)
                        }
                      : undefined
                  }
                />
              </div>
            )
          })}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            onClick={() => {
              setOpen(false)
              onCreate()
            }}
          >
            <Plus className="size-4" /> New tag…
          </button>
        </div>
      ) : null}
    </div>
  )
}

function TagHoverActions({
  name,
  onEdit,
  onDelete,
}: {
  name: string
  onEdit?: () => void
  onDelete?: () => void
}) {
  if (!onEdit && !onDelete) return null
  return (
    <span className="ml-auto flex shrink-0 items-center opacity-0 group-hover/tag:opacity-100 group-focus-within/tag:opacity-100">
      {onEdit ? (
        <button
          type="button"
          data-tag-action="edit"
          aria-label={`Edit ${name}`}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.08] [&_svg]:pointer-events-none"
          onClick={() => onEdit()}
        >
          <Pencil className="size-3.5" />
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          data-tag-action="delete"
          aria-label={`Delete ${name}`}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.08] [&_svg]:pointer-events-none"
          onClick={() => onDelete()}
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </span>
  )
}

function TagSwatch({ color, name }: { color: string; name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="inline-block size-2 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="truncate">{name}</span>
    </span>
  )
}

export function FamilyTagNameDialog({
  open,
  mode,
  initialName,
  initialColor = TAG_COLOR_CHOICES[0] ?? '#1f8a4c',
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  mode: 'create' | 'edit'
  initialName: string
  initialColor?: string
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, color: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={mode === 'edit' ? 'w-[min(92vw,320px)]' : undefined}>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New tag' : 'Edit tag'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'The tag is added to the selected families.'
              : 'Families that already use this tag keep it.'}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <FamilyTagNameForm
            key={`${mode}:${initialName}:${initialColor}`}
            mode={mode}
            initialName={initialName}
            initialColor={initialColor}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function FamilyTagNameForm({
  mode,
  initialName,
  initialColor,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  initialName: string
  initialColor: string
  onCancel: () => void
  onSubmit: (name: string, color: string) => void
}) {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)
  const colors = color && !TAG_COLOR_CHOICES.includes(color) ? [color, ...TAG_COLOR_CHOICES] : TAG_COLOR_CHOICES
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    onSubmit(name, color)
  }
  return (
    <form onSubmit={submit}>
      <Label htmlFor="family-tag-name">Name</Label>
      <Input
        id="family-tag-name"
        value={name}
        autoFocus
        maxLength={40}
        className="mt-2"
        onChange={(event) => setName(event.target.value)}
      />
      {mode === 'edit' ? (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Color</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {colors.map((choice) => (
              <button
                key={choice}
                type="button"
                aria-label={`Color ${choice}`}
                aria-pressed={choice === color}
                className="inline-flex size-6 items-center justify-center rounded-full ring-1 ring-black/10 dark:ring-white/15"
                style={{ backgroundColor: choice }}
                onClick={() => setColor(choice)}
              >
                {choice === color ? <Check className="size-3.5 text-white" /> : null}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </form>
  )
}

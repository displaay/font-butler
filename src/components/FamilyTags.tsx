import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Plus, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenuCheckboxItem,
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
import { tagIdsForFamily, type FamilyTag, type FamilyTagAssignment } from '../../shared/family-tags.ts'

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
  onRename,
}: {
  definitions: readonly FamilyTag[]
  assignments: readonly FamilyTagAssignment[]
  familyKeys: readonly string[]
  onSet: (tagId: string, present: boolean) => void
  onCreate: () => void
  onRename: (tagId: string) => void
}) {
  if (definitions.length === 0) return null
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Tag /> Tags
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-48">
        {definitions.map((tag) => {
          const state = presence(tag.id, familyKeys, assignments)
          return (
            <ContextMenuCheckboxItem
              key={tag.id}
              checked={state === 'all'}
              onSelect={(event) => {
                event.preventDefault()
                onSet(tag.id, state !== 'all')
              }}
            >
              <TagSwatch color={tag.color} name={tag.name} />
            </ContextMenuCheckboxItem>
          )
        })}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onCreate}>
          <Plus /> New tag…
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Rename tag</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {definitions.map((tag) => (
              <ContextMenuItem key={tag.id} onSelect={() => onRename(tag.id)}>
                <TagSwatch color={tag.color} name={tag.name} />
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
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
  onRename,
}: {
  definitions: readonly FamilyTag[]
  assignments: readonly FamilyTagAssignment[]
  familyKeys: readonly string[]
  disabled?: boolean
  onSet: (tagId: string, present: boolean) => void
  onCreate: () => void
  onRename: (tagId: string) => void
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
              <button
                key={tag.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={state === 'all'}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => onSet(tag.id, state !== 'all')}
              >
                <span className="flex size-4 items-center justify-center" aria-hidden>
                  {state === 'all' ? <Check className="size-3.5" /> : state === 'some' ? '–' : null}
                </span>
                <TagSwatch color={tag.color} name={tag.name} />
              </button>
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
          <p className="px-2 pt-1 pb-0.5 text-[11px] text-muted-foreground">Rename</p>
          {definitions.map((tag) => (
            <button
              key={`rename-${tag.id}`}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => {
                setOpen(false)
                onRename(tag.id)
              }}
            >
              <TagSwatch color={tag.color} name={tag.name} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  mode: 'create' | 'rename'
  initialName: string
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New tag' : 'Rename tag'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'The tag is added to the selected families.'
              : 'Families that already use this tag keep it.'}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <FamilyTagNameForm
            key={`${mode}:${initialName}`}
            initialName={initialName}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function FamilyTagNameForm({
  initialName,
  onCancel,
  onSubmit,
}: {
  initialName: string
  onCancel: () => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(initialName)
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    onSubmit(name)
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

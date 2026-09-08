import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, CircleMinus, FolderOpen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type SplitUninstallExtra = {
  key: string
  label: string
  onSelect: () => void
  icon?: ReactNode
  separatorBefore?: boolean
}

function useDismissibleMenu() {
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

  return { open, setOpen, rootRef }
}

export function SplitUninstallButton({
  busy,
  uninstallLabel,
  extras,
  onUninstall,
  menuPlacement = 'down',
}: {
  busy: boolean
  uninstallLabel: string
  extras: SplitUninstallExtra[]
  onUninstall: () => void
  menuPlacement?: 'up' | 'down'
}) {
  const { open, setOpen, rootRef } = useDismissibleMenu()

  if (extras.length === 0) {
    return (
      <Button size="sm" variant="destructive" disabled={busy} onClick={onUninstall}>
        <CircleMinus /> {uninstallLabel}
      </Button>
    )
  }

  return (
    <div ref={rootRef} data-keep-selection="" className="relative inline-flex">
      <Button
        size="sm"
        variant="destructive"
        disabled={busy}
        className="rounded-r-none"
        onClick={onUninstall}
      >
        <CircleMinus /> {uninstallLabel}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More uninstall actions"
        className="rounded-l-none border-l !border-red-200/70 px-1.5 dark:!border-red-500/20"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown />
      </Button>
      {open ? (
        <div
          role="menu"
          className={cn(
            'absolute right-0 z-50 min-w-52 rounded-md border bg-popover p-1 shadow-sm',
            menuPlacement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {extras.map((item) => (
            <div key={item.key}>
              {item.separatorBefore ? <div className="my-1 h-px bg-border" role="separator" /> : null}
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive outline-none hover:bg-red-100 dark:hover:bg-red-500/20"
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                {item.icon ?? <Trash2 className="size-4 shrink-0" />}
                {item.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export type DropdownActionItem = {
  key: string
  label: string
  onSelect: () => void
}

export function DropdownActionButton({
  busy,
  label,
  icon = <FolderOpen />,
  items,
  menuPlacement = 'down',
}: {
  busy?: boolean
  label: string
  icon?: ReactNode
  items: DropdownActionItem[]
  menuPlacement?: 'up' | 'down'
}) {
  const { open, setOpen, rootRef } = useDismissibleMenu()

  if (items.length === 0) return null
  if (items.length === 1) {
    return (
      <Button size="sm" variant="outline" disabled={busy} onClick={items[0]!.onSelect}>
        {icon} {label}
      </Button>
    )
  }

  return (
    <div ref={rootRef} data-keep-selection="" className="relative inline-flex">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon} {label}
        <ChevronDown />
      </Button>
      {open ? (
        <div
          role="menu"
          className={cn(
            'absolute right-0 z-50 min-w-44 rounded-md border bg-popover p-1 shadow-sm',
            menuPlacement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

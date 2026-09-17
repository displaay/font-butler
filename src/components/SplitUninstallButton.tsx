import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, CircleMinus, CirclePlus, FolderOpen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type SplitUninstallExtra = {
  key: string
  label: string
  onSelect: () => void
  icon?: ReactNode
  separatorBefore?: boolean
}

type MenuAlign = 'start' | 'end'
type MenuPlacement = 'up' | 'down'
type MenuCoords = { top: number; left: number }

const MENU_GAP = 4
const VIEWPORT_PAD = 8

function anchoredMenuCoords(
  trigger: DOMRect,
  menuSize: { width: number; height: number },
  placement: MenuPlacement,
  align: MenuAlign,
): MenuCoords {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(menuSize.width, vw - VIEWPORT_PAD * 2)
  const height = Math.min(menuSize.height, vh - VIEWPORT_PAD * 2)
  let left = align === 'start' ? trigger.left : trigger.right - menuSize.width
  left = Math.min(Math.max(VIEWPORT_PAD, left), vw - width - VIEWPORT_PAD)

  const below = trigger.bottom + MENU_GAP
  const above = trigger.top - height - MENU_GAP
  const preferUp = placement === 'up'
  const fitsBelow = below + height <= vh - VIEWPORT_PAD
  const fitsAbove = above >= VIEWPORT_PAD
  let top = preferUp
    ? fitsAbove || !fitsBelow
      ? above
      : below
    : fitsBelow || !fitsAbove
      ? below
      : above
  top = Math.min(Math.max(VIEWPORT_PAD, top), vh - height - VIEWPORT_PAD)
  return { top, left }
}

function useAnchoredMenu(placement: MenuPlacement, align: MenuAlign) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<MenuCoords>({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const trigger = rootRef.current?.getBoundingClientRect()
      if (!trigger) return
      const menu = menuRef.current?.getBoundingClientRect()
      setCoords(
        anchoredMenuCoords(
          trigger,
          { width: menu?.width || 176, height: menu?.height || 72 },
          placement,
          align,
        ),
      )
    }
    place()
    function onDoc(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, placement, align])

  return { open, setOpen, rootRef, menuRef, coords }
}

function PortaledMenu({
  menuRef,
  coords,
  className,
  children,
}: {
  menuRef: RefObject<HTMLDivElement | null>
  coords: MenuCoords
  className?: string
  children: ReactNode
}) {
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-keep-selection=""
      style={{ top: coords.top, left: coords.left }}
      className={cn('fixed z-50 min-w-44 rounded-md border bg-popover p-1 shadow-sm', className)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  )
}

type SplitActionVariant = 'destructive' | 'success'

const splitChevronBorder: Record<SplitActionVariant, string> = {
  destructive: 'border-l !border-red-200/70 dark:!border-red-500/20',
  success: 'border-l !border-emerald-200/70 dark:!border-emerald-500/20',
}

const splitMenuItemClass: Record<SplitActionVariant, string> = {
  destructive: 'text-destructive hover:bg-red-100 dark:hover:bg-red-500/20',
  success: 'hover:bg-muted',
}

function SplitActionButton({
  busy,
  variant,
  icon,
  label,
  extras,
  onClick,
  chevronLabel,
  menuPlacement = 'down',
  menuAlign = 'end',
  extraFallbackIcon,
}: {
  busy: boolean
  variant: SplitActionVariant
  icon: ReactNode
  label: string
  extras: SplitUninstallExtra[]
  onClick: () => void
  chevronLabel: string
  menuPlacement?: 'up' | 'down'
  menuAlign?: MenuAlign
  extraFallbackIcon: ReactNode
}) {
  const { open, setOpen, rootRef, menuRef, coords } = useAnchoredMenu(menuPlacement, menuAlign)

  if (extras.length === 0) {
    return (
      <Button size="sm" variant={variant} disabled={busy} onClick={onClick}>
        {icon} {label}
      </Button>
    )
  }

  return (
    <div ref={rootRef} data-keep-selection="" className="inline-flex">
      <Button
        size="sm"
        variant={variant}
        disabled={busy}
        className="rounded-r-none"
        onClick={onClick}
      >
        {icon} {label}
      </Button>
      <Button
        size="sm"
        variant={variant}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={chevronLabel}
        className={cn('rounded-l-none px-1.5', splitChevronBorder[variant])}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown />
      </Button>
      {open ? (
        <PortaledMenu menuRef={menuRef} coords={coords} className="min-w-52">
          {extras.map((item) => (
            <div key={item.key}>
              {item.separatorBefore ? <div className="my-1 h-px bg-border" role="separator" /> : null}
              <button
                type="button"
                role="menuitem"
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none',
                  splitMenuItemClass[variant],
                )}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                {item.icon ?? extraFallbackIcon}
                {item.label}
              </button>
            </div>
          ))}
        </PortaledMenu>
      ) : null}
    </div>
  )
}

export function SplitInstallButton({
  busy,
  label,
  extras,
  onInstall,
  menuPlacement = 'down',
}: {
  busy: boolean
  label: string
  extras: SplitUninstallExtra[]
  onInstall: () => void
  menuPlacement?: 'up' | 'down'
}) {
  return (
    <SplitActionButton
      busy={busy}
      variant="success"
      icon={<CirclePlus />}
      label={label}
      extras={extras}
      onClick={onInstall}
      chevronLabel="More install actions"
      menuPlacement={menuPlacement}
      menuAlign="start"
      extraFallbackIcon={<CirclePlus className="size-4 shrink-0" />}
    />
  )
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
  return (
    <SplitActionButton
      busy={busy}
      variant="destructive"
      icon={<CircleMinus />}
      label={uninstallLabel}
      extras={extras}
      onClick={onUninstall}
      chevronLabel="More uninstall actions"
      menuPlacement={menuPlacement}
      extraFallbackIcon={<Trash2 className="size-4 shrink-0" />}
    />
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
  const { open, setOpen, rootRef, menuRef, coords } = useAnchoredMenu(menuPlacement, 'start')

  if (items.length === 0) return null
  if (items.length === 1) {
    return (
      <Button size="sm" variant="outline" disabled={busy} onClick={items[0]!.onSelect}>
        {icon} {label}
      </Button>
    )
  }

  return (
    <div ref={rootRef} data-keep-selection="" className="inline-flex">
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
        <PortaledMenu menuRef={menuRef} coords={coords}>
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
        </PortaledMenu>
      ) : null}
    </div>
  )
}

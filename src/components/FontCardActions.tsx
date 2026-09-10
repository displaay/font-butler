import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight, ChevronDown, CircleMinus, CirclePlus, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { CatalogBatchPlan } from '@/lib/batch'
import { actionLabel, activateActionLabel, forgetSourcesLabel } from '@/lib/batch'
import { formatSwapLabel } from '@/lib/formats'
import { cn } from '@/lib/utils'

type CatalogCardActionHandlers = {
  busy: boolean
  onInstall: () => void
  onReinstall: () => void
  onDeactivate: () => void
  onUninstall: () => void
  onActivate: () => void
  /** Passed only when a same-format occupying sibling exists (`canSwitchTo`). */
  onSwitch?: () => void
  formatSwap?: { from: string; to: string; occupying?: boolean } | null
  onFormatSwap?: () => void
  onForget: () => void
  formatUninstalls?: string[]
  onUninstallFormat?: (format: string) => void
}

export function CatalogCardActions({
  plan,
  previewOnly,
  missingSource,
  busy,
  offset,
  visible,
  onInstall,
  onReinstall,
  onDeactivate,
  onUninstall,
  onActivate,
  onSwitch,
  formatSwap,
  onFormatSwap,
  onForget,
  formatUninstalls = [],
  onUninstallFormat,
}: CatalogCardActionHandlers & {
  plan: CatalogBatchPlan
  previewOnly?: boolean
  missingSource: boolean
  offset?: boolean
  visible?: boolean
}) {
  const [formatMenuOpen, setFormatMenuOpen] = useState(false)
  if (previewOnly) {
    return (
      <ActionDock offset={offset} visible={visible}>
        {missingSource && (
          <IconAction label={forgetSourcesLabel(1, false)} disabled={busy} destructive onClick={onForget}>
            <Trash2 />
          </IconAction>
        )}
      </ActionDock>
    )
  }
  const installLabel = plan.installMissing
    ? actionLabel('Install missing', plan.install, plan.install > 1)
    : actionLabel('Install', plan.install, plan.install > 1)
  return (
    <ActionDock offset={offset} visible={visible || formatMenuOpen}>
      {plan.reinstall > 0 && (
        <IconAction
          label={actionLabel('Install update', plan.reinstall, plan.reinstall > 1)}
          disabled={busy}
          warn
          onClick={onReinstall}
        >
          <RefreshCw />
        </IconAction>
      )}
      {plan.install > 0 && (
        <IconAction label={installLabel} disabled={busy} success onClick={onInstall}>
          <CirclePlus />
        </IconAction>
      )}
      {plan.activate > 0 && (
        <IconAction label={activateActionLabel(plan)} disabled={busy} onClick={onActivate}>
          <Power />
        </IconAction>
      )}
      {formatSwap && onFormatSwap && (
        <IconAction label={formatSwapLabel(formatSwap)} disabled={busy} onClick={onFormatSwap}>
          <ArrowLeftRight />
        </IconAction>
      )}
      {onSwitch && (
        <IconAction label="Switch" disabled={busy} onClick={onSwitch}>
          <ArrowLeftRight />
        </IconAction>
      )}
      {plan.deactivate > 0 && (
        <IconAction label="Deactivate" disabled={busy} onClick={onDeactivate}>
          <PowerOff />
        </IconAction>
      )}
      {plan.uninstall > 0 &&
        (formatUninstalls.length >= 2 && onUninstallFormat ? (
          <SplitUninstallIcon
            busy={busy}
            formats={formatUninstalls}
            onUninstall={onUninstall}
            onUninstallFormat={onUninstallFormat}
            onOpenChange={setFormatMenuOpen}
          />
        ) : (
          <IconAction label="Uninstall" disabled={busy} destructive onClick={onUninstall}>
            <CircleMinus />
          </IconAction>
        ))}
      {plan.forget > 0 && (
        <IconAction label={forgetSourcesLabel(1, false)} disabled={busy} destructive onClick={onForget}>
          <Trash2 />
        </IconAction>
      )}
    </ActionDock>
  )
}

export function SystemCardActions({
  writable,
  busy,
  offset,
  visible,
  onDeactivate,
  onUninstall,
}: {
  writable: boolean
  busy: boolean
  offset?: boolean
  visible?: boolean
  onDeactivate: () => void
  onUninstall: () => void
}) {
  if (!writable) return null
  return (
    <ActionDock offset={offset} visible={visible}>
      <IconAction label="Deactivate" disabled={busy} onClick={onDeactivate}>
        <PowerOff />
      </IconAction>
      <IconAction label="Uninstall" disabled={busy} destructive onClick={onUninstall}>
        <CircleMinus />
      </IconAction>
    </ActionDock>
  )
}

const destructiveIconClass =
  'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30'

function SplitUninstallIcon({
  busy,
  formats,
  onUninstall,
  onUninstallFormat,
  onOpenChange,
}: {
  busy: boolean
  formats: string[]
  onUninstall: () => void
  onUninstallFormat: (format: string) => void
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const chevronRef = useRef<HTMLButtonElement>(null)
  const [coords, setCoords] = useState({ top: 0, right: 0 })

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  useEffect(() => {
    return () => onOpenChange?.(false)
  }, [onOpenChange])

  useEffect(() => {
    if (!open) return
    function place() {
      const rect = chevronRef.current?.getBoundingClientRect()
      if (!rect) return
      setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
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
  }, [open])

  const iconButton =
    'inline-flex items-center justify-center outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5'

  return (
    <div ref={rootRef} data-keep-selection="" className="inline-flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={busy}
            aria-label="Uninstall"
            className={cn(iconButton, 'size-7 rounded-l-md rounded-r-none', destructiveIconClass)}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
              onUninstall()
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <CircleMinus />
          </button>
        </TooltipTrigger>
        <TooltipContent>Uninstall</TooltipContent>
      </Tooltip>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <button
            ref={chevronRef}
            type="button"
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Uninstall format"
            className={cn(
              iconButton,
              destructiveIconClass,
              'h-7 w-4 rounded-l-none rounded-r-md border-l !border-red-200/70 [&_svg]:size-3 dark:!border-red-500/20',
            )}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setOpen((value) => !value)
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <ChevronDown />
          </button>
        </TooltipTrigger>
        <TooltipContent>Uninstall format</TooltipContent>
      </Tooltip>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              data-keep-selection=""
              style={{ top: coords.top, right: coords.right }}
              className="fixed z-50 min-w-40 rounded-md border bg-popover p-1 shadow-sm"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {formats.map((format) => (
                <button
                  key={format}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-destructive outline-none hover:bg-red-100 dark:hover:bg-red-500/20"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setOpen(false)
                    onUninstallFormat(format)
                  }}
                >
                  Uninstall {format.toUpperCase()}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

function ActionDock({
  children,
  offset,
  visible,
}: {
  children: ReactNode
  offset?: boolean
  visible?: boolean
}) {
  return (
    <div
      data-no-marquee=""
      className={cn(
        'absolute top-1.5 z-10 flex gap-0.5 transition-opacity',
        offset ? 'right-11' : 'right-1.5',
        visible
          ? 'opacity-100'
          : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
      )}
    >
      {children}
    </div>
  )
}

function IconAction({
  label,
  disabled,
  destructive,
  success,
  warn,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  destructive?: boolean
  success?: boolean
  warn?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-md outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5',
            destructive
              ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30'
              : warn
                ? 'bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900'
                : success
                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-400 dark:hover:bg-emerald-500/30'
                  : 'border bg-card hover:bg-muted',
          )}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onClick()
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

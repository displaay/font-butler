import type { ReactNode } from 'react'
import { CircleMinus, CirclePlus, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { FontStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

type CatalogCardActionHandlers = {
  busy: boolean
  onInstall: () => void
  onReinstall: () => void
  onDeactivate: () => void
  onUninstall: () => void
  onActivate: () => void
  onForget: () => void
}

export function CatalogCardActions({
  status,
  missingSource,
  busy,
  offset,
  visible,
  onInstall,
  onReinstall,
  onDeactivate,
  onUninstall,
  onActivate,
  onForget,
}: CatalogCardActionHandlers & {
  status: FontStatus
  missingSource: boolean
  offset?: boolean
  visible?: boolean
}) {
  const installed = status === 'installed' || status === 'outdated'
  return (
    <ActionDock offset={offset} visible={visible}>
      {installed ? (
        <>
          {status === 'outdated' ? (
            <IconAction label="Reinstall" disabled={busy} onClick={onReinstall}>
              <RefreshCw />
            </IconAction>
          ) : null}
          <IconAction label="Deactivate" disabled={busy} onClick={onDeactivate}>
            <PowerOff />
          </IconAction>
          <IconAction label="Uninstall" disabled={busy} destructive onClick={onUninstall}>
            <CircleMinus />
          </IconAction>
        </>
      ) : status === 'deactivated' ? (
        <IconAction label="Activate" disabled={busy} onClick={onActivate}>
          <Power />
        </IconAction>
      ) : (
        <IconAction label="Install" disabled={busy} success onClick={onInstall}>
          <CirclePlus />
        </IconAction>
      )}
      {missingSource && (
        <IconAction label="Remove from list" disabled={busy} destructive onClick={onForget}>
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
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  destructive?: boolean
  success?: boolean
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
              ? 'bg-destructive text-white hover:bg-destructive/90'
              : success
                ? 'bg-emerald-600 text-white hover:bg-emerald-600/90'
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

import type { ReactNode } from 'react'
import { ArrowLeftRight, CircleMinus, CirclePlus, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { CatalogBatchPlan } from '@/lib/batch'
import { actionLabel, forgetSourcesLabel } from '@/lib/batch'
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
  formatSwap?: { from: string; to: string } | null
  onFormatSwap?: () => void
  onForget: () => void
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
}: CatalogCardActionHandlers & {
  plan: CatalogBatchPlan
  previewOnly?: boolean
  missingSource: boolean
  offset?: boolean
  visible?: boolean
}) {
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
    <ActionDock offset={offset} visible={visible}>
      {plan.reinstall > 0 && (
        <IconAction
          label={actionLabel('Install update', plan.reinstall, plan.reinstall > 1)}
          disabled={busy}
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
      {formatSwap && onFormatSwap && (
        <IconAction label={formatSwapLabel(formatSwap)} disabled={busy} success onClick={onFormatSwap}>
          <ArrowLeftRight />
        </IconAction>
      )}
      {onSwitch && (
        <IconAction label="Switch" disabled={busy} onClick={onSwitch}>
          <ArrowLeftRight />
        </IconAction>
      )}
      {plan.activate > 0 && (
        <IconAction label="Activate" disabled={busy} onClick={onActivate}>
          <Power />
        </IconAction>
      )}
      {plan.deactivate > 0 && (
        <IconAction label="Deactivate" disabled={busy} onClick={onDeactivate}>
          <PowerOff />
        </IconAction>
      )}
      {plan.uninstall > 0 && (
        <IconAction label="Uninstall" disabled={busy} destructive onClick={onUninstall}>
          <CircleMinus />
        </IconAction>
      )}
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
              ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30'
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

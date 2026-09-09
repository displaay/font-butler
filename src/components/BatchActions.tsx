import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeftRight, CircleMinus, CirclePlus, ListX, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react'
import { AdobeLogo } from '@/components/Badges'
import { Button } from '@/components/ui/button'
import { SplitUninstallButton } from '@/components/SplitUninstallButton'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import {
  actionLabel,
  activateActionLabel,
  deleteSourcesLabel,
  forgetSourcesLabel,
  hasCatalogBatchActions,
  hasSystemBatchActions,
  type CatalogBatchPlan,
  type SystemBatchPlan,
} from '@/lib/batch'
import { hasInstanceMenuActions, type InstanceMenuPlan } from '@/lib/eligibility'
import { formatSwapLabel, instanceSwapLabel, type FormatSwap } from '@/lib/formats'
import { cn } from '@/lib/utils'

const destructiveMenuItemClass =
  'text-destructive focus:text-destructive data-[highlighted]:bg-red-100 data-[highlighted]:text-destructive dark:data-[highlighted]:bg-red-500/20'

export function CatalogBatchButtons({
  plan,
  busy,
  onInstall,
  onActivate,
  onDeactivate,
  onUninstall,
  onUninstallAndRemove,
  onReinstall,
  onRepair,
  onForget,
  onDeleteFiles,
  formatSwap = null,
  onFormatSwap,
  splitMenuPlacement = 'down',
}: {
  plan: CatalogBatchPlan
  busy: boolean
  onInstall: () => void
  onActivate: () => void
  onDeactivate: () => void
  onUninstall: () => void
  onUninstallAndRemove?: () => void
  onReinstall: () => void
  onRepair?: () => void
  onForget: () => void
  onDeleteFiles?: () => void
  formatSwap?: FormatSwap | null
  onFormatSwap?: () => void
  splitMenuPlacement?: 'up' | 'down'
}) {
  if (!hasCatalogBatchActions(plan) && !formatSwap) return null
  const multi = plan.count > 1
  const installVerb = plan.installMissing ? 'Install missing' : 'Install'
  const uninstallExtras = [
    plan.uninstallAndRemove > 0 && onUninstallAndRemove
      ? {
          key: 'uninstall-and-delete',
          label: actionLabel('Uninstall and delete sources', plan.uninstallAndRemove, multi),
          onSelect: onUninstallAndRemove,
        }
      : null,
    plan.deleteFiles > 0 && onDeleteFiles
      ? {
          key: 'delete-sources',
          label: deleteSourcesLabel(plan.deleteFiles, multi),
          onSelect: onDeleteFiles,
        }
      : null,
  ].filter((item): item is { key: string; label: string; onSelect: () => void } => Boolean(item))
  const extrasOnSplit = plan.uninstall > 0
  return (
    <div className="flex flex-wrap gap-2">
      {plan.reinstall > 0 && (
        <Button size="sm" variant="accent" disabled={busy} onClick={onReinstall}>
          <RefreshCw /> {actionLabel('Install update', plan.reinstall, plan.reinstall > 1 || multi)}
        </Button>
      )}
      {plan.repair > 0 && onRepair && (
        <Button size="sm" variant="outline" disabled={busy} onClick={onRepair}>
          <RefreshCw /> Reinstall installed version
        </Button>
      )}
      {plan.install > 0 && (
        <Button size="sm" variant="success" disabled={busy} onClick={onInstall}>
          <CirclePlus /> {actionLabel(installVerb, plan.install, plan.install > 1 || multi)}
        </Button>
      )}
      {plan.activate > 0 && (
        <Button size="sm" disabled={busy} onClick={onActivate}>
          <Power /> {activateActionLabel(plan, multi)}
        </Button>
      )}
      {formatSwap && onFormatSwap ? (
        <Button size="sm" disabled={busy} onClick={onFormatSwap}>
          <ArrowLeftRight /> {formatSwapLabel(formatSwap)}
        </Button>
      ) : null}
      {plan.deactivate > 0 && (
        <Button size="sm" variant="outline" disabled={busy} onClick={onDeactivate}>
          <PowerOff /> Deactivate
        </Button>
      )}
      {plan.uninstall > 0 && (
        <SplitUninstallButton
          busy={busy}
          uninstallLabel="Uninstall"
          extras={uninstallExtras}
          onUninstall={onUninstall}
          menuPlacement={splitMenuPlacement}
        />
      )}
      {!extrasOnSplit &&
        plan.uninstallAndRemove > 0 &&
        onUninstallAndRemove && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={onUninstallAndRemove}>
            <Trash2 /> {actionLabel('Uninstall and delete sources', plan.uninstallAndRemove, multi)}
          </Button>
        )}
      {plan.forget > 0 && (
        <Button size="sm" variant="outline" disabled={busy} onClick={onForget}>
          <ListX /> {forgetSourcesLabel(plan.forget, multi)}
        </Button>
      )}
      {!extrasOnSplit && plan.deleteFiles > 0 && onDeleteFiles && (
        <Button size="sm" variant="destructive" disabled={busy} onClick={onDeleteFiles}>
          <Trash2 /> {deleteSourcesLabel(plan.deleteFiles, multi)}
        </Button>
      )}
    </div>
  )
}

export function SystemBatchButtons({
  plan,
  busy,
  onDeactivate,
  onUninstall,
}: {
  plan: SystemBatchPlan
  busy: boolean
  onDeactivate: () => void
  onUninstall: () => void
}) {
  if (!hasSystemBatchActions(plan)) return null
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={onDeactivate}>
        <PowerOff /> Deactivate
      </Button>
      <Button size="sm" variant="destructive" disabled={busy} onClick={onUninstall}>
        <CircleMinus /> Uninstall
      </Button>
    </div>
  )
}

export function BatchActionBarContainer({
  open,
  children,
}: {
  open: boolean
  children: ReactNode
}) {
  const [rendered, setRendered] = useState(open)
  const [visible, setVisible] = useState(false)
  const contentRef = useRef(children)
  const frameRef = useRef(0)

  if (open && children) contentRef.current = children

  useLayoutEffect(() => {
    cancelAnimationFrame(frameRef.current)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (open) {
      setRendered(true)
      if (reduceMotion) {
        setVisible(true)
        return
      }
      setVisible(false)
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = requestAnimationFrame(() => setVisible(true))
      })
      return () => cancelAnimationFrame(frameRef.current)
    }

    if (reduceMotion) {
      setRendered(false)
      setVisible(false)
      return
    }
    setVisible(false)
  }, [open])

  if (!rendered) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center overflow-hidden p-4">
      <div
        className={cn(
          'w-full max-w-3xl will-change-transform',
          visible ? 'pointer-events-auto' : 'pointer-events-none',
          'transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-[calc(100%+1rem)] opacity-0',
        )}
        onTransitionEnd={(event) => {
          if (event.target !== event.currentTarget || visible || open) return
          setRendered(false)
        }}
      >
        {contentRef.current}
      </div>
    </div>
  )
}

export function BatchActionBar({
  count,
  summary,
  children,
}: {
  count: number
  summary: string
  children: ReactNode
}) {
  if (count < 1) return null
  return (
    <div
      data-keep-selection=""
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {count} {count === 1 ? 'font' : 'fonts'} selected
        </p>
        {summary ? <p className="text-xs text-muted-foreground">{summary}</p> : null}
      </div>
      {children}
    </div>
  )
}

export function CatalogMenuItems({
  plan,
  busy,
  showInstallAs,
  onInstall,
  onInstallAs,
  onInstallToAdobe,
  onReinstall,
  onRepair,
  onDeactivate,
  onUninstall,
  onUninstallAndRemove,
  onActivate,
  onSwitch,
  onForget,
  onDeleteFiles,
  formatUninstalls = [],
  onUninstallFormat,
  formatSwap = null,
  onFormatSwap,
}: {
  plan: CatalogBatchPlan
  busy: boolean
  showInstallAs?: boolean
  onInstall: () => void
  onInstallAs?: () => void
  onInstallToAdobe?: () => void
  onReinstall: () => void
  onRepair?: () => void
  onDeactivate: () => void
  onUninstall: () => void
  onUninstallAndRemove?: () => void
  onActivate: () => void
  /** Passed only when a same-format occupying sibling exists (`canSwitchTo`). */
  onSwitch?: () => void
  onForget: () => void
  onDeleteFiles?: () => void
  formatUninstalls?: string[]
  onUninstallFormat?: (format: string) => void
  formatSwap?: { from: string; to: string } | null
  onFormatSwap?: () => void
}) {
  const multi = plan.count > 1
  const installVerb = plan.installMissing ? 'Install missing' : 'Install'
  const hasPrimary =
    plan.reinstall > 0 ||
    plan.repair > 0 ||
    plan.install > 0 ||
    plan.adobeInstall > 0 ||
    plan.activate > 0 ||
    plan.deactivate > 0 ||
    plan.uninstall > 0 ||
    plan.uninstallAndRemove > 0 ||
    formatUninstalls.length >= 2 ||
    Boolean(formatSwap)
  return (
    <>
      {plan.reinstall > 0 && (
        <ContextMenuItem disabled={busy} onSelect={onReinstall}>
          <RefreshCw /> {actionLabel('Install update', plan.reinstall, plan.reinstall > 1 || multi)}
        </ContextMenuItem>
      )}
      {plan.repair > 0 && onRepair && (
        <ContextMenuItem disabled={busy} onSelect={onRepair}>
          <RefreshCw /> Reinstall installed version
        </ContextMenuItem>
      )}
      {plan.install > 0 && (
        <ContextMenuItem disabled={busy} onSelect={onInstall}>
          <CirclePlus /> {actionLabel(installVerb, plan.install, plan.install > 1 || multi)}
        </ContextMenuItem>
      )}
      {showInstallAs && plan.install > 0 && onInstallAs && (
        <ContextMenuItem disabled={busy} onSelect={onInstallAs}>
          <CirclePlus /> Install as…
        </ContextMenuItem>
      )}
      {plan.activate > 0 && (
        <ContextMenuItem disabled={busy} onSelect={onActivate}>
          <Power /> {activateActionLabel(plan, multi)}
        </ContextMenuItem>
      )}
      {formatSwap && onFormatSwap ? (
        <ContextMenuItem disabled={busy} onSelect={onFormatSwap}>
          <ArrowLeftRight /> {formatSwapLabel(formatSwap)}
        </ContextMenuItem>
      ) : null}
      {plan.adobeInstall > 0 && onInstallToAdobe && (
        <ContextMenuItem disabled={busy} onSelect={onInstallToAdobe}>
          <AdobeLogo /> {actionLabel('Install to Adobe testing folder', plan.adobeInstall, multi)}
        </ContextMenuItem>
      )}
      {onSwitch && (
        <ContextMenuItem disabled={busy} onSelect={onSwitch}>
          <ArrowLeftRight /> Switch
        </ContextMenuItem>
      )}
      {plan.deactivate > 0 && (
        <ContextMenuItem disabled={busy} onSelect={onDeactivate}>
          <PowerOff /> Deactivate
        </ContextMenuItem>
      )}
      {plan.uninstall > 0 && (
        <ContextMenuItem
          disabled={busy}
          className={destructiveMenuItemClass}
          onSelect={onUninstall}
        >
          <CircleMinus /> Uninstall
        </ContextMenuItem>
      )}
      {formatUninstalls.length >= 2 && onUninstallFormat ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={busy} className={destructiveMenuItemClass}>
            <CircleMinus /> Uninstall format…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {formatUninstalls.map((format) => (
              <ContextMenuItem
                key={format}
                disabled={busy}
                onSelect={() => onUninstallFormat(format)}
              >
                {format.toUpperCase()}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      {plan.uninstallAndRemove > 0 && onUninstallAndRemove && (
        <ContextMenuItem
          disabled={busy}
          className={destructiveMenuItemClass}
          onSelect={onUninstallAndRemove}
        >
          <Trash2 /> {actionLabel('Uninstall and delete sources', plan.uninstallAndRemove, multi)}
        </ContextMenuItem>
      )}
      {(plan.forget > 0 || plan.deleteFiles > 0) && (
        <>
          {hasPrimary && <ContextMenuSeparator />}
          {plan.forget > 0 && (
            <ContextMenuItem disabled={busy} onSelect={onForget}>
              <ListX /> {forgetSourcesLabel(plan.forget, multi)}
            </ContextMenuItem>
          )}
          {plan.deleteFiles > 0 && onDeleteFiles && (
            <ContextMenuItem
              disabled={busy}
              className={destructiveMenuItemClass}
              onSelect={onDeleteFiles}
            >
              <Trash2 /> {deleteSourcesLabel(plan.deleteFiles, multi)}
            </ContextMenuItem>
          )}
        </>
      )}
    </>
  )
}

export function SystemMenuItems({
  plan,
  busy,
  onDeactivate,
  onUninstall,
}: {
  plan: SystemBatchPlan
  busy: boolean
  onDeactivate: () => void
  onUninstall: () => void
}) {
  const enabled = hasSystemBatchActions(plan)
  return (
    <>
      <ContextMenuItem disabled={!enabled || busy} onSelect={onDeactivate}>
        <PowerOff /> Deactivate
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!enabled || busy}
        className={destructiveMenuItemClass}
        onSelect={onUninstall}
      >
        <CircleMinus /> Uninstall
      </ContextMenuItem>
    </>
  )
}

export function InstanceMenuItems({
  plan,
  entryId,
  busy,
  onInstall,
  onActivate,
  onDeactivate,
  onUninstall,
  onInstallToAdobe,
  onFormatSwap,
}: {
  plan: InstanceMenuPlan
  entryId: string
  busy: boolean
  onInstall: () => void
  onActivate: () => void
  onDeactivate: () => void
  onUninstall: () => void
  onInstallToAdobe: () => void
  onFormatSwap?: () => void
}) {
  if (!hasInstanceMenuActions(plan)) return null
  return (
    <>
      {plan.install ? (
        <ContextMenuItem disabled={busy} onSelect={onInstall}>
          <CirclePlus /> Install instance
        </ContextMenuItem>
      ) : null}
      {plan.activate ? (
        <ContextMenuItem disabled={busy} onSelect={onActivate}>
          <Power /> Activate instance
        </ContextMenuItem>
      ) : null}
      {plan.formatSwap && onFormatSwap ? (
        <ContextMenuItem disabled={busy} onSelect={onFormatSwap}>
          <ArrowLeftRight /> {instanceSwapLabel(plan.formatSwap, entryId)}
        </ContextMenuItem>
      ) : null}
      {plan.adobeInstall ? (
        <ContextMenuItem disabled={busy} onSelect={onInstallToAdobe}>
          <AdobeLogo /> Install to Adobe testing folder
        </ContextMenuItem>
      ) : null}
      {plan.deactivate ? (
        <ContextMenuItem disabled={busy} onSelect={onDeactivate}>
          <PowerOff /> Deactivate instance
        </ContextMenuItem>
      ) : null}
      {plan.uninstall ? (
        <ContextMenuItem
          disabled={busy}
          className={destructiveMenuItemClass}
          onSelect={onUninstall}
        >
          <CircleMinus /> Uninstall instance
        </ContextMenuItem>
      ) : null}
    </>
  )
}

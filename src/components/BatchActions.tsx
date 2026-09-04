import type { ReactNode } from 'react'
import { Download, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  actionLabel,
  hasCatalogBatchActions,
  hasSystemBatchActions,
  type CatalogBatchPlan,
  type SystemBatchPlan,
} from '@/lib/batch'

export function CatalogBatchButtons({
  plan,
  busy,
  onInstall,
  onActivate,
  onDeactivate,
  onUninstall,
  onReinstall,
  onForget,
}: {
  plan: CatalogBatchPlan
  busy: boolean
  onInstall: () => void
  onActivate: () => void
  onDeactivate: () => void
  onUninstall: () => void
  onReinstall: () => void
  onForget: () => void
}) {
  if (!hasCatalogBatchActions(plan)) return null
  const multi = plan.count > 1
  return (
    <div className="flex flex-wrap gap-2">
      {plan.reinstall > 0 && (
        <Button size="sm" variant="accent" disabled={busy} onClick={onReinstall}>
          <RefreshCw /> {actionLabel('Reinstall', plan.reinstall, multi)}
        </Button>
      )}
      {plan.install > 0 && (
        <Button size="sm" disabled={busy} onClick={onInstall}>
          <Download /> {actionLabel('Install', plan.install, multi)}
        </Button>
      )}
      {plan.activate > 0 && (
        <Button size="sm" disabled={busy} onClick={onActivate}>
          <Power /> {actionLabel('Activate', plan.activate, multi)}
        </Button>
      )}
      {plan.deactivate > 0 && (
        <Button size="sm" variant="outline" disabled={busy} onClick={onDeactivate}>
          <PowerOff /> {actionLabel('Deactivate', plan.deactivate, multi)}
        </Button>
      )}
      {plan.uninstall > 0 && (
        <Button size="sm" variant="destructive" disabled={busy} onClick={onUninstall}>
          <Trash2 /> {actionLabel('Uninstall', plan.uninstall, multi)}
        </Button>
      )}
      {plan.forget > 0 && (
        <Button size="sm" variant="destructive" disabled={busy} onClick={onForget}>
          <Trash2 /> {actionLabel('Remove from library', plan.forget, multi)}
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
  const multi = plan.count > 1
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={onDeactivate}>
        <PowerOff /> {actionLabel('Deactivate', plan.deactivate, multi)}
      </Button>
      <Button size="sm" variant="destructive" disabled={busy} onClick={onUninstall}>
        <Trash2 /> {actionLabel('Uninstall', plan.uninstall, multi)}
      </Button>
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
  if (count <= 1) return null
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2">
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
  onReinstall,
  onDeactivate,
  onUninstall,
  onActivate,
  onForget,
}: {
  plan: CatalogBatchPlan
  busy: boolean
  showInstallAs?: boolean
  onInstall: () => void
  onInstallAs?: () => void
  onReinstall: () => void
  onDeactivate: () => void
  onUninstall: () => void
  onActivate: () => void
  onForget: () => void
}) {
  const multi = plan.count > 1
  const hasPrimary =
    plan.reinstall > 0 ||
    plan.install > 0 ||
    plan.activate > 0 ||
    plan.deactivate > 0 ||
    plan.uninstall > 0
  return (
    <>
      {plan.reinstall > 0 && (
        <ContextMenuItem disabled={busy} onSelect={onReinstall}>
          <RefreshCw /> {actionLabel('Reinstall', plan.reinstall, multi)}
        </ContextMenuItem>
      )}
      {plan.install > 0 && (
        <ContextMenuItem disabled={busy} onSelect={onInstall}>
          <Download /> {actionLabel('Install', plan.install, multi)}
        </ContextMenuItem>
      )}
      {showInstallAs && plan.install > 0 && onInstallAs && (
        <ContextMenuItem disabled={busy} onSelect={onInstallAs}>
          <Download /> Install as…
        </ContextMenuItem>
      )}
      {plan.activate > 0 && (
        <ContextMenuItem disabled={busy} onSelect={onActivate}>
          <Power /> {actionLabel('Activate', plan.activate, multi)}
        </ContextMenuItem>
      )}
      {plan.deactivate > 0 && (
        <ContextMenuItem disabled={busy} onSelect={onDeactivate}>
          <PowerOff /> {actionLabel('Deactivate', plan.deactivate, multi)}
        </ContextMenuItem>
      )}
      {plan.uninstall > 0 && (
        <ContextMenuItem disabled={busy} onSelect={onUninstall}>
          <Trash2 /> {actionLabel('Uninstall', plan.uninstall, multi)}
        </ContextMenuItem>
      )}
      {plan.forget > 0 && (
        <>
          {hasPrimary && <ContextMenuSeparator />}
          <ContextMenuItem
            disabled={busy}
            className="text-destructive focus:text-destructive"
            onSelect={onForget}
          >
            <Trash2 /> {actionLabel('Remove from library', plan.forget, multi)}
          </ContextMenuItem>
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
  const multi = plan.count > 1
  const enabled = hasSystemBatchActions(plan)
  return (
    <>
      <ContextMenuItem disabled={!enabled || busy} onSelect={onDeactivate}>
        <PowerOff /> {actionLabel('Deactivate', Math.max(plan.deactivate, 1), multi && enabled)}
      </ContextMenuItem>
      <ContextMenuItem disabled={!enabled || busy} onSelect={onUninstall}>
        <Trash2 /> {actionLabel('Uninstall', Math.max(plan.uninstall, 1), multi && enabled)}
      </ContextMenuItem>
    </>
  )
}

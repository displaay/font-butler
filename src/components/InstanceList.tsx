import type { MouseEvent, PointerEvent, ReactNode } from 'react'
import { AaPreview, PreviewRetryBoundary } from '@/components/AaPreview'
import { DestinationIcons, FormatBadge, InstanceInstallBadge, RetailBadge, SourceBadge, TrialBadge } from '@/components/Badges'
import { InstanceMenuItems } from '@/components/BatchActions'
import { DisplaayMark } from '@/components/DisplaayMark'
import { catalogFontFamily, systemFontFamily } from '@/components/FontFaceStyles'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { hasInstanceMenuActions, instanceContextMenuOpen, instanceMenuPlan } from '@/lib/eligibility'
import { entryHasPreviewFile } from '@/lib/group'
import type { InstanceRow } from '@/lib/instances'
import { cardPreviewSample } from '@/lib/previewSample'
import type { CatalogEntry } from '@/lib/types'
import { cn } from '@/lib/utils'

export type InstanceActions = {
  entries: CatalogEntry[]
  busy: boolean
  onInstall: (entryId: string) => void
  onActivate: (entryId: string) => void
  onDeactivate: (entryId: string) => void
  onUninstall: (entryId: string) => void
  onInstallToAdobe: (entryId: string) => void
  onUninstallFromAdobe?: (entryId: string) => void
  adobeAvailable?: boolean
  onFormatSwap?: (entryId: string) => void
  onOpen?: (entryId: string) => void
  onTurnRetailSyncOff?: (entryId: string) => void
  onRevealInstalled?: (entryId: string) => void
  onRevealSource?: (entryId: string) => void
  uninstallOnly?: boolean
}

function stopFamilyMenu(event: MouseEvent | PointerEvent) {
  event.stopPropagation()
}

function InstanceRowMenu({
  entry,
  family,
  busy,
  children,
  onInstall,
  onActivate,
  onDeactivate,
  onUninstall,
  onInstallToAdobe,
  adobeAvailable = true,
  onUninstallFromAdobe,
  onFormatSwap,
  onOpen,
  onTurnRetailSyncOff,
  onRevealInstalled,
  onRevealSource,
  retailSynced,
  uninstallOnly = false,
}: {
  entry: CatalogEntry
  family: CatalogEntry[]
  busy: boolean
  children: ReactNode
  onInstall: (entryId: string) => void
  onActivate: (entryId: string) => void
  onDeactivate: (entryId: string) => void
  onUninstall: (entryId: string) => void
  onInstallToAdobe: (entryId: string) => void
  adobeAvailable?: boolean
  onUninstallFromAdobe?: (entryId: string) => void
  onFormatSwap?: (entryId: string) => void
  onOpen?: (entryId: string) => void
  onTurnRetailSyncOff?: (entryId: string) => void
  onRevealInstalled?: (entryId: string) => void
  onRevealSource?: (entryId: string) => void
  retailSynced?: boolean
  uninstallOnly?: boolean
}) {
  const plan = instanceMenuPlan(entry, family, adobeAvailable)
  const showTurnSyncOff = Boolean(onTurnRetailSyncOff && retailSynced)
  if (
    !instanceContextMenuOpen(entry, plan, {
      turnRetailSyncOff: showTurnSyncOff,
      uninstallOnly,
    })
  ) {
    return children
  }
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) onOpen?.(entry.id)
      }}
    >
      <ContextMenuTrigger asChild onContextMenu={stopFamilyMenu} onPointerDown={stopFamilyMenu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {uninstallOnly ? (
          <ContextMenuItem disabled={busy} onSelect={() => onUninstall(entry.id)}>
            Uninstall
          </ContextMenuItem>
        ) : showTurnSyncOff ? (
          <>
            <ContextMenuItem disabled={busy} onSelect={() => onTurnRetailSyncOff?.(entry.id)}>
              <DisplaayMark /> Turn sync off
            </ContextMenuItem>
            {hasInstanceMenuActions(plan) ? <ContextMenuSeparator /> : null}
          </>
        ) : null}
        {uninstallOnly ? null : (
        <InstanceMenuItems
          entry={entry}
          plan={plan}
          entryId={entry.id}
          busy={busy}
          onRevealInstalled={() => onRevealInstalled?.(entry.id)}
          onRevealSource={() => onRevealSource?.(entry.id)}
          onInstall={() => onInstall(entry.id)}
          onActivate={() => onActivate(entry.id)}
          onDeactivate={() => onDeactivate(entry.id)}
          onUninstall={() => onUninstall(entry.id)}
          onInstallToAdobe={() => onInstallToAdobe(entry.id)}
          onUninstallFromAdobe={onUninstallFromAdobe ? () => onUninstallFromAdobe(entry.id) : undefined}
          onFormatSwap={onFormatSwap ? () => onFormatSwap(entry.id) : undefined}
        />
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function InstanceList({
  rows,
  selectedEntryId,
  onSelectEntry,
  instanceActions,
  className,
}: {
  rows: InstanceRow[]
  selectedEntryId?: string | null
  onSelectEntry?: (entryId: string) => void
  instanceActions?: InstanceActions
  className?: string
}) {
  return (
    <ul className={cn('space-y-1 border-t px-3 py-2', className)}>
      {rows.map((row) => {
        const family = row.catalogEntryId
          ? catalogFontFamily(row.catalogEntryId)
          : row.systemPath
            ? systemFontFamily(row.systemPath)
            : 'ui-sans-serif'
        const selected = row.catalogEntryId && row.catalogEntryId === selectedEntryId
        const clickable = Boolean(row.catalogEntryId && onSelectEntry)
        const entry =
          row.catalogEntryId && instanceActions
            ? instanceActions.entries.find((item) => item.id === row.catalogEntryId)
            : undefined
        const button = (
          <button
            type="button"
            disabled={!clickable}
            onClick={() => row.catalogEntryId && onSelectEntry?.(row.catalogEntryId)}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 ease-out motion-reduce:transition-none',
              clickable && 'hover:bg-muted/80',
              selected && 'bg-muted ring-1 ring-primary/30',
              !clickable && 'cursor-default',
              row.installState && row.installState !== 'installed' && 'opacity-80',
            )}
          >
            <AaPreview
              size="sm"
              family={family}
              weight={row.weight}
              italic={row.italic}
              variation={row.variation}
              sample={cardPreviewSample(entry ? entryHasPreviewFile(entry) : true, row.previewSample)}
              wait={entry ? entryHasPreviewFile(entry) : true}
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="truncate text-sm font-medium">{row.label}</div>
                {row.format ? (
                  <FormatBadge format={row.format} inactive={row.installState !== 'installed'} />
                ) : null}
              </div>
              {row.sublabel && (
                <div className="truncate text-xs text-muted-foreground">{row.sublabel}</div>
              )}
            </div>
            {row.retailSynced ? <RetailBadge className="shrink-0" /> : null}
            {row.retailSynced && row.retailTrial ? <TrialBadge /> : null}
            {row.hasSource ? <SourceBadge className="shrink-0" /> : null}
            {row.installState && row.installState !== 'installed' ? (
              <InstanceInstallBadge state={row.installState} />
            ) : null}
            <DestinationIcons
              macos={Boolean(row.macosCopy)}
              adobe={Boolean(row.adobeCopy)}
              className="shrink-0 text-muted-foreground"
            />
          </button>
        )
        return (
          <li key={row.key} className="relative">
            <PreviewRetryBoundary>
              {entry && instanceActions ? (
                <InstanceRowMenu
                  entry={entry}
                  family={instanceActions.entries}
                  busy={instanceActions.busy}
                  onInstall={instanceActions.onInstall}
                  onActivate={instanceActions.onActivate}
                  onDeactivate={instanceActions.onDeactivate}
                  onUninstall={instanceActions.onUninstall}
                  onInstallToAdobe={instanceActions.onInstallToAdobe}
                  onUninstallFromAdobe={instanceActions.onUninstallFromAdobe}
                  adobeAvailable={instanceActions.adobeAvailable}
                  onFormatSwap={instanceActions.onFormatSwap}
                  onOpen={instanceActions.onOpen}
                  onTurnRetailSyncOff={instanceActions.onTurnRetailSyncOff}
                  onRevealInstalled={instanceActions.onRevealInstalled}
                  onRevealSource={instanceActions.onRevealSource}
                  retailSynced={row.retailSynced}
                  uninstallOnly={instanceActions.uninstallOnly}
                >
                  {button}
                </InstanceRowMenu>
              ) : (
                button
              )}
            </PreviewRetryBoundary>
          </li>
        )
      })}
    </ul>
  )
}

import type { MouseEvent, PointerEvent, ReactNode } from 'react'
import { AaPreview } from '@/components/AaPreview'
import { DestinationIcons, FormatBadge, InstanceInstallBadge, SourceBadge } from '@/components/Badges'
import { InstanceMenuItems } from '@/components/BatchActions'
import { catalogFontFamily, systemFontFamily } from '@/components/FontFaceStyles'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { hasInstanceMenuActions, instanceMenuPlan } from '@/lib/eligibility'
import type { InstanceRow } from '@/lib/instances'
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
  adobeAvailable?: boolean
  onFormatSwap?: (entryId: string) => void
  onOpen?: (entryId: string) => void
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
  onFormatSwap,
  onOpen,
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
  onFormatSwap?: (entryId: string) => void
  onOpen?: (entryId: string) => void
}) {
  const plan = instanceMenuPlan(entry, family, adobeAvailable)
  if (!hasInstanceMenuActions(plan)) return children
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
        <InstanceMenuItems
          plan={plan}
          entryId={entry.id}
          busy={busy}
          onInstall={() => onInstall(entry.id)}
          onActivate={() => onActivate(entry.id)}
          onDeactivate={() => onDeactivate(entry.id)}
          onUninstall={() => onUninstall(entry.id)}
          onInstallToAdobe={() => onInstallToAdobe(entry.id)}
          onFormatSwap={onFormatSwap ? () => onFormatSwap(entry.id) : undefined}
        />
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
              sample={row.previewSample}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{row.label}</div>
              {row.sublabel && (
                <div className="truncate text-xs text-muted-foreground">{row.sublabel}</div>
              )}
            </div>
            {row.format ? (
              <FormatBadge format={row.format} inactive={row.installState !== 'installed'} />
            ) : null}
            {row.hasSource ? <SourceBadge className="shrink-0" /> : null}
            {row.installState ? <InstanceInstallBadge state={row.installState} /> : null}
            <DestinationIcons
              macos={Boolean(row.macosCopy)}
              adobe={Boolean(row.adobeCopy)}
              className="shrink-0 text-muted-foreground"
            />
          </button>
        )
        return (
          <li key={row.key}>
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
                adobeAvailable={instanceActions.adobeAvailable}
                onFormatSwap={instanceActions.onFormatSwap}
                onOpen={instanceActions.onOpen}
              >
                {button}
              </InstanceRowMenu>
            ) : (
              button
            )}
          </li>
        )
      })}
    </ul>
  )
}

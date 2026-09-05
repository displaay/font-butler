import { CircleMinus, CirclePlus, FolderOpen, ListX, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react'
import { AaPreview } from '@/components/AaPreview'
import { CatalogBatchButtons, SystemBatchButtons } from '@/components/BatchActions'
import { SourceBadge } from '@/components/Badges'
import { catalogFontFamily, systemFontFamily } from '@/components/FontFaceStyles'
import { Button } from '@/components/ui/button'
import { formatBytes, formatRelativeTime } from '@/lib/utils'
import { entryHasTrackedSource, familyNameOf, hasTrackedSource } from '@/lib/group'
import type { CatalogBatchPlan, SystemBatchPlan } from '@/lib/batch'
import type { CatalogEntry, FamilyGroup, SystemFamilyGroup } from '@/lib/types'
import { cn } from '@/lib/utils'

const SAMPLE = 'The quick brown fox jumps over the lazy type.'

export function Inspector({
  group,
  entry,
  statusSummary,
  selectedEntryId,
  onSelectEntry,
  systemGroup,
  busy,
  onInstall,
  onInstallAs,
  onReinstall,
  onUninstall,
  onUninstallAndRemove,
  onDeactivate,
  onActivate,
  onReveal,
  onUninstallSystem,
  onDeactivateSystem,
  onRevealSystem,
  onForget,
  onDeleteFiles,
  multiSelect,
}: {
  group: FamilyGroup | null
  entry: CatalogEntry | null
  statusSummary: string | null
  selectedEntryId: string | null
  onSelectEntry: (entryId: string) => void
  systemGroup: SystemFamilyGroup | null
  busy: boolean
  onInstall: () => void
  onInstallAs: () => void
  onReinstall: () => void
  onUninstall: () => void
  onUninstallAndRemove?: () => void
  onDeactivate: () => void
  onActivate: () => void
  onReveal: (which: 'source' | 'installed') => void
  onUninstallSystem: () => void
  onDeactivateSystem: () => void
  onRevealSystem: () => void
  onForget: () => void
  onDeleteFiles?: () => void
  multiSelect?: {
    names: string[]
    summary: string
    catalogPlan?: CatalogBatchPlan
    systemPlan?: SystemBatchPlan
    onInstall: () => void
    onActivate: () => void
    onDeactivate: () => void
    onUninstall: () => void
    onUninstallAndRemove?: () => void
    onReinstall: () => void
    onForget: () => void
    onDeleteFiles?: () => void
    onDeactivateSystem: () => void
    onUninstallSystem: () => void
  }
}) {
  if (multiSelect && multiSelect.names.length > 1) {
    return (
      <aside className="flex w-full flex-col gap-4 p-5 md:w-80">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            {multiSelect.names.length} selected
          </h2>
          {multiSelect.summary ? (
            <p className="mt-1 text-sm text-muted-foreground">{multiSelect.summary}</p>
          ) : null}
        </div>
        <ul className="max-h-48 space-y-1 overflow-auto text-sm">
          {multiSelect.names.map((name) => (
            <li key={name} className="truncate">
              {name}
            </li>
          ))}
        </ul>
        {multiSelect.systemPlan ? (
          <>
            <SystemBatchButtons
              plan={multiSelect.systemPlan}
              busy={busy}
              onDeactivate={multiSelect.onDeactivateSystem}
              onUninstall={multiSelect.onUninstallSystem}
            />
            {multiSelect.systemPlan.uninstall === 0 && (
              <p className="text-xs text-muted-foreground">
                Protected fonts stay on the Mac. Font Buttler can only remove fonts you installed.
              </p>
            )}
          </>
        ) : multiSelect.catalogPlan ? (
          <CatalogBatchButtons
            plan={multiSelect.catalogPlan}
            busy={busy}
            onInstall={multiSelect.onInstall}
            onActivate={multiSelect.onActivate}
            onDeactivate={multiSelect.onDeactivate}
            onUninstall={multiSelect.onUninstall}
            onUninstallAndRemove={multiSelect.onUninstallAndRemove}
            onReinstall={multiSelect.onReinstall}
            onForget={multiSelect.onForget}
            onDeleteFiles={multiSelect.onDeleteFiles}
          />
        ) : null}
      </aside>
    )
  }

  if (systemGroup) {
    const face = systemGroup.faces[0]
    return (
      <aside className="flex w-full flex-col gap-4 p-5 md:w-80">
        <div
          className="font-preview rounded-lg border bg-muted/40 px-4 py-6 text-3xl leading-tight"
          style={{ fontFamily: `"${face ? systemFontFamily(face.path) : ''}", ui-sans-serif` }}
        >
          {SAMPLE}
        </div>
        <div>
          <h2 className="text-base font-semibold tracking-tight">{systemGroup.familyName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {systemGroup.instanceCount} {systemGroup.instanceCount === 1 ? 'instance' : 'instances'}
            {systemGroup.protected ? ' · system font' : ''}
          </p>
        </div>
        <ul className="space-y-1 text-sm">
          {systemGroup.faces.map((item) => (
            <li key={`${item.path}-${item.styleName}`} className="flex justify-between gap-3">
              <span>{item.styleName}</span>
              <span className="truncate text-muted-foreground">{item.postscriptName}</span>
            </li>
          ))}
        </ul>
        <p className="break-all text-xs text-muted-foreground">{face?.path}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onRevealSystem}>
            <FolderOpen /> Show in Finder
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!systemGroup.writable || busy}
            onClick={onDeactivateSystem}
          >
            <PowerOff /> Deactivate
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!systemGroup.writable || busy}
            onClick={onUninstallSystem}
          >
            <CircleMinus /> Uninstall
          </Button>
        </div>
        {!systemGroup.writable && (
          <p className="text-xs text-muted-foreground">
            Protected fonts stay on the Mac. Font Buttler can only remove fonts you installed.
          </p>
        )}
      </aside>
    )
  }

  if (!group || !entry) {
    return (
      <aside className="flex w-full items-center justify-center p-8 text-sm text-muted-foreground md:w-80">
        Select a family to inspect it.
      </aside>
    )
  }

  const previewFace =
    entry.faces.find((face) => /regular|roman|book/i.test(face.styleName)) ?? entry.faces[0]
  const installed = entry.status === 'installed' || entry.status === 'outdated'
  const showReinstall = group.entries.some((item) => item.status === 'outdated')

  return (
    <aside className="flex w-full flex-col gap-4 p-5 md:w-80">
      <div
        className="font-preview rounded-lg border bg-muted/40 px-4 py-6 text-3xl leading-tight"
        style={{
          fontFamily: `"${catalogFontFamily(entry.id)}", ui-sans-serif`,
          fontWeight: previewFace?.weight,
          fontStyle: previewFace?.italic ? 'italic' : 'normal',
        }}
      >
        {SAMPLE}
      </div>
      <div>
        <h2 className="text-base font-semibold tracking-tight">{familyNameOf(entry)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {group.instanceCount} {group.instanceCount === 1 ? 'instance' : 'instances'}
          {group.isVariable ? ' · variable' : ''}
          {group.entries.length > 1 ? ` · ${group.entries.length} files` : ''}
          {statusSummary ? ` · ${statusSummary}` : ''}
        </p>
      </div>
      {entry.status === 'outdated' && (
        <div className="rounded-md border bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Source changed. Reinstall to use the new file.
        </div>
      )}
      {entry.status === 'source-missing' && (
        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          The source file is missing. Remove this entry if you no longer need it.
        </div>
      )}
      {entry.status !== 'source-missing' && !entryHasTrackedSource(entry) && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          The tracked source file is gone. The installed copy stays on the Mac.
        </div>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Source</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <span className="truncate" title={entry.sourcePath}>
            {entry.sourcePath}
          </span>
          {entryHasTrackedSource(entry) ? (
            <SourceBadge className="bg-transparent shadow-none" />
          ) : null}
        </dd>
        <dt className="text-muted-foreground">Modified</dt>
        <dd>{formatRelativeTime(entry.sourceMtimeMs)}</dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd>{formatBytes(entry.sourceSize)}</dd>
        <dt className="text-muted-foreground">Format</dt>
        <dd className="uppercase">{entry.format}</dd>
      </dl>
      <div className="space-y-2">
        {group.entries.map((item) => {
          const selected = item.id === selectedEntryId
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectEntry(item.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/80',
                selected && 'bg-muted ring-1 ring-primary/30',
              )}
            >
              <AaPreview
                family={catalogFontFamily(item.id)}
                weight={item.faces[0]?.weight}
                italic={item.faces[0]?.italic}
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {item.faces.map((face) => face.styleName).join(', ')}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.faces[0]?.postscriptName}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {entry.status === 'source-missing' ? (
          <Button size="sm" variant="destructive" disabled={busy} onClick={onForget}>
            <ListX /> Remove from list
          </Button>
        ) : installed ? (
          <>
            {showReinstall && (
              <Button size="sm" variant="accent" disabled={busy} onClick={onReinstall}>
                <RefreshCw /> Reinstall
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={onDeactivate}>
              <PowerOff /> Deactivate
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={onUninstall}>
              <CircleMinus /> Uninstall
            </Button>
            {hasTrackedSource(group) && onUninstallAndRemove ? (
              <Button size="sm" variant="destructive" disabled={busy} onClick={onUninstallAndRemove}>
                <Trash2 /> Uninstall and remove
              </Button>
            ) : null}
          </>
        ) : entry.status === 'deactivated' ? (
          <Button size="sm" disabled={busy} onClick={onActivate}>
            <Power /> Activate
          </Button>
        ) : (
          <>
            <Button size="sm" disabled={busy} onClick={onInstall}>
              <CirclePlus /> Install
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onInstallAs}>
              <CirclePlus /> Install as…
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onForget}>
              <ListX /> Remove from list
            </Button>
            {onDeleteFiles && (
              <Button size="sm" variant="destructive" disabled={busy} onClick={onDeleteFiles}>
                <Trash2 /> Delete files
              </Button>
            )}
          </>
        )}
        {(entry.installedPath || entry.disabledPath) && (
          <Button size="sm" variant="outline" onClick={() => onReveal('installed')}>
            <FolderOpen /> Show in Finder
          </Button>
        )}
        {entryHasTrackedSource(entry) && (
          <Button size="sm" variant="outline" onClick={() => onReveal('source')}>
            <FolderOpen /> Show source in Finder
          </Button>
        )}
      </div>
    </aside>
  )
}

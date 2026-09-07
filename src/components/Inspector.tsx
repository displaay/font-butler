import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeftRight, CircleMinus, CirclePlus, FolderOpen, ListX, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react'
import { CatalogBatchButtons, SystemBatchButtons } from '@/components/BatchActions'
import { SourceBadge, StateBadges } from '@/components/Badges'
import { systemFontFamily } from '@/components/FontFaceStyles'
import { InstanceList } from '@/components/InstanceList'
import { SpecimenWorkspace } from '@/components/SpecimenWorkspace'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { catalogBatchPlan } from '@/lib/batch'
import type { InspectorDensity } from '@/lib/inspector'
import { catalogInstanceRows, systemInstanceRows } from '@/lib/instances'
import { collectionScopeLabel, displayStateLabel, needsLocateSource } from '@/lib/state'
import { formatBytes, formatRelativeTime } from '@/lib/utils'
import { entryHasTrackedSource, familyNameOf, hasTrackedSource } from '@/lib/group'
import type { CatalogBatchPlan, SystemBatchPlan } from '@/lib/batch'
import type { CatalogEntry, ComparisonCapture, FamilyGroup, PreviewPreferences, ProjectSet, SystemFamilyGroup } from '@/lib/types'
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
  specimen,
  onSpecimenChange,
  projects,
  compareEntry,
  comparisonInstallBlocked,
  onComparisonCapture,
  onInstall,
  onInstallAs,
  onReinstall,
  onRepair,
  onUninstall,
  onUninstallAndRemove,
  onDeactivate,
  onActivate,
  onSwitch,
  onReveal,
  onUninstallSystem,
  onDeactivateSystem,
  onRevealSystem,
  onForget,
  onDeleteFiles,
  onLocateSource,
  onLinkSource,
  onInstallToAdobe,
  onRemoveAdobeCopy,
  onResumeUpdates,
  onRestore,
  onPin,
  onOpenWithPreview,
  multiSelect,
  density = 'expanded',
}: {
  group: FamilyGroup | null
  entry: CatalogEntry | null
  statusSummary: string | null
  selectedEntryId: string | null
  onSelectEntry: (entryId: string) => void
  systemGroup: SystemFamilyGroup | null
  busy: boolean
  specimen?: PreviewPreferences
  onSpecimenChange?: (next: PreviewPreferences) => void
  projects?: ProjectSet[]
  compareEntry?: CatalogEntry | null
  comparisonInstallBlocked?: boolean
  onComparisonCapture?: (capture: ComparisonCapture | null) => void
  onInstall: () => void
  onInstallAs: () => void
  onReinstall: () => void
  onRepair?: () => void
  onUninstall: () => void
  onUninstallAndRemove?: () => void
  onDeactivate: () => void
  onActivate: () => void
  onSwitch?: () => void
  onReveal: (which: 'source' | 'installed') => void
  onUninstallSystem: () => void
  onDeactivateSystem: () => void
  onRevealSystem: () => void
  onForget: () => void
  onDeleteFiles?: () => void
  onLocateSource?: () => void
  onLinkSource?: () => void
  onInstallToAdobe?: () => void
  onRemoveAdobeCopy?: () => void
  onResumeUpdates?: () => void
  onRestore?: (fingerprint?: string) => void
  onPin?: (fingerprint: string) => void
  onOpenWithPreview?: () => void
  density?: InspectorDensity
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
    onRepair?: () => void
    onForget: () => void
    onDeleteFiles?: () => void
    onDeactivateSystem: () => void
    onUninstallSystem: () => void
  }
}) {
  if (multiSelect && multiSelect.names.length > 1) {
    return (
      <aside className={cn(inspectorShellClass(), 'gap-4 overflow-y-auto p-5')}>
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
            onRepair={multiSelect.onRepair}
            onForget={multiSelect.onForget}
            onDeleteFiles={multiSelect.onDeleteFiles}
          />
        ) : null}
        {compareEntry && entry && specimen && onSpecimenChange ? (
          <SpecimenWorkspace
            entry={entry}
            compareEntry={compareEntry}
            compare="families"
            specimen={specimen}
            onSpecimenChange={onSpecimenChange}
          />
        ) : null}
      </aside>
    )
  }

  if (systemGroup) {
    const face = systemGroup.faces[0]
    return (
      <aside className={inspectorShellClass()}>
        <SystemInspectorBody
          density={density}
          systemGroup={systemGroup}
          face={face}
          busy={busy}
          onRevealSystem={onRevealSystem}
          onDeactivateSystem={onDeactivateSystem}
          onUninstallSystem={onUninstallSystem}
        />
      </aside>
    )
  }

  if (!group || !entry) {
    return (
      <aside className={cn(inspectorShellClass(), 'items-center justify-center p-8 text-sm text-muted-foreground')}>
        Select a family to inspect it.
      </aside>
    )
  }

  const plan = catalogBatchPlan([group])
  const scope = collectionScopeLabel(entry)
  const previewOnly = Boolean(entry.previewOnly)
  const unlinked = entry.sourceAvailability === 'none' || (!entry.sourceAvailability && !entryHasTrackedSource(entry))
  const pinnedFor = (projects ?? []).filter((project) =>
    project.members.some((member) => member.assetId === entry.id && member.pinFingerprint),
  )

  const instances = catalogInstanceRows(group)
  const header = (
    <div>
      <h2 className="text-base font-semibold tracking-tight">{familyNameOf(entry)}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {group.instanceCount} {group.instanceCount === 1 ? 'instance' : 'instances'}
        {group.isVariable ? ' · variable' : ''}
        {group.entries.length > 1 ? ` · ${group.entries.length} files` : ''}
        {statusSummary ? ` · ${statusSummary}` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <StateBadges entry={entry} />
      </div>
    </div>
  )
  const notices = (
    <>
      <SourceStateCopy entry={entry} />
      {scope && <p className="text-xs text-muted-foreground">{scope}</p>}
      {pinnedFor.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Pinned for {pinnedFor.map((project) => project.name).join(', ')}
        </p>
      )}
    </>
  )
  const meta = (
    <>
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
        <dt className="text-muted-foreground">State</dt>
        <dd>{displayStateLabel(entry)}</dd>
      </dl>
      <DestinationCopies
        entry={entry}
        busy={busy}
        previewOnly={previewOnly}
        onInstallToAdobe={onInstallToAdobe}
        onRemoveAdobeCopy={onRemoveAdobeCopy}
      />
    </>
  )
  const files = (
    <div className="space-y-2">
      <h3 className="mb-2 text-sm font-medium">Instances</h3>
      <InstanceList
        rows={instances}
        selectedEntryId={selectedEntryId}
        onSelectEntry={onSelectEntry}
        className="border-t-0 px-0 py-0"
      />
    </div>
  )
  const specimenBlock =
    specimen && onSpecimenChange ? (
      <SpecimenWorkspace
        entry={entry}
        specimen={specimen}
        onSpecimenChange={onSpecimenChange}
        compareEntry={compareEntry}
        onCaptureChange={onComparisonCapture}
        size="large"
      />
    ) : null
  const versions = (
    <VersionsSection
      entry={entry}
      onRestore={onRestore}
      onPin={onPin}
      onResumeUpdates={onResumeUpdates}
    />
  )
  const actions = (
      <div className="flex flex-wrap gap-2">
        {previewOnly ? (
          <>
            <Button size="sm" variant="outline" onClick={onOpenWithPreview}>
              Open specimen
            </Button>
            {needsLocateSource(entry) && onLocateSource && (
              <Button size="sm" variant="outline" onClick={onLocateSource}>
                Locate source…
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={onForget}>
              <ListX /> Remove from list
            </Button>
          </>
        ) : entry.status === 'source-missing' ? (
          <>
            {onLocateSource && (
              <Button size="sm" onClick={onLocateSource}>
                Locate source…
              </Button>
            )}
            <Button size="sm" variant="destructive" disabled={busy} onClick={onForget}>
              <ListX /> Remove from list
            </Button>
          </>
        ) : (
          <>
            {plan.reinstall > 0 && (
              <Button
                size="sm"
                variant="accent"
                disabled={busy || comparisonInstallBlocked}
                onClick={onReinstall}
              >
                <RefreshCw /> Install update
              </Button>
            )}
            {plan.repair > 0 && onRepair && (
              <Button size="sm" variant="outline" disabled={busy} onClick={onRepair}>
                <RefreshCw /> Reinstall installed version
              </Button>
            )}
            {plan.install > 0 && (
              <Button size="sm" disabled={busy || comparisonInstallBlocked} onClick={onInstall}>
                <CirclePlus /> {plan.installMissing ? 'Install missing styles' : 'Install'}
              </Button>
            )}
            {plan.install > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || comparisonInstallBlocked}
                onClick={onInstallAs}
              >
                <CirclePlus /> Install as…
              </Button>
            )}
            {onSwitch && (
              <Button size="sm" disabled={busy} onClick={onSwitch}>
                <ArrowLeftRight /> Switch
              </Button>
            )}
            {plan.activate > 0 && (
              <Button size="sm" disabled={busy} onClick={onActivate}>
                <Power /> Activate
              </Button>
            )}
            {plan.deactivate > 0 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={onDeactivate}>
                <PowerOff /> Deactivate
              </Button>
            )}
            {plan.uninstall > 0 && (
              <Button size="sm" variant="destructive" disabled={busy} onClick={onUninstall}>
                <CircleMinus /> Uninstall
              </Button>
            )}
            {hasTrackedSource(group) && onUninstallAndRemove ? (
              <Button size="sm" variant="destructive" disabled={busy} onClick={onUninstallAndRemove}>
                <Trash2 /> Uninstall and remove
              </Button>
            ) : null}
            {plan.forget > 0 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={onForget}>
                <ListX /> Remove from list
              </Button>
            )}
            {onDeleteFiles && plan.deleteFiles > 0 && (
              <Button size="sm" variant="destructive" disabled={busy} onClick={onDeleteFiles}>
                <Trash2 /> Delete files
              </Button>
            )}
            {unlinked && onLinkSource && (
              <Button size="sm" variant="outline" onClick={onLinkSource}>
                Link source…
              </Button>
            )}
            {needsLocateSource(entry) && !unlinked && onLocateSource && (
              <Button size="sm" variant="outline" onClick={onLocateSource}>
                Locate source…
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
  )

  return (
    <aside className={inspectorShellClass()}>
      <InspectorLayout
        density={density}
        header={
          <>
            {header}
            {notices}
          </>
        }
        primary={specimenBlock}
        secondary={
          <>
            {meta}
            {files}
            {versions}
          </>
        }
        actions={actions}
      />
    </aside>
  )
}

function inspectorShellClass() {
  return 'flex h-full min-h-0 w-full flex-col overflow-hidden'
}

function InspectorLayout({
  density,
  header,
  primary,
  secondary,
  actions,
}: {
  density: InspectorDensity
  header: ReactNode
  primary: ReactNode
  secondary: ReactNode
  actions: ReactNode
}) {
  if (density === 'specimen') {
    return (
      <>
        <div className="shrink-0 space-y-2 border-b px-5 py-3">{header}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{primary}</div>
      </>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
      {header}
      {primary}
      {actions}
      {secondary}
    </div>
  )
}

function SystemInspectorBody({
  density,
  systemGroup,
  face,
  busy,
  onRevealSystem,
  onDeactivateSystem,
  onUninstallSystem,
}: {
  density: InspectorDensity
  systemGroup: SystemFamilyGroup
  face: SystemFamilyGroup['faces'][number] | undefined
  busy: boolean
  onRevealSystem: () => void
  onDeactivateSystem: () => void
  onUninstallSystem: () => void
}) {
  const instances = useMemo(() => systemInstanceRows(systemGroup), [systemGroup])
  const header = (
    <div>
      <h2 className="text-base font-semibold tracking-tight">{systemGroup.familyName}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {systemGroup.instanceCount} {systemGroup.instanceCount === 1 ? 'instance' : 'instances'}
        {systemGroup.protected ? ' · system font' : ''}
      </p>
    </div>
  )
  const preview = (
    <div
      className="font-preview min-h-[16rem] rounded-lg border bg-muted/40 p-6 text-5xl leading-tight"
      style={{ fontFamily: `"${face ? systemFontFamily(face.path) : ''}", ui-sans-serif` }}
    >
      {SAMPLE}
    </div>
  )
  const secondary = (
    <>
      <div>
        <h3 className="mb-2 text-sm font-medium">Instances</h3>
        <InstanceList rows={instances} className="border-t-0 px-0 py-0" />
      </div>
      <p className="break-all text-xs text-muted-foreground">{face?.path}</p>
    </>
  )
  const actions = (
    <>
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
    </>
  )
  return (
    <InspectorLayout
      density={density}
      header={header}
      primary={preview}
      secondary={secondary}
      actions={actions}
    />
  )
}

function DestinationCopies({
  entry,
  busy,
  previewOnly,
  onInstallToAdobe,
  onRemoveAdobeCopy,
}: {
  entry: CatalogEntry
  busy: boolean
  previewOnly: boolean
  onInstallToAdobe?: () => void
  onRemoveAdobeCopy?: () => void
}) {
  const copies = entry.installations ?? []
  const macos = copies.find((item) => item.destinationId === 'macos')
  const adobe = copies.find((item) => item.destinationId === 'adobe-shared')
  const macosPresent = Boolean(entry.installedPath || (macos && macos.verification === 'file-present'))
  return (
    <div className="space-y-2 rounded-md border px-3 py-2">
      <div className="text-sm font-medium">Copies</div>
      <p className="text-xs text-muted-foreground">
        This Mac is a system installation. The Adobe testing folder is a placed file only — Font
        Buttler does not verify that an Adobe app activated it.
      </p>
      <div className="text-sm">
        This Mac · {macosPresent ? (entry.status === 'deactivated' ? 'Deactivated' : 'Installed') : 'Not installed'}
      </div>
      <div className="text-sm">
        Adobe testing folder ·{' '}
        {adobe?.verification === 'file-present'
          ? 'File present'
          : adobe?.verification === 'unavailable'
            ? 'Unavailable'
            : 'Not placed'}
      </div>
      {!previewOnly && (
        <div className="flex flex-wrap gap-2">
          {onInstallToAdobe && adobe?.verification !== 'file-present' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onInstallToAdobe}>
              Install to Adobe testing folder
            </Button>
          )}
          {onRemoveAdobeCopy && adobe && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onRemoveAdobeCopy}>
              Remove Adobe copy
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function SourceStateCopy({ entry }: { entry: CatalogEntry }) {
  if (entry.previewOnly) {
    return (
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        Web font · Preview only. It can be compared here, but it cannot be installed on this Mac.
      </div>
    )
  }
  if (entry.updateHold === 'restore') {
    return (
      <div className="rounded-md border bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Updates paused after restore. The source can still show as an available update.
      </div>
    )
  }
  if (entry.updateHold === 'relink-review' || entry.status === 'outdated') {
    return (
      <div className="rounded-md border bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        A different source revision is available. Install update when you have reviewed it.
      </div>
    )
  }
  if (entry.sourceAvailability === 'offline') {
    return (
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        The source drive is offline. Font Buttler will not treat this as a deleted file.
      </div>
    )
  }
  if (entry.sourceAvailability === 'unreadable') {
    return (
      <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
        The source is unreadable. Check permissions, then refresh or locate it again.
      </div>
    )
  }
  if (entry.sourceAvailability === 'missing' || entry.status === 'source-missing') {
    return (
      <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
        The source file is missing. Locate it to keep this record, or remove it from the list.
      </div>
    )
  }
  if (entry.sourceAvailability === 'none') {
    return (
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        No external source is linked. The installed copy stays on the Mac.
      </div>
    )
  }
  return null
}

function VersionsSection({
  entry,
  onRestore,
  onPin,
  onResumeUpdates,
}: {
  entry: CatalogEntry
  onRestore?: (fingerprint?: string) => void
  onPin?: (fingerprint: string) => void
  onResumeUpdates?: () => void
}) {
  const [revisions, setRevisions] = useState<
    Array<{ fingerprint: string; current: boolean; previous: boolean }>
  >([])

  useEffect(() => {
    let cancelled = false
    void api
      .revisions(entry.id)
      .then((result) => {
        if (!cancelled) setRevisions(result.revisions)
      })
      .catch(() => {
        if (!cancelled) setRevisions([])
      })
    return () => {
      cancelled = true
    }
  }, [entry.id, entry.updatedAt, entry.previousRevisionId, entry.installedFingerprint])

  if (revisions.length === 0 && !entry.updateHold) return null

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Versions</h3>
      <ul className="space-y-1 text-xs">
        {revisions.map((revision) => (
          <li key={revision.fingerprint} className="flex items-center justify-between gap-2">
            <span className="truncate font-mono" title={revision.fingerprint}>
              {revision.fingerprint.slice(0, 12)}
              {revision.current ? ' · current' : ''}
              {revision.previous ? ' · previous' : ''}
            </span>
            <span className="flex gap-1">
              {!revision.current && onRestore && (
                <Button size="sm" variant="outline" onClick={() => onRestore(revision.fingerprint)}>
                  Restore
                </Button>
              )}
              {onPin && (
                <Button size="sm" variant="ghost" onClick={() => onPin(revision.fingerprint)}>
                  Pin
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {entry.updateHold === 'restore' && onResumeUpdates && (
        <Button size="sm" variant="outline" onClick={onResumeUpdates}>
          Resume updates
        </Button>
      )}
    </div>
  )
}

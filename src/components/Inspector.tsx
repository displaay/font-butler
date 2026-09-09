import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowLeftRight, CircleMinus, CirclePlus, FolderOpen, Link2, ListX, Loader2, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react'
import { CatalogBatchButtons, SystemBatchButtons } from '@/components/BatchActions'
import { SourceBadge, StateBadges, FormatBadges, AdobeLogo } from '@/components/Badges'
import { Badge } from '@/components/ui/badge'
import { systemFontFamily } from '@/components/FontFaceStyles'
import { GlyphGrid } from '@/components/GlyphGrid'
import { InstanceList, type InstanceActions } from '@/components/InstanceList'
import { SpecimenWorkspace } from '@/components/SpecimenWorkspace'
import { DropdownActionButton, SplitUninstallButton, type SplitUninstallExtra } from '@/components/SplitUninstallButton'
import { Button } from '@/components/ui/button'
import { usePreviewFontReady } from '@/hooks/usePreviewFontReady'
import { api } from '@/lib/api'
import { activateActionLabel, catalogBatchPlan, deleteSourcesLabel, forgetSourcesLabel } from '@/lib/batch'
import type { InspectorDensity } from '@/lib/inspector'
import { catalogInstanceRows, systemInstanceRows } from '@/lib/instances'
import { mixedFormatWarning, occupyingFormats, formatSwap, formatSwapLabel, uniqueEntryFormats } from '@/lib/formats'
import { collectionScopeLabel, displayStateLabel, familyCopyDestinations, needsLocateSource } from '@/lib/state'
import { formatBytes, formatRelativeTime } from '@/lib/utils'
import { entryHasTrackedSource, familyBadgeEntry, familyNameOf, hasTrackedSource } from '@/lib/group'
import type { CatalogBatchPlan, SystemBatchPlan } from '@/lib/batch'
import type { CatalogEntry, FamilyGroup, PreviewPreferences, ProjectSet, SystemFamilyGroup } from '@/lib/types'
import { cn } from '@/lib/utils'

const SAMPLE = 'The quick brown fox jumps over the lazy type.'

export type InspectorPaneTab = 'details' | 'tester' | 'glyphs'

export const INSPECTOR_PANE_TABS: { id: InspectorPaneTab; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'tester', label: 'Tester' },
  { id: 'glyphs', label: 'Glyphs' },
]

export function inspectorPaneTabs(hasGlyphs: boolean): InspectorPaneTab[] {
  return hasGlyphs ? ['details', 'tester', 'glyphs'] : ['details', 'tester']
}

export function Inspector({
  group,
  entry,
  statusSummary,
  selectedEntryId,
  onSelectEntry,
  instanceActions,
  systemGroup,
  busy,
  specimen,
  onSpecimenChange,
  projects,
  compareEntry,
  onInstall,
  onInstallAs,
  onReinstall,
  onRepair,
  onUninstall,
  onUninstallFormat,
  onUninstallAndRemove,
  onDeactivate,
  onActivate,
  onSwitch,
  onFormatSwap,
  onReveal,
  onUninstallSystem,
  onDeactivateSystem,
  onRevealSystem,
  onForget,
  onDeleteFiles,
  onLocateSource,
  onLinkSource,
  onInstallToAdobe,
  adobeAvailable = true,
  onResumeUpdates,
  onRestore,
  onPin,
  onOpenWithPreview,
  multiSelect,
  pane = 'details',
  onPaneChange,
  tablistId,
}: {
  group: FamilyGroup | null
  entry: CatalogEntry | null
  statusSummary: string | null
  selectedEntryId: string | null
  onSelectEntry: (entryId: string) => void
  instanceActions?: InstanceActions
  systemGroup: SystemFamilyGroup | null
  busy: boolean
  specimen?: PreviewPreferences
  onSpecimenChange?: (next: PreviewPreferences) => void
  projects?: ProjectSet[]
  compareEntry?: CatalogEntry | null
  onInstall: () => void
  onInstallAs: () => void
  onReinstall: () => void
  onRepair?: () => void
  onUninstall: () => void
  onUninstallFormat?: (format: string) => void
  onUninstallAndRemove?: () => void
  onDeactivate: () => void
  onActivate: () => void
  /** Passed only when a same-format occupying sibling exists (`canSwitchTo`). */
  onSwitch?: () => void
  onFormatSwap?: () => void
  onReveal: (which: 'source' | 'installed') => void
  onUninstallSystem: () => void
  onDeactivateSystem: () => void
  onRevealSystem: () => void
  onForget: () => void
  onDeleteFiles?: () => void
  onLocateSource?: () => void
  onLinkSource?: () => void
  onInstallToAdobe?: () => void
  adobeAvailable?: boolean
  onResumeUpdates?: () => void
  onRestore?: (fingerprint?: string) => void
  onPin?: (fingerprint: string) => void
  onOpenWithPreview?: () => void
  density?: InspectorDensity
  pane?: InspectorPaneTab
  onPaneChange?: (pane: InspectorPaneTab) => void
  tablistId?: string
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
          pane={pane}
          onPaneChange={onPaneChange}
          tablistId={tablistId}
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

  const plan = catalogBatchPlan([group], adobeAvailable)
  const mixedFormats = occupyingFormats(group.entries)
  const mixedWarning = mixedFormatWarning(mixedFormats)
  const swap = formatSwap(group.entries)
  const scope = collectionScopeLabel(entry)
  const previewOnly = Boolean(entry.previewOnly)
  const unlinked = entry.sourceAvailability === 'none' || (!entry.sourceAvailability && !entryHasTrackedSource(entry))
  const pinnedFor = (projects ?? []).filter((project) =>
    project.members.some((member) => member.assetId === entry.id && member.pinFingerprint),
  )

  const instances = catalogInstanceRows(group)
  const header = (
    <div>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold tracking-tight">{familyNameOf(entry)}</h2>
        {hasTrackedSource(group) ? <SourceBadge /> : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {group.instanceCount} {group.instanceCount === 1 ? 'instance' : 'instances'}
        {` · ${group.isVariable ? 'Variable' : 'Static'}`}
        {group.entries.length > 1 ? ` · ${group.entries.length} files` : ''}
        {statusSummary ? ` · ${statusSummary}` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <FormatBadges formats={uniqueEntryFormats(group.entries)} occupying={mixedFormats} />
        <StateBadges entry={familyBadgeEntry(group)} destinations={familyCopyDestinations(group.entries)} />
        {mixedWarning ? (
          <Badge
            tone="accent"
            title="OpenType and TrueType copies of this family are installed. Uninstall one format."
          >
            {mixedWarning}
          </Badge>
        ) : null}
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
    </>
  )
  const files = (
    <div className="space-y-2">
      <h3 className="mb-2 text-sm font-medium">Instances</h3>
      <InstanceList
        rows={instances}
        selectedEntryId={selectedEntryId}
        onSelectEntry={onSelectEntry}
        instanceActions={instanceActions}
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
  const uninstallExtras = ([
    ...(onUninstallFormat && mixedFormats.length >= 2
      ? mixedFormats.map((format) => ({
          key: `uninstall-format-${format}`,
          label: format.toUpperCase(),
          icon: <CircleMinus className="size-4 shrink-0" />,
          onSelect: () => onUninstallFormat(format),
        }))
      : []),
    hasTrackedSource(group) && onUninstallAndRemove
      ? {
          key: 'uninstall-and-delete',
          label: 'Uninstall and delete sources',
          onSelect: onUninstallAndRemove,
          separatorBefore: Boolean(onUninstallFormat && mixedFormats.length >= 2),
        }
      : null,
    onDeleteFiles && plan.deleteFiles > 0
      ? {
          key: 'delete-sources',
          label: deleteSourcesLabel(plan.deleteFiles, false),
          onSelect: onDeleteFiles,
          separatorBefore:
            Boolean(onUninstallFormat && mixedFormats.length >= 2) &&
            !(hasTrackedSource(group) && onUninstallAndRemove),
        }
      : null,
  ] as Array<SplitUninstallExtra | null>).filter(
    (item): item is SplitUninstallExtra => Boolean(item),
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
              <ListX /> {forgetSourcesLabel(1, false)}
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
              <ListX /> {forgetSourcesLabel(1, false)}
            </Button>
          </>
        ) : (
          <>
            {plan.reinstall > 0 && (
              <Button
                size="sm"
                variant="accent"
                disabled={busy}
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
              <Button size="sm" variant="success" disabled={busy} onClick={onInstall}>
                <CirclePlus /> {plan.installMissing ? 'Install missing styles' : 'Install'}
              </Button>
            )}
            {plan.activate > 0 && (
              <Button size="sm" disabled={busy} onClick={onActivate}>
                <Power /> {activateActionLabel(plan)}
              </Button>
            )}
            {swap && onFormatSwap ? (
              <Button size="sm" disabled={busy} onClick={onFormatSwap}>
                <ArrowLeftRight /> {formatSwapLabel(swap)}
              </Button>
            ) : null}
            {plan.adobeInstall > 0 && onInstallToAdobe ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={onInstallToAdobe}>
                <AdobeLogo className="size-3.5" /> Install to Adobe testing folder
              </Button>
            ) : null}
            {plan.install > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
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
              />
            )}
            {plan.uninstall === 0 && hasTrackedSource(group) && onUninstallAndRemove ? (
              <Button size="sm" variant="destructive" disabled={busy} onClick={onUninstallAndRemove}>
                <Trash2 /> Uninstall and delete sources
              </Button>
            ) : null}
            {plan.forget > 0 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={onForget}>
                <ListX /> {forgetSourcesLabel(plan.forget, false)}
              </Button>
            )}
            {plan.uninstall === 0 && onDeleteFiles && plan.deleteFiles > 0 && (
              <Button size="sm" variant="destructive" disabled={busy} onClick={onDeleteFiles}>
                <Trash2 /> {deleteSourcesLabel(plan.deleteFiles, false)}
              </Button>
            )}
            {unlinked && onLinkSource && (
              <Button size="sm" variant="outline" onClick={onLinkSource}>
                <Link2 /> Link source…
              </Button>
            )}
            {needsLocateSource(entry) && !unlinked && onLocateSource && (
              <Button size="sm" variant="outline" onClick={onLocateSource}>
                Locate source…
              </Button>
            )}
          </>
        )}
        <DropdownActionButton
          label="Show in Finder"
          items={[
            entry.installedPath || entry.disabledPath
              ? {
                  key: 'installed',
                  label: 'Installed fonts',
                  onSelect: () => onReveal('installed'),
                }
              : null,
            entryHasTrackedSource(entry)
              ? {
                  key: 'source',
                  label: 'Source fonts',
                  onSelect: () => onReveal('source'),
                }
              : null,
          ].filter((item): item is { key: string; label: string; onSelect: () => void } => Boolean(item))}
        />
      </div>
  )

  return (
    <aside className={inspectorShellClass()}>
      <InspectorLayout
        familyKey={group.key}
        header={header}
        actions={actions}
        pane={pane}
        onPaneChange={onPaneChange}
        tablistId={tablistId}
        details={
          <div className="flex flex-col gap-5">
            {notices}
            {files}
            {meta}
            {versions}
          </div>
        }
        tester={specimenBlock}
        glyphs={<GlyphGrid entry={entry} />}
      />
    </aside>
  )
}

function inspectorShellClass() {
  return 'flex h-full min-h-0 w-full flex-col overflow-hidden'
}

export function InspectorTabList({
  tabs,
  value,
  onChange,
  tablistId,
}: {
  tabs: InspectorPaneTab[]
  value: InspectorPaneTab
  onChange: (tab: InspectorPaneTab) => void
  tablistId: string
}) {
  const refs = useRef<Partial<Record<InspectorPaneTab, HTMLButtonElement | null>>>({})

  function move(event: KeyboardEvent<HTMLButtonElement>, delta: number) {
    event.preventDefault()
    const index = tabs.indexOf(value)
    const next = tabs[(index + delta + tabs.length) % tabs.length]
    onChange(next)
    queueMicrotask(() => refs.current[next]?.focus())
  }

  return (
    <div
      role="tablist"
      aria-label="Inspector sections"
      className="flex w-fit items-center gap-0.5 rounded-md border bg-background p-0.5"
    >
      {tabs.map((id) => {
        const active = value === id
        const label = INSPECTOR_PANE_TABS.find((item) => item.id === id)?.label ?? id
        return (
          <Button
            key={id}
            ref={(node) => {
              refs.current[id] = node
            }}
            type="button"
            size="sm"
            role="tab"
            id={`${tablistId}-${id}`}
            aria-selected={active}
            aria-controls={`${tablistId}-panel`}
            tabIndex={active ? 0 : -1}
            variant="ghost"
            className={cn('h-7 px-2.5', active && 'bg-muted')}
            onClick={() => onChange(id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') move(event, 1)
              if (event.key === 'ArrowLeft') move(event, -1)
            }}
          >
            {label}
          </Button>
        )
      })}
    </div>
  )
}

function InspectorLayout({
  familyKey,
  header,
  actions,
  details,
  tester,
  glyphs,
  pane = 'details',
  onPaneChange,
  tablistId: tablistIdProp,
}: {
  familyKey: string
  header: ReactNode
  actions?: ReactNode
  details: ReactNode
  tester: ReactNode
  glyphs?: ReactNode
  pane?: InspectorPaneTab
  onPaneChange?: (pane: InspectorPaneTab) => void
  tablistId?: string
}) {
  const generatedId = useId()
  const tablistId = tablistIdProp ?? generatedId
  const familyKeyRef = useRef(familyKey)

  useEffect(() => {
    if (familyKeyRef.current === familyKey) return
    familyKeyRef.current = familyKey
    onPaneChange?.('details')
  }, [familyKey, onPaneChange])

  useEffect(() => {
    if (pane === 'glyphs' && !glyphs) onPaneChange?.('details')
  }, [pane, glyphs, onPaneChange])

  const panel = pane === 'details' ? details : pane === 'tester' ? tester : glyphs
  const glyphsTab = pane === 'glyphs'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 space-y-3 border-b px-5 pt-3 pb-3">
        {header}
        {actions}
      </div>
      <div
        id={`${tablistId}-panel`}
        role="tabpanel"
        className={cn(
          'min-h-0 flex-1 p-5',
          glyphsTab
            ? 'overflow-hidden'
            : 'overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {panel}
      </div>
    </div>
  )
}

function SystemInspectorBody({
  pane,
  onPaneChange,
  tablistId,
  systemGroup,
  face,
  busy,
  onRevealSystem,
  onDeactivateSystem,
  onUninstallSystem,
}: {
  pane?: InspectorPaneTab
  onPaneChange?: (pane: InspectorPaneTab) => void
  tablistId?: string
  systemGroup: SystemFamilyGroup
  face: SystemFamilyGroup['faces'][number] | undefined
  busy: boolean
  onRevealSystem: () => void
  onDeactivateSystem: () => void
  onUninstallSystem: () => void
}) {
  const instances = useMemo(() => systemInstanceRows(systemGroup), [systemGroup])
  const previewFamily = face ? systemFontFamily(face.path) : ''
  const previewReady = usePreviewFontReady(previewFamily, face?.weight ?? 400, Boolean(face?.italic))
  const header = (
    <div>
      <h2 className="text-base font-semibold tracking-tight">{systemGroup.familyName}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {systemGroup.instanceCount} {systemGroup.instanceCount === 1 ? 'instance' : 'instances'}
        {` · ${systemGroup.isVariable ? 'Variable' : 'Static'}`}
        {systemGroup.protected ? ' · system font' : ''}
      </p>
    </div>
  )
  const preview = (
    <div className="font-preview relative min-h-[16rem] rounded-lg border bg-muted/40 p-6 text-5xl leading-tight">
      {!previewFamily || !previewReady ? (
        <div className="flex min-h-[13rem] items-center justify-center" role="status" aria-label="Loading preview">
          <Loader2 className="size-6 animate-spin text-muted-foreground/70 motion-reduce:animate-none" />
        </div>
      ) : (
        <div style={{ fontFamily: `"${previewFamily}"` }}>{SAMPLE}</div>
      )}
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
  )
  return (
    <InspectorLayout
      familyKey={systemGroup.key}
      header={header}
      actions={actions}
      pane={pane}
      onPaneChange={onPaneChange}
      tablistId={tablistId}
      details={
        <div className="flex flex-col gap-5">
          {!systemGroup.writable && (
            <p className="text-xs text-muted-foreground">
              Protected fonts stay on the Mac. Font Buttler can only remove fonts you installed.
            </p>
          )}
          {secondary}
        </div>
      }
      tester={preview}
    />
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

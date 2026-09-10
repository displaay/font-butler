import { useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { Check, ChevronDown, FolderMinus, FolderOpen, Plus } from 'lucide-react'
import { AaPreview, CyclingAaPreview } from '@/components/AaPreview'
import { FormatBadges, SourceBadge, StateBadges, VfBadge, DestinationIcons } from '@/components/Badges'
import { Badge } from '@/components/ui/badge'
import { CatalogMenuItems } from '@/components/BatchActions'
import { CatalogCardActions } from '@/components/FontCardActions'
import { catalogFontFamily } from '@/components/FontFaceStyles'
import { InstanceList } from '@/components/InstanceList'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { familyCardPlan, type CatalogBatchPlan } from '@/lib/batch'
import { applyFontDragImage } from '@/lib/dragPreview'
import { formatAddedAt } from '@/lib/dates'
import { mixedFormatWarning, occupyingFormats, uniqueEntryFormats, formatSwap } from '@/lib/formats'
import { familyBadgeEntry, familyStatusSummary, hasSourceMissing, hasTrackedSource } from '@/lib/group'
import { catalogInstanceRows } from '@/lib/instances'
import { projectContainsAll, writeFontButlerEntries } from '@/lib/projects'
import { displayStateParts, familyCopyDestinations, isNotInstalledLabel, needsLocateSource } from '@/lib/state'
import type { FamilyGroup, ProjectSet, ViewLayout } from '@/lib/types'
import { resolvedPreviewSample } from '@/lib/previewSample'
import { cn } from '@/lib/utils'

export function LibraryCard({
  group,
  layout,
  previewSize,
  showSourcePath,
  showAddedAt,
  hideDestinations = false,
  selected,
  selectedEntryId,
  busy,
  batch,
  onSelect,
  onInspect,
  onSelectEntry,
  onEnsureSelected,
  onInstall,
  onInstallAs,
  onInstallToAdobe,
  onInstallInstance,
  onActivateInstance,
  onDeactivateInstance,
  onUninstallInstance,
  onInstallInstanceToAdobe,
  onUninstallInstanceFromAdobe,
  onSwapInstanceFormat,
  adobeAvailable = true,
  onReinstall,
  onLocateSource,
  onUninstall,
  onUninstallFormat,
  onUninstallAndRemove,
  onUninstallFromAdobe,
  onDeactivate,
  onActivate,
  onSwitch,
  onFormatSwap,
  onReveal,
  onRevealSource,
  onForget,
  onDeleteFiles,
  projects,
  projectFilter,
  dragIds,
  projectFamilyNames,
  onAddToProject,
  onRemoveFromProject,
  onCreateProjectFromCard,
  onFontDragStart,
  onFontDragEnd,
}: {
  group: FamilyGroup
  layout: ViewLayout
  previewSize: number
  showSourcePath?: boolean
  showAddedAt?: boolean
  hideDestinations?: boolean
  selected: boolean
  selectedEntryId: string | null
  busy: boolean
  batch: CatalogBatchPlan | null
  onSelect: (event: MouseEvent) => void
  onInspect: () => void
  onSelectEntry: (entryId: string) => void
  onEnsureSelected: () => void
  onInstall: () => void
  onInstallAs: () => void
  onInstallToAdobe: () => void
  onInstallInstance: (entryId: string) => void
  onActivateInstance: (entryId: string) => void
  onDeactivateInstance: (entryId: string) => void
  onUninstallInstance: (entryId: string) => void
  onInstallInstanceToAdobe: (entryId: string) => void
  onUninstallInstanceFromAdobe?: (entryId: string) => void
  onSwapInstanceFormat?: (entryId: string) => void
  adobeAvailable?: boolean
  onReinstall: () => void
  onLocateSource?: () => void
  onUninstall: () => void
  onUninstallFormat: (format: string) => void
  onUninstallAndRemove: () => void
  onUninstallFromAdobe?: () => void
  onDeactivate: () => void
  onActivate: () => void
  onSwitch?: () => void
  onFormatSwap?: () => void
  onReveal: () => void
  onRevealSource: () => void
  onForget: () => void
  onDeleteFiles: () => void
  projects: ProjectSet[]
  projectFilter: string | null
  dragIds: string[]
  projectFamilyNames: string[]
  onAddToProject: (projectId: string, ids: string[]) => void
  onRemoveFromProject: (projectId: string, ids: string[]) => void
  onCreateProjectFromCard: (ids: string[], familyNames: string[]) => void
  onFontDragStart: () => void
  onFontDragEnd: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)
  const skipNextClick = useRef(false)
  const preview = group.entries.find((entry) => entry.id === group.previewEntryId) ?? group.entries[0]
  const badgeEntry = familyBadgeEntry(group)
  const mixedSummary = familyStatusSummary(group)
  const notInstalled = isNotInstalledLabel(badgeEntry)
  const deactivated = displayStateParts(badgeEntry).includes('Deactivated')
  const missingSource = hasSourceMissing(group)
  const instances = useMemo(() => catalogInstanceRows(group), [group])
  const showInstances = instances.length > 0 && layout === 'list'
  const previewFamily = catalogFontFamily(group.previewEntryId)
  const previewWeight = preview.faces[0]?.weight
  const previewItalic = preview.faces[0]?.italic
  const previewSample = resolvedPreviewSample(
    preview.previewSample,
    group.entries.find((entry) => entry.previewSample)?.previewSample,
  )
  const previewFaces = useMemo(
    () =>
      instances.map((row) => ({
        family: row.catalogEntryId ? catalogFontFamily(row.catalogEntryId) : previewFamily,
        weight: row.weight,
        italic: row.italic,
        label: row.label,
        variation: row.variation,
      })),
    [instances, previewFamily],
  )
  const plan = batch ?? familyCardPlan(group, adobeAvailable)
  const inCurrentProject = Boolean(
    projectFilter && group.entries.some((entry) =>
      projects.find((item) => item.id === projectFilter)?.members.some((member) => member.assetId === entry.id),
    ),
  )
  function handleCardClick(event: MouseEvent) {
    if (skipNextClick.current) {
      skipNextClick.current = false
      return
    }
    if (event.button !== 0) return
    onSelect(event)
  }

  function skipClickAfterContextMenu() {
    skipNextClick.current = true
    window.setTimeout(() => {
      skipNextClick.current = false
    }, 400)
  }

  function startFontDrag(event: DragEvent) {
    if (event.target instanceof Element && event.target.closest('[data-no-marquee]')) {
      event.preventDefault()
      return
    }
    writeFontButlerEntries(event.dataTransfer, dragIds)
    applyFontDragImage(event.nativeEvent, projectFamilyNames)
    onFontDragStart()
  }

  const muted = group.status === 'deactivated'
  const mixedFormats = occupyingFormats(group.entries)
  const mixedWarning = mixedFormatWarning(mixedFormats)
  const swap = formatSwap(group.entries)

  const dest = familyCopyDestinations(group.entries)
  const showDestIcons = !hideDestinations && (dest.macos || dest.adobe)
  const showSourceIcon = hasTrackedSource(group)
  const overlayDeactivated = layout === 'grid' && deactivated
  const overlayMixed = layout === 'grid' && Boolean(mixedWarning)
  const showOverlayIcons =
    layout === 'grid' && (showDestIcons || showSourceIcon || notInstalled)
  const showCorner = showOverlayIcons || overlayDeactivated || overlayMixed
  const locationBadges =
    showDestIcons || showSourceIcon ? (
      <>
        {showDestIcons ? (
          <DestinationIcons macos={dest.macos} adobe={dest.adobe} overlay />
        ) : null}
        {showSourceIcon ? <SourceBadge className="shrink-0" /> : null}
      </>
    ) : null
  const addedLabel = showAddedAt ? formatAddedAt(group.addedAt) : ''
  const identity = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate font-medium">{group.familyName}</span>
        <VfBadge show={group.isVariable} />
        <FormatBadges formats={uniqueEntryFormats(group.entries)} occupying={mixedFormats} />
        {layout === 'list' && mixedWarning ? (
          <Badge
            tone="accent"
            className="max-w-full truncate"
            title="OpenType and TrueType copies of this family are installed. Uninstall one format."
          >
            {mixedWarning}
          </Badge>
        ) : null}
        <StateBadges
          entry={badgeEntry}
          hideInstalled
          hideNotInstalled={layout === 'grid'}
          hideDeactivated
        />
        {mixedSummary ? (
          <Badge tone="muted" title={mixedSummary}>
            {mixedSummary}
          </Badge>
        ) : null}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {group.instanceCount} {group.instanceCount === 1 ? 'instance' : 'instances'}
        {group.entries.length > 1 ? ` · ${group.entries.length} files` : ''}
        {addedLabel ? ` · Added ${addedLabel}` : ''}
      </div>
      {showSourcePath && (
        <div className="mt-1 space-y-0.5">
          {group.entries.map((item) => (
            <div
              key={item.id}
              className={cn(
                'truncate font-mono text-[11px] text-muted-foreground/90',
                (item.status === 'deactivated' || item.status === 'uninstalled') && 'opacity-60',
              )}
              title={item.sourcePath}
            >
              {item.sourcePath}
            </div>
          ))}
        </div>
      )}
    </>
  )

  return (
    <ContextMenu onOpenChange={(open) => { if (open) skipClickAfterContextMenu() }}>
      <div
        data-family-key={group.familyName}
        draggable
        onDragStart={startFontDrag}
        onDragEnd={onFontDragEnd}
        className={cn(
          'group relative overflow-hidden rounded-lg border transition-colors',
            selected ? 'border-neutral-300 bg-muted/60 dark:border-zinc-600' : 'border-border/80 hover:bg-muted/40',
          muted && '[&>:not([data-no-marquee])]:opacity-50',
        )}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        {showCorner ? (
          <div
            data-no-marquee=""
            className="pointer-events-none absolute top-1.5 left-1.5 z-10 flex max-w-[calc(100%-0.75rem)] flex-col items-start gap-1"
          >
            {showOverlayIcons || overlayDeactivated ? (
              <div className="flex items-center gap-1">
                {locationBadges}
                {overlayDeactivated ? (
                  <Badge tone="muted" title="Deactivated">
                    Deactivated
                  </Badge>
                ) : null}
                {layout === 'grid' && notInstalled ? (
                  <Badge tone="muted" title="Not installed">
                    Not installed
                  </Badge>
                ) : null}
              </div>
            ) : null}
            {overlayMixed ? (
              <Badge
                tone="accent"
                className="max-w-full truncate"
                title="OpenType and TrueType copies of this family are installed. Uninstall one format."
              >
                {mixedWarning}
              </Badge>
            ) : null}
          </div>
        ) : null}
        {layout === 'grid' ? (
          <ContextMenuTrigger asChild>
            <button
              type="button"
              draggable
              onDragStart={startFontDrag}
              onClick={handleCardClick}
              onContextMenu={skipClickAfterContextMenu}
              onDoubleClick={onInspect}
              className="flex w-full flex-col text-left"
            >
              <CyclingAaPreview
                faces={previewFaces}
                rest={
                  previewFaces.find((face) => face.family === previewFamily && !face.italic) ??
                  previewFaces.find((face) => face.family === previewFamily) ?? {
                    family: previewFamily,
                    weight: previewWeight,
                    italic: previewItalic,
                    label: preview.faces[0]?.styleName ?? 'Regular',
                  }
                }
                active={hovered}
                size={previewSize}
                sample={previewSample}
              />
              <div className={previewSize < 3.25 ? 'p-2' : 'p-3'}>{identity}</div>
            </button>
          </ContextMenuTrigger>
        ) : (
          <>
            <ContextMenuTrigger asChild>
              <div className="flex items-stretch">
                <button
                  type="button"
                  draggable
                  onDragStart={startFontDrag}
                  onClick={handleCardClick}
                  onContextMenu={skipClickAfterContextMenu}
                  onDoubleClick={onInspect}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                >
                  <div className="relative shrink-0">
                    <AaPreview
                      family={previewFamily}
                      weight={previewWeight}
                      italic={previewItalic}
                      sample={previewSample}
                    />
                    {deactivated ? (
                      <Badge
                        tone="muted"
                        title="Deactivated"
                        className="absolute left-0 top-0 z-10"
                      >
                        Deactivated
                      </Badge>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">{identity}</div>
                  {locationBadges ? (
                    <span
                      className={cn(
                        'ml-auto flex shrink-0 items-center gap-1',
                        !batch &&
                          (selected
                            ? 'invisible'
                            : 'group-hover:invisible group-focus-within:invisible'),
                      )}
                    >
                      {locationBadges}
                    </span>
                  ) : null}
                </button>
                {showInstances && (
                  <button
                    type="button"
                    data-no-marquee=""
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide instances' : 'Show instances'}
                    onClick={(event) => {
                      event.stopPropagation()
                      setExpanded((value) => !value)
                    }}
                    className="flex w-10 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  >
                    <ChevronDown
                      className={cn('size-4 transition-transform', expanded && 'rotate-180')}
                    />
                  </button>
                )}
              </div>
            </ContextMenuTrigger>
            {expanded && showInstances && (
              <InstanceList
                rows={instances}
                selectedEntryId={selectedEntryId}
                onSelectEntry={onSelectEntry}
                instanceActions={{
                  entries: group.entries,
                  busy,
                  onInstall: onInstallInstance,
                  onActivate: onActivateInstance,
                  onDeactivate: onDeactivateInstance,
                  onUninstall: onUninstallInstance,
                  onInstallToAdobe: onInstallInstanceToAdobe,
                  onUninstallFromAdobe: onUninstallInstanceFromAdobe,
                  adobeAvailable,
                  onFormatSwap: onSwapInstanceFormat,
                  onOpen: (entryId) => {
                    onEnsureSelected()
                    onSelectEntry(entryId)
                  },
                }}
              />
            )}
          </>
        )}
        {!batch && (
          <CatalogCardActions
            plan={plan}
            previewOnly={group.entries.every((entry) => entry.previewOnly)}
            missingSource={missingSource}
            busy={busy}
            visible={selected}
            offset={layout === 'list' && showInstances}
            onInstall={onInstall}
            onReinstall={onReinstall}
            onDeactivate={onDeactivate}
            onUninstall={onUninstall}
            onActivate={onActivate}
            onSwitch={onSwitch}
            formatSwap={swap}
            onFormatSwap={onFormatSwap}
            onForget={onForget}
          />
        )}
      </div>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!group.entries.some((entry) => entry.installedPath || entry.disabledPath)}
          onSelect={onReveal}
        >
          <FolderOpen /> Show in Finder
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasTrackedSource(group)}
          onSelect={onRevealSource}
        >
          <FolderOpen /> Show source in Finder
        </ContextMenuItem>
        {onLocateSource && group.entries.some(needsLocateSource) ? (
          <ContextMenuItem onSelect={onLocateSource}>
            <FolderOpen /> {preview.sourceAvailability === 'none' ? 'Link source…' : 'Locate source…'}
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Add to a project</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {projects.map((project) => {
              const inProject = projectContainsAll(project, dragIds)
              return (
                <ContextMenuItem
                  key={project.id}
                  onSelect={() =>
                    inProject
                      ? onRemoveFromProject(project.id, dragIds)
                      : onAddToProject(project.id, dragIds)
                  }
                >
                  {project.name}
                  {inProject ? <Check className="ml-auto" /> : null}
                </ContextMenuItem>
              )
            })}
            {projects.length > 0 ? <ContextMenuSeparator /> : null}
            <ContextMenuItem onSelect={() => onCreateProjectFromCard(dragIds, projectFamilyNames)}>
              <Plus /> New project
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        {inCurrentProject ? (
          <ContextMenuItem
            onSelect={() => projectFilter && onRemoveFromProject(projectFilter, dragIds)}
          >
            <FolderMinus /> Remove from project
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <CatalogMenuItems
          plan={plan}
          busy={busy}
          showInstallAs={!batch}
          onInstall={onInstall}
          onInstallAs={onInstallAs}
          onInstallToAdobe={onInstallToAdobe}
          onReinstall={onReinstall}
          onDeactivate={onDeactivate}
          onUninstall={onUninstall}
          onUninstallAndRemove={onUninstallAndRemove}
          onUninstallFromAdobe={onUninstallFromAdobe}
          onActivate={onActivate}
          onSwitch={onSwitch}
          onForget={onForget}
          onDeleteFiles={onDeleteFiles}
          formatUninstalls={mixedFormats}
          onUninstallFormat={onUninstallFormat}
          formatSwap={swap}
          onFormatSwap={onFormatSwap}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

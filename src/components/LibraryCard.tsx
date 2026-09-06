import { useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import { Check, ChevronDown, FolderMinus, FolderOpen, Plus } from 'lucide-react'
import { AaPreview, CyclingAaPreview } from '@/components/AaPreview'
import { FormatBadges, SourceBadge, StateBadges, VfBadge } from '@/components/Badges'
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
import { uniqueEntryFormats } from '@/lib/formats'
import { familyBadgeEntry, familyStatusSummary, hasSourceMissing, hasTrackedSource } from '@/lib/group'
import { catalogInstanceRows } from '@/lib/instances'
import { projectContainsAll, writeFontButlerEntries } from '@/lib/projects'
import { isNotInstalledLabel, needsLocateSource } from '@/lib/state'
import type { FamilyGroup, ProjectSet, ViewLayout } from '@/lib/types'
import { cn } from '@/lib/utils'

export function LibraryCard({
  group,
  layout,
  previewSize,
  showSourcePath,
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
  onReinstall,
  onLocateSource,
  onUninstall,
  onUninstallAndRemove,
  onDeactivate,
  onActivate,
  onSwitch,
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
  onReinstall: () => void
  onLocateSource?: () => void
  onUninstall: () => void
  onUninstallAndRemove: () => void
  onDeactivate: () => void
  onActivate: () => void
  onSwitch?: () => void
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
  const preview = group.entries.find((entry) => entry.id === group.previewEntryId) ?? group.entries[0]
  const badgeEntry = familyBadgeEntry(group)
  const mixedSummary = familyStatusSummary(group)
  const notInstalled = isNotInstalledLabel(badgeEntry)
  const missingSource = hasSourceMissing(group)
  const instances = useMemo(() => catalogInstanceRows(group), [group])
  const showInstances = instances.length > 0 && layout === 'list'
  const previewFamily = catalogFontFamily(group.previewEntryId)
  const previewWeight = preview.faces[0]?.weight
  const previewItalic = preview.faces[0]?.italic
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
  const plan = batch ?? familyCardPlan(group)
  const inCurrentProject = Boolean(
    projectFilter && group.entries.some((entry) =>
      projects.find((item) => item.id === projectFilter)?.members.some((member) => member.assetId === entry.id),
    ),
  )
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

  const metadata = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate font-medium">{group.familyName}</span>
        <VfBadge show={group.isVariable} />
        <FormatBadges formats={uniqueEntryFormats(group.entries)} />
        <StateBadges entry={badgeEntry} hideInstalled hideNotInstalled />
        {mixedSummary ? (
          <Badge tone="muted" title={mixedSummary}>
            {mixedSummary}
          </Badge>
        ) : null}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {group.instanceCount} {group.instanceCount === 1 ? 'instance' : 'instances'}
        {group.entries.length > 1 ? ` · ${group.entries.length} files` : ''}
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
    <ContextMenu onOpenChange={(open) => { if (open) onEnsureSelected() }}>
      <ContextMenuTrigger asChild>
        <div
          data-family-key={group.familyName}
          draggable
          onDragStart={startFontDrag}
          onDragEnd={onFontDragEnd}
          className={cn(
            'group relative overflow-hidden rounded-lg border transition-colors',
            selected ? 'border-border bg-muted/60' : 'border-border/80 hover:bg-muted/40',
            muted && '[&>:not([data-no-marquee])]:opacity-50',
          )}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          <div className="pointer-events-none absolute top-1.5 left-1.5 z-10 flex items-center gap-1">
            {hasTrackedSource(group) ? <SourceBadge /> : null}
            {notInstalled ? (
              <Badge tone="muted" title="Not installed">
                Not installed
              </Badge>
            ) : null}
          </div>
          {layout === 'grid' ? (
            <button
              type="button"
              draggable
              onDragStart={startFontDrag}
              onClick={onSelect}
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
              />
              <div className={previewSize < 3.25 ? 'p-2' : 'p-3'}>{metadata}</div>
            </button>
          ) : (
            <>
              <div className="flex items-stretch">
                <button
                  type="button"
                  draggable
                  onDragStart={startFontDrag}
                  onClick={onSelect}
                  onDoubleClick={onInspect}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                >
                  <AaPreview
                    family={previewFamily}
                    weight={previewWeight}
                    italic={previewItalic}
                  />
                  <div className="min-w-0 flex-1">{metadata}</div>
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
              {expanded && showInstances && (
                <InstanceList
                  rows={instances}
                  selectedEntryId={selectedEntryId}
                  onSelectEntry={onSelectEntry}
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
              onForget={onForget}
            />
          )}
        </div>
      </ContextMenuTrigger>
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
          onActivate={onActivate}
          onSwitch={onSwitch}
          onForget={onForget}
          onDeleteFiles={onDeleteFiles}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

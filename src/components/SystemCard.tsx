import { useMemo, useState, type MouseEvent } from 'react'
import { ChevronDown, FolderOpen } from 'lucide-react'
import { AaPreview, CyclingAaPreview } from '@/components/AaPreview'
import { FormatBadges, VfBadge } from '@/components/Badges'
import { SystemMenuItems } from '@/components/BatchActions'
import { SystemCardActions } from '@/components/FontCardActions'
import { systemFontFamily } from '@/components/FontFaceStyles'
import { InstanceList } from '@/components/InstanceList'
import { Badge } from '@/components/ui/badge'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { systemBatchPlan, type SystemBatchPlan } from '@/lib/batch'
import { countFormats } from '@/lib/formats'
import { systemInstanceRows } from '@/lib/instances'
import type { SystemFamilyGroup, ViewLayout } from '@/lib/types'
import { cn } from '@/lib/utils'

export function SystemCard({
  group,
  layout,
  previewSize,
  showSourcePath,
  selected,
  busy,
  batch,
  onSelect,
  onInspect,
  onEnsureSelected,
  onReveal,
  onUninstall,
  onDeactivate,
}: {
  group: SystemFamilyGroup
  layout: ViewLayout
  previewSize: number
  showSourcePath?: boolean
  selected: boolean
  busy: boolean
  batch: SystemBatchPlan | null
  onSelect: (event: MouseEvent) => void
  onInspect: () => void
  onEnsureSelected: () => void
  onReveal: () => void
  onUninstall: () => void
  onDeactivate: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)
  const face = group.faces[0]
  const instances = useMemo(() => systemInstanceRows(group), [group])
  const showInstances = instances.length > 0 && layout === 'list'
  const previewFamily = systemFontFamily(face.path)
  const previewFaces = useMemo(
    () =>
      instances.map((row) => ({
        family: row.systemPath ? systemFontFamily(row.systemPath) : previewFamily,
        weight: row.weight,
        italic: row.italic,
        label: row.label,
      })),
    [instances, previewFamily],
  )
  const plan = batch ?? systemBatchPlan([group])

  const metadata = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate font-medium">{group.familyName}</span>
        <VfBadge show={group.isVariable} />
        <FormatBadges formats={countFormats(group.faces.map((item) => item.format)).map((item) => item.format)} />
        {group.protected && <Badge>System</Badge>}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {group.instanceCount} {group.instanceCount === 1 ? 'instance' : 'instances'}
      </div>
      {showSourcePath && (
        <div
          className="mt-1 truncate font-mono text-[11px] text-muted-foreground/90"
          title={face.path}
        >
          {face.path}
        </div>
      )}
    </>
  )

  return (
    <ContextMenu onOpenChange={(open) => { if (open) onEnsureSelected() }}>
      <ContextMenuTrigger asChild>
        <div
          data-family-key={group.familyName}
          className={cn(
            'group relative overflow-hidden rounded-lg border transition-colors',
            selected ? 'border-border bg-muted/60' : 'border-border/80 hover:bg-muted/40',
          )}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          {layout === 'grid' ? (
            <button
              type="button"
              onClick={onSelect}
              onDoubleClick={onInspect}
              className="flex w-full flex-col text-left"
            >
              <CyclingAaPreview
                faces={previewFaces}
                rest={{
                  family: previewFamily,
                  weight: face.weight,
                  italic: face.italic,
                  label: face.styleName,
                }}
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
                  onClick={onSelect}
                  onDoubleClick={onInspect}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                >
                  <AaPreview
                    family={previewFamily}
                    weight={face.weight}
                    italic={face.italic}
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
              {expanded && showInstances && <InstanceList rows={instances} />}
            </>
          )}
          {!batch && (
            <SystemCardActions
              writable={group.writable}
              busy={busy}
              visible={selected}
              offset={layout === 'list' && showInstances}
              onDeactivate={onDeactivate}
              onUninstall={onUninstall}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onReveal}>
          <FolderOpen /> Show in Finder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <SystemMenuItems
          plan={plan}
          busy={busy}
          onDeactivate={onDeactivate}
          onUninstall={onUninstall}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

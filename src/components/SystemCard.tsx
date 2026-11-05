import { memo, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ChevronDown, FolderOpen } from 'lucide-react'
import { AaPreview, CyclingAaPreview, PreviewRetryBoundary } from '@/components/AaPreview'
import { NameWithFormatTags } from '@/components/Badges'
import { SystemMenuItems } from '@/components/BatchActions'
import { ActivationSwitch } from '@/components/ActivationSwitch'
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
import { systemActivationSwitch } from '@/lib/activationSwitch'
import { systemBatchPlan, type SystemBatchPlan } from '@/lib/batch'
import { countFormats } from '@/lib/formats'
import { systemInstanceRows } from '@/lib/instances'
import type { SystemFamilyGroup, ViewLayout } from '@/lib/types'
import { useCardActionChrome } from '@/hooks/useCardActionChrome'
import { pendingPreviewSample } from '@/lib/previewSample'
import { cardPreviewFromRequest, previewRequestActive, type PreviewRequest } from '../../shared/library-search.ts'
import { cn } from '@/lib/utils'

export const SystemCard = memo(function SystemCard({
  group,
  layout,
  previewSize,
  showSourcePath,
  showInstanceCounts = false,
  hideFormats = false,
  selected,
  busy,
  batch,
  onSelect,
  onInspect,
  onReveal,
  onUninstall,
  onDeactivate,
  onActivateFamily,
  onDeactivateFamily,
  previewRequest = null,
}: {
  group: SystemFamilyGroup
  layout: ViewLayout
  previewSize: number
  showSourcePath?: boolean
  showInstanceCounts?: boolean
  hideFormats?: boolean
  selected: boolean
  busy: boolean
  batch: SystemBatchPlan | null
  onSelect: (event: MouseEvent) => void
  onInspect: () => void
  onReveal: () => void
  onUninstall: () => void
  onDeactivate: () => void
  /** This family only. The context menu keeps the selection-wide onDeactivate. */
  onActivateFamily: () => void
  onDeactivateFamily: () => void
  previewRequest?: PreviewRequest | null
}) {
  const [expanded, setExpanded] = useState(false)
  const { hovered, actionsVisible, onContextMenuOpenChange, cardChrome } = useCardActionChrome()
  const skipNextClick = useRef(false)
  const face = group.faces[0]
  const instances = useMemo(() => systemInstanceRows(group), [group])
  const showInstances = instances.length > 0 && layout === 'list'
  const previewFamily = systemFontFamily(face.path)
  const previewSample = pendingPreviewSample(face.previewSample)
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
  const lockedPreview = useMemo(
    () =>
      previewRequestActive(previewRequest)
        ? cardPreviewFromRequest(
            instances.map((row) => ({
              weight: row.weight,
              italic: row.italic,
              label: row.label,
              variation: row.variation,
            })),
            previewRequest,
          )
        : null,
    [instances, previewRequest],
  )
  const restPreview = lockedPreview
    ? {
        family: previewFamily,
        weight: lockedPreview.weight,
        italic: lockedPreview.italic,
        variation: lockedPreview.variation,
        label: lockedPreview.label,
      }
    : {
        family: previewFamily,
        weight: face.weight,
        italic: face.italic,
        label: face.styleName,
      }
  const plan = batch ?? systemBatchPlan([group])
  const activation = systemActivationSwitch(group)
  const muted = group.faces.length > 0 && group.faces.every((face) => face.deactivated)
  function toggleActivation() {
    if (!activation.enabled || busy) return
    if (activation.position === 'on') onDeactivateFamily()
    else onActivateFamily()
  }

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

  const metadata = (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <NameWithFormatTags
          name={group.familyName}
          isVariable={group.isVariable}
          formats={countFormats(group.faces.map((item) => item.format)).map((item) => item.format)}
          selected={selected}
          hideFormats={hideFormats}
        />
        {group.protected && <Badge>System</Badge>}
      </div>
      {showInstanceCounts ? (
        <div className="mt-0.5 text-xs text-muted-foreground">
          {group.instanceCount} {group.instanceCount === 1 ? 'instance' : 'instances'}
        </div>
      ) : null}
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
    <ContextMenu
      onOpenChange={(open) => {
        if (open) skipClickAfterContextMenu()
        onContextMenuOpenChange(open)
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          data-family-key={group.familyName}
          className={cn(
            'group relative overflow-clip rounded-lg border transition-colors',
            selected ? '!border-foreground/20 bg-muted/60' : 'border-border/80 hover:bg-muted/40',
            muted && '[&>:not([data-no-marquee]):not([data-undimmed])]:opacity-50',
          )}
          {...cardChrome}
        >
          {layout === 'grid' ? (
            <div data-undimmed="">
              <div className="flex items-start justify-end px-2.5 pt-3.5 pb-1.5">
                <ActivationSwitch
                  position={activation.position}
                  enabled={activation.enabled}
                  busy={busy}
                  help={activation.help}
                  onToggle={toggleActivation}
                />
              </div>
              <PreviewRetryBoundary>
                <button
                  type="button"
                  onClick={handleCardClick}
                  onContextMenu={skipClickAfterContextMenu}
                  onDoubleClick={onInspect}
                  className={cn('flex w-full flex-col text-left', muted && 'opacity-50')}
                >
                  <CyclingAaPreview
                    faces={lockedPreview ? [restPreview] : previewFaces}
                    rest={restPreview}
                    active={hovered && !lockedPreview}
                    size={previewSize}
                    sample={previewSample}
                    featureSettings={lockedPreview?.featureSettings}
                  />
                  <div className={previewSize < 3.25 ? 'p-2' : 'p-3'}>{metadata}</div>
                </button>
              </PreviewRetryBoundary>
            </div>
          ) : (
            <>
              <div data-undimmed="" className="flex items-stretch">
                <div className={cn('flex min-w-0 flex-1 items-stretch', muted && 'opacity-50')}>
                  <PreviewRetryBoundary>
                    <button
                      type="button"
                      onClick={handleCardClick}
                      onContextMenu={skipClickAfterContextMenu}
                      onDoubleClick={onInspect}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                    >
                      <AaPreview
                        family={previewFamily}
                        weight={lockedPreview?.weight ?? face.weight}
                        italic={lockedPreview?.italic ?? face.italic}
                        variation={lockedPreview?.variation}
                        featureSettings={lockedPreview?.featureSettings}
                        sample={previewSample}
                      />
                      <div className="min-w-0 flex-1">{metadata}</div>
                    </button>
                  </PreviewRetryBoundary>
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
                <div data-no-marquee="" className="flex items-center pr-2.5">
                  <ActivationSwitch
                    position={activation.position}
                    enabled={activation.enabled}
                    busy={busy}
                    help={activation.help}
                    onToggle={toggleActivation}
                  />
                </div>
              </div>
              {expanded && showInstances && <InstanceList rows={instances} />}
            </>
          )}
          {!batch && (
            <SystemCardActions
              writable={group.writable}
              busy={busy}
              visible={selected || actionsVisible}
              layout={layout}
              switchInset
              offset={layout === 'list' && showInstances}
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
}, (prev, next) => (
  prev.group === next.group &&
  prev.selected === next.selected &&
  prev.busy === next.busy &&
  prev.layout === next.layout &&
  prev.previewSize === next.previewSize &&
  prev.showSourcePath === next.showSourcePath &&
  prev.showInstanceCounts === next.showInstanceCounts &&
  prev.hideFormats === next.hideFormats &&
  prev.batch === next.batch
))

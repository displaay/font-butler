import { ArrowDownAZ, CalendarClock, LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { SortMode } from '@/lib/types'
import { cn } from '@/lib/utils'

export type ViewLayout = 'list' | 'grid'

export const GRID_PREVIEW_SIZE_KEY = 'font-butler-grid-preview-size'
export const GRID_PREVIEW_SIZE_MIN = 2
export const GRID_PREVIEW_SIZE_MAX = 6.5
export const GRID_PREVIEW_SIZE_DEFAULT = 4.25
export const GRID_PREVIEW_SIZE_STEP = 0.25

export function readGridPreviewSize(): number {
  const raw = localStorage.getItem(GRID_PREVIEW_SIZE_KEY)
  if (raw == null || raw === '') return GRID_PREVIEW_SIZE_DEFAULT
  const stored = Number(raw)
  if (!Number.isFinite(stored)) return GRID_PREVIEW_SIZE_DEFAULT
  const clamped = Math.min(GRID_PREVIEW_SIZE_MAX, Math.max(GRID_PREVIEW_SIZE_MIN, stored))
  return Math.round(clamped / GRID_PREVIEW_SIZE_STEP) * GRID_PREVIEW_SIZE_STEP
}

export function ViewOptions({
  layout,
  onLayoutChange,
  sortMode,
  onSortModeChange,
  showSources,
  onShowSourcesChange,
  showSourcesToggle = true,
  hideDeactivated = false,
  onHideDeactivatedChange,
  showHideDeactivated = false,
  previewSize,
  onPreviewSizeChange,
  className,
}: {
  layout: ViewLayout
  onLayoutChange: (layout: ViewLayout) => void
  sortMode: SortMode
  onSortModeChange: (mode: SortMode) => void
  showSources: boolean
  onShowSourcesChange: (value: boolean) => void
  showSourcesToggle?: boolean
  hideDeactivated?: boolean
  onHideDeactivatedChange?: (value: boolean) => void
  showHideDeactivated?: boolean
  previewSize: number
  onPreviewSizeChange: (size: number) => void
  className?: string
}) {
  return (
    <div
      data-keep-selection=""
      className={cn('flex flex-wrap items-center justify-between gap-3', className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn('h-7 gap-1.5', layout === 'list' && 'bg-muted font-medium')}
            onClick={() => onLayoutChange('list')}
            aria-label="List view"
            aria-pressed={layout === 'list'}
          >
            <List className="size-3.5 text-muted-foreground" />
            List
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn('h-7 gap-1.5', layout === 'grid' && 'bg-muted font-medium')}
            onClick={() => onLayoutChange('grid')}
            aria-label="Grid view"
            aria-pressed={layout === 'grid'}
          >
            <LayoutGrid className="size-3.5 text-muted-foreground" />
            Grid
          </Button>
        </div>
        {layout === 'grid' && (
          <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2.5">
            <span className="select-none text-[10px] leading-none text-muted-foreground" aria-hidden>
              A
            </span>
            <input
              type="range"
              min={GRID_PREVIEW_SIZE_MIN}
              max={GRID_PREVIEW_SIZE_MAX}
              step={GRID_PREVIEW_SIZE_STEP}
              value={previewSize}
              onChange={(event) => onPreviewSizeChange(Number(event.target.value))}
              aria-label="Preview size"
              className="preview-size-slider w-24"
            />
            <span className="select-none text-sm leading-none text-muted-foreground" aria-hidden>
              A
            </span>
          </label>
        )}
        <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn('h-7 gap-1.5', sortMode === 'name' && 'bg-muted font-medium')}
            onClick={() => onSortModeChange('name')}
            aria-label="Sort alphabetically"
            aria-pressed={sortMode === 'name'}
          >
            <ArrowDownAZ className="size-3.5 text-muted-foreground" />
            A–Z
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn('h-7 gap-1.5', sortMode === 'installed' && 'bg-muted font-medium')}
            onClick={() => onSortModeChange('installed')}
            aria-label="Sort by date of installation"
            aria-pressed={sortMode === 'installed'}
          >
            <CalendarClock className="size-3.5 text-muted-foreground" />
            Installed
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {showHideDeactivated && (
          <Label className="flex cursor-pointer items-center gap-2 font-normal text-foreground">
            <input
              type="checkbox"
              checked={hideDeactivated}
              onChange={(event) => onHideDeactivatedChange?.(event.target.checked)}
              className="size-3.5 rounded border border-input accent-primary"
            />
            Hide deactivated
          </Label>
        )}
        {showSourcesToggle && (
          <Label className="flex cursor-pointer items-center gap-2 font-normal text-foreground">
            <input
              type="checkbox"
              checked={showSources}
              onChange={(event) => onShowSourcesChange(event.target.checked)}
              className="size-3.5 rounded border border-input accent-primary"
            />
            Show sources
          </Label>
        )}
      </div>
    </div>
  )
}

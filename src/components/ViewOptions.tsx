import { LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export type ViewLayout = 'list' | 'grid'

export function ViewOptions({
  layout,
  onLayoutChange,
  showSources,
  onShowSourcesChange,
  showSourcesToggle = true,
  className,
}: {
  layout: ViewLayout
  onLayoutChange: (layout: ViewLayout) => void
  showSources: boolean
  onShowSourcesChange: (value: boolean) => void
  showSourcesToggle?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="flex items-center gap-1 rounded-lg border bg-card/60 p-0.5">
        <Button
          type="button"
          size="sm"
          variant={layout === 'list' ? 'default' : 'ghost'}
          className="h-8 gap-1.5"
          onClick={() => onLayoutChange('list')}
          aria-label="List view"
          aria-pressed={layout === 'list'}
        >
          <List className="size-4" />
          List
        </Button>
        <Button
          type="button"
          size="sm"
          variant={layout === 'grid' ? 'default' : 'ghost'}
          className="h-8 gap-1.5"
          onClick={() => onLayoutChange('grid')}
          aria-label="Grid view"
          aria-pressed={layout === 'grid'}
        >
          <LayoutGrid className="size-4" />
          Grid
        </Button>
      </div>
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
  )
}

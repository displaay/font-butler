import { AaPreview } from '@/components/AaPreview'
import { catalogFontFamily, systemFontFamily } from '@/components/FontFaceStyles'
import type { InstanceRow } from '@/lib/instances'
import { cn } from '@/lib/utils'

export function InstanceList({
  rows,
  selectedEntryId,
  onSelectEntry,
}: {
  rows: InstanceRow[]
  selectedEntryId?: string | null
  onSelectEntry?: (entryId: string) => void
}) {
  return (
    <ul className="space-y-1 border-t px-3 py-2">
      {rows.map((row) => {
        const family = row.catalogEntryId
          ? catalogFontFamily(row.catalogEntryId)
          : row.systemPath
            ? systemFontFamily(row.systemPath)
            : 'ui-sans-serif'
        const selected = row.catalogEntryId && row.catalogEntryId === selectedEntryId
        const clickable = Boolean(row.catalogEntryId && onSelectEntry)
        return (
          <li key={row.key}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => row.catalogEntryId && onSelectEntry?.(row.catalogEntryId)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 ease-out motion-reduce:transition-none',
                clickable && 'hover:bg-muted/80',
                selected && 'bg-muted ring-1 ring-primary/30',
                !clickable && 'cursor-default',
              )}
            >
              <AaPreview
                size="sm"
                family={family}
                weight={row.weight}
                italic={row.italic}
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{row.label}</div>
                {row.sublabel && (
                  <div className="truncate text-xs text-muted-foreground">{row.sublabel}</div>
                )}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

import { AaPreview } from '@/components/AaPreview'
import { catalogFontFamily, systemFontFamily } from '@/components/FontFaceStyles'
import type { InstanceRow } from '@/lib/instances'

export function InstanceList({ rows }: { rows: InstanceRow[] }) {
  return (
    <ul className="space-y-1 border-t px-3 py-2">
      {rows.map((row) => {
        const family = row.catalogEntryId
          ? catalogFontFamily(row.catalogEntryId)
          : row.systemPath
            ? systemFontFamily(row.systemPath)
            : 'ui-sans-serif'
        return (
          <li
            key={row.key}
            className="flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5"
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
          </li>
        )
      })}
    </ul>
  )
}

import { CloudDownload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RetailSyncStatus } from '@/lib/types'

/**
 * The retail collection's place on the Updates tab.
 *
 * Sits next to `AppUpdateCard` because it is the same shape of thing: something newer exists on a
 * server, nothing local has changed yet, and it takes an explicit action to pull it down. Fonts that
 * were already synced and then regenerated do not appear here — those become `outdated` catalog
 * entries and show up in the normal update list instead.
 */
export function RetailUpdateCard({
  status,
  busy = false,
  onSync,
  onOpenSettings,
}: {
  status: RetailSyncStatus
  busy?: boolean
  onSync?: () => void
  onOpenSettings?: () => void
}) {
  const count = status.pending

  return (
    <div className="rounded-lg border px-3 py-2" data-retail-update={count > 0 ? 'available' : 'current'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <CloudDownload className="size-4 shrink-0" aria-hidden />
            {count === 1
              ? '1 retail font has a newer version'
              : `${count} retail fonts have newer versions`}
          </div>
          <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
            {status.checkedAt
              ? `The DISPLAAY collection changed since the last sync. Last checked ${new Date(
                  status.checkedAt,
                ).toLocaleString()}.`
              : 'The DISPLAAY collection changed since the last sync.'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {onOpenSettings ? (
            <Button type="button" size="sm" variant="outline" onClick={onOpenSettings}>
              Settings
            </Button>
          ) : null}
          {onSync ? (
            <Button type="button" size="sm" disabled={busy} onClick={onSync}>
              {busy ? 'Syncing…' : 'Sync'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

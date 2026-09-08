import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  APP_UPDATE_GITHUB_RELEASES_URL,
  openAppUpdateUrl,
  type AppUpdateStatus,
} from '@/lib/app-update'
import { formatBytes } from '@/lib/utils'

export function AppUpdateCard({
  status,
  checking = false,
  onCheck,
  compact = false,
}: {
  status: AppUpdateStatus | null
  checking?: boolean
  onCheck?: () => void
  compact?: boolean
}) {
  const updateAvailable = Boolean(status?.updateAvailable)
  const releaseUrl = status?.htmlUrl || APP_UPDATE_GITHUB_RELEASES_URL
  const asset = status?.preferredAsset

  return (
    <div
      className={
        compact
          ? 'rounded-lg border px-3 py-2'
          : 'rounded-lg border bg-muted/30 px-3 py-3'
      }
      data-app-update={updateAvailable ? 'available' : 'current'}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {updateAvailable
              ? `Font Buttler ${status?.latestVersion} is available`
              : status?.error
                ? 'Could not check for updates'
                : 'Font Buttler is up to date'}
          </div>
          <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
            {status
              ? `This Mac is running ${status.currentVersion}. Downloads stay manual until Apple signing lands.`
              : 'Check GitHub Releases for a newer build.'}
            {status?.error ? ` ${status.error}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {onCheck ? (
            <Button type="button" size="sm" variant="outline" disabled={checking} onClick={onCheck}>
              {checking ? 'Checking…' : 'Check for updates'}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={updateAvailable ? 'default' : 'outline'}
            onClick={() => void openAppUpdateUrl(releaseUrl)}
          >
            <ExternalLink />
            Open on GitHub
          </Button>
        </div>
      </div>
      {updateAvailable && status?.releaseNotes ? (
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-background px-3 py-2 text-xs leading-5">
          {status.releaseNotes}
        </pre>
      ) : null}
      {updateAvailable && asset ? (
        <p className="mt-2 text-xs text-muted-foreground">
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            onClick={() => void openAppUpdateUrl(asset.url)}
          >
            {asset.name}
          </button>
          {typeof asset.size === 'number' ? ` · ${formatBytes(asset.size)}` : ''}
        </p>
      ) : null}
    </div>
  )
}

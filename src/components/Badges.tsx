import { Link2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatLabel, normalizeFormat } from '@/lib/formats'
import { displayStateParts } from '@/lib/state'
import type { CatalogEntry, FontStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

export function FormatBadge({ format }: { format: string }) {
  const value = normalizeFormat(format)
  if (!value) return null
  return (
    <Badge
      tone="ink"
      title={formatLabel(value)}
      className="h-4 min-w-6 justify-center px-1 tracking-normal"
    >
      {value.toUpperCase()}
    </Badge>
  )
}

export function FormatBadges({ formats }: { formats: string[] }) {
  return (
    <>
      {formats.map((format) => (
        <FormatBadge key={format} format={format} />
      ))}
    </>
  )
}

export function VfBadge({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <Badge tone="ink" className="h-4 min-w-6 justify-center px-1 tracking-normal">
      VF
    </Badge>
  )
}

export function StatusBadge({ status }: { status: FontStatus }) {
  if (status === 'outdated') return <Badge tone="warn">Update available</Badge>
  if (status === 'deactivated') return <Badge>Deactivated</Badge>
  if (status === 'source-missing') return <Badge tone="accent">Source missing</Badge>
  if (status === 'uninstalled') return <Badge>Not installed</Badge>
  return null
}

export function StateBadges({
  entry,
  hideInstalled = false,
  hideNotInstalled = false,
}: {
  entry: CatalogEntry
  hideInstalled?: boolean
  hideNotInstalled?: boolean
}) {
  const parts = displayStateParts(entry).filter((part) => {
    if (
      hideInstalled &&
      (part === 'Installed' ||
        part === 'This Mac and Adobe testing folder' ||
        part === 'Adobe testing folder')
    ) {
      return false
    }
    if (hideNotInstalled && part === 'Not installed') return false
    return true
  })
  if (parts.length === 0) return null
  return (
    <>
      {parts.map((part) => {
        const warn = part.includes('Update') || part.includes('Review') || part.includes('paused')
        const accent =
          part.includes('missing') ||
          part.includes('offline') ||
          part.includes('unreadable') ||
          part.includes('Preview')
        return (
          <Badge key={part} tone={warn ? 'warn' : accent ? 'accent' : 'muted'} title={part}>
            {part}
          </Badge>
        )
      })}
    </>
  )
}

export function SourceBadge({ className }: { className?: string }) {
  return (
    <span
      title="Source file on disk"
      aria-label="Source file on disk"
      className={cn(
        'inline-flex size-5 items-center justify-center rounded-md bg-background/85 text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] backdrop-blur-sm',
        className,
      )}
    >
      <Link2 className="size-3" />
    </span>
  )
}

import type { SVGProps } from 'react'
import { Link2, Monitor } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatLabel, normalizeFormat } from '@/lib/formats'
import {
  displayStateParts,
  instanceInstallLabel,
  type CopyDestinations,
  type InstanceInstallState,
} from '@/lib/state'
import type { CatalogEntry, FontStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const overlayChipClassName =
  'inline-flex size-5 items-center justify-center rounded-md bg-background/85 text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] backdrop-blur-sm'

export function AdobeLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...props}>
      <path
        fill="currentColor"
        d="M13.966 22.624 12.276 18.343H8.122l3.892-9.144 5.662 13.425zM8.884 1.376H0v21.248zm15.116 0h-8.884L24 22.624z"
      />
    </svg>
  )
}

export function DestinationIcons({
  macos = false,
  adobe = false,
  overlay = false,
  className,
}: CopyDestinations & { overlay?: boolean; className?: string }) {
  if (!macos && !adobe) return null
  const chip = overlay ? overlayChipClassName : 'inline-flex text-current'
  return (
    <span className={cn('inline-flex items-center', overlay ? 'gap-1' : 'gap-0.5', className)}>
      {macos ? (
        <span title="This computer" className={chip}>
          <Monitor className="size-3" />
        </span>
      ) : null}
      {adobe ? (
        <span title="Adobe testing folder" className={chip}>
          <AdobeLogo className="size-3" />
        </span>
      ) : null}
    </span>
  )
}

export function FormatBadge({ format, inactive = false }: { format: string; inactive?: boolean }) {
  const value = normalizeFormat(format)
  if (!value) return null
  return (
    <Badge
      tone="muted"
      title={inactive ? `${formatLabel(value)} · not installed` : formatLabel(value)}
      className={inactive ? 'bg-muted/35 font-normal text-muted-foreground/40' : undefined}
    >
      {value.toUpperCase()}
    </Badge>
  )
}

export function FormatBadges({
  formats,
  occupying,
}: {
  formats: string[]
  occupying?: string[]
}) {
  const live = occupying && occupying.length > 0 ? new Set(occupying) : null
  return (
    <>
      {formats.map((format) => (
        <FormatBadge
          key={format}
          format={format}
          inactive={Boolean(live && !live.has(format))}
        />
      ))}
    </>
  )
}

export function VfBadge({ show }: { show: boolean }) {
  if (!show) return null
  return <Badge>VF</Badge>
}

export function StatusBadge({ status }: { status: FontStatus }) {
  if (status === 'outdated') return <Badge tone="warn">Update available</Badge>
  if (status === 'deactivated') return <Badge>Deactivated</Badge>
  if (status === 'source-missing') return <Badge tone="accent">Source missing</Badge>
  if (status === 'uninstalled') return <Badge>Not installed</Badge>
  return null
}

export function InstanceInstallBadge({ state }: { state: InstanceInstallState }) {
  const tone = state === 'uninstalled' ? 'accent' : 'muted'
  const label = instanceInstallLabel(state)
  return (
    <Badge tone={tone} title={label} className="shrink-0">
      {label}
    </Badge>
  )
}

export function StateBadges({
  entry,
  destinations,
  hideInstalled = false,
  hideNotInstalled = false,
}: {
  entry: CatalogEntry
  destinations?: CopyDestinations
  hideInstalled?: boolean
  hideNotInstalled?: boolean
}) {
  const parts = displayStateParts(entry).filter((part) => {
    if (hideInstalled && part === 'Installed') return false
    if (hideNotInstalled && part === 'Not installed') return false
    return true
  })
  if (parts.length === 0) return null
  return (
    <>
      {parts.map((part) => {
        const warn = part.includes('Update') || part.includes('Review') || part.includes('paused')
        const accent =
          part === 'Not installed' ||
          part.includes('missing') ||
          part.includes('offline') ||
          part.includes('unreadable') ||
          part.includes('Preview')
        const showDest = Boolean(destinations) && part === 'Installed'
        return (
          <Badge
            key={part}
            tone={warn ? 'warn' : accent ? 'accent' : 'muted'}
            title={part}
            className={showDest ? 'gap-1' : undefined}
          >
            {part}
            {showDest && destinations ? <DestinationIcons {...destinations} /> : null}
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
      className={cn(overlayChipClassName, className)}
    >
      <Link2 className="size-3" />
    </span>
  )
}

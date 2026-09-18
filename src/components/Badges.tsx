import type { SVGProps } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Link2, Monitor } from 'lucide-react'
import { DisplaayMark } from '@/components/DisplaayMark'
import { Badge } from '@/components/ui/badge'
import { formatLabel, normalizeFormat } from '@/lib/formats'
import {
  displayStateParts,
  instanceInstallLabel,
  type CopyDestinations,
  type InstanceInstallState,
} from '@/lib/state'
import type { CatalogEntry } from '@/lib/types'
import { cn } from '@/lib/utils'

const overlayChipClassName =
  'inline-flex size-5 items-center justify-center rounded-md bg-background text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]'

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
        <span title="Adobe folder" className={chip}>
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

/** Name + VF/TTF/OTF on one row. Long names run under the tags instead of wrapping them. */
export function NameWithFormatTags({
  name,
  isVariable,
  formats,
  occupying,
  selected = false,
  hideFormats = false,
}: {
  name: string
  isVariable: boolean
  formats: string[]
  occupying?: string[]
  selected?: boolean
  hideFormats?: boolean
}) {
  const tags = (
    <>
      <VfBadge show={isVariable} />
      {hideFormats ? null : <FormatBadges formats={formats} occupying={occupying} />}
    </>
  )
  const boxRef = useRef<HTMLDivElement>(null)
  const [covering, setCovering] = useState(false)
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    let cancelled = false
    const check = () => {
      if (!cancelled) setCovering(box.scrollWidth > box.clientWidth + 1)
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(box)
    // UI font loads after first paint can widen the name; re-check once it settles.
    document.fonts?.ready.then(check).catch(() => {})
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [name, isVariable, hideFormats, formats.join(','), occupying?.join(',')])
  if (!isVariable && (hideFormats || formats.length === 0)) {
    return (
      <span className="truncate font-medium" title={name}>
        {name}
      </span>
    )
  }
  const wash = selected ? 'bg-muted/60' : 'group-hover:bg-muted/40'
  const fadeWash = selected
    ? 'bg-gradient-to-r from-muted/0 to-muted/60'
    : 'bg-gradient-to-r from-muted/0 to-muted/40 opacity-0 group-hover:opacity-100'
  const fadeClass = covering ? 'w-12' : 'w-1.5'
  return (
    <div ref={boxRef} className="relative inline-flex min-w-0 max-w-full overflow-hidden" title={name}>
      <span className="whitespace-nowrap font-medium">{name}</span>
      <span className="invisible flex shrink-0 items-center gap-1 pl-1.5" aria-hidden>
        {tags}
      </span>
      <span className="absolute inset-y-0 right-0 z-10 flex items-center">
        <span className={cn('relative h-full shrink-0', fadeClass)} aria-hidden>
          <span className="absolute inset-0 bg-gradient-to-r from-background/0 to-background" />
          <span className={cn('absolute inset-0', fadeWash)} />
        </span>
        <span className="relative flex items-center gap-1">
          <span className="pointer-events-none absolute inset-0 bg-background" aria-hidden />
          <span className={cn('pointer-events-none absolute inset-0', wash)} aria-hidden />
          <span className="relative flex items-center gap-1">{tags}</span>
        </span>
      </span>
    </div>
  )
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
  hideDeactivated = false,
}: {
  entry: CatalogEntry
  destinations?: CopyDestinations
  hideInstalled?: boolean
  hideNotInstalled?: boolean
  hideDeactivated?: boolean
}) {
  const parts = displayStateParts(entry).filter((part) => {
    if (hideInstalled && part === 'Installed') return false
    if (hideNotInstalled && part === 'Not installed') return false
    if (hideDeactivated && part === 'Deactivated') return false
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

export function RetailBadge({ className }: { className?: string }) {
  return (
    <span
      title="Displaay retail"
      aria-label="Displaay retail"
      className={cn(overlayChipClassName, className)}
    >
      <DisplaayMark className="size-3" />
    </span>
  )
}

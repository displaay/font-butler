import { Link2, Unlink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { FontStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

export function VfBadge({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <Badge tone="ink" className="h-4 min-w-6 justify-center px-1 tracking-normal">
      VF
    </Badge>
  )
}

export function StatusBadge({ status }: { status: FontStatus }) {
  if (status === 'outdated') return <Badge tone="warn">Updated source</Badge>
  if (status === 'deactivated') return <Badge>Off</Badge>
  if (status === 'source-missing') return <Badge tone="accent">Source missing</Badge>
  if (status === 'uninstalled') return <Badge>Not installed</Badge>
  return null
}

export function SourceBadge({
  present,
  showMissing = false,
  className,
}: {
  present: boolean
  showMissing?: boolean
  className?: string
}) {
  if (present) {
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
  if (showMissing) {
    return (
      <span
        title="Source file missing"
        aria-label="Source file missing"
        className={cn(
          'inline-flex size-5 items-center justify-center rounded-md bg-background/85 text-red-700 shadow-[inset_0_0_0_1px_var(--border)] backdrop-blur-sm dark:text-red-400',
          className,
        )}
      >
        <Unlink className="size-3" />
      </span>
    )
  }
  return null
}

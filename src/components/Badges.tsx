import { Badge } from '@/components/ui/badge'
import type { FontStatus } from '@/lib/types'

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

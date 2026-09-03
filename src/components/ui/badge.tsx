import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function Badge({
  className,
  tone = 'muted',
  ...props
}: ComponentProps<'span'> & { tone?: 'muted' | 'accent' | 'ink' | 'warn' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        tone === 'accent' && 'bg-accent text-accent-foreground',
        tone === 'ink' && 'bg-primary text-primary-foreground',
        tone === 'warn' && 'bg-amber-100 text-amber-800',
        className,
      )}
      {...props}
    />
  )
}

export { Badge }

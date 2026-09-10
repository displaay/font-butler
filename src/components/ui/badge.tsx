import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function Badge({
  className,
  tone = 'muted',
  ...props
}: ComponentProps<'span'> & { tone?: 'muted' | 'accent' | 'ink' | 'info' | 'warn' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        tone === 'accent' && 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
        tone === 'ink' && 'bg-muted text-foreground',
        tone === 'info' && 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
        tone === 'warn' && 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-400',
        className,
      )}
      {...props}
    />
  )
}

export { Badge }

import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function Slider({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="range"
      data-slot="slider"
      className={cn(
        'preview-size-slider w-full cursor-pointer rounded-full outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/30',
        className,
      )}
      {...props}
    />
  )
}

export { Slider }

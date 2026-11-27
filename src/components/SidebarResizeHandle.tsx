import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'

export function SidebarResizeHandle({
  width,
  dragging,
  min,
  max,
  onPointerDown,
  onDoubleClick,
  onKeyDown,
}: {
  width: number
  dragging: boolean
  min: number
  max: number
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      className={cn(
        // Sit fully outside the column. The overlay scrollbar is 8px on the inner edge;
        // this 8px strip starts at the border and only covers the main panel's left padding.
        'group absolute inset-y-0 -right-2 z-30 hidden w-2 cursor-col-resize touch-none select-none md:block',
        'focus-visible:outline-none',
      )}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        event.preventDefault()
        onDoubleClick()
      }}
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-px transition-colors',
          dragging ? 'bg-foreground/70' : 'bg-transparent group-hover:bg-foreground/35',
        )}
      />
    </div>
  )
}

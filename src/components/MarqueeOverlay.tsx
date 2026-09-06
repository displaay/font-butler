import type { Rect } from '@/lib/selection'

export function MarqueeOverlay({ rect }: { rect: Rect | null }) {
  if (!rect) return null
  return (
    <div
      className="pointer-events-none fixed z-50 border border-foreground/30 bg-foreground/10"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
      }}
    />
  )
}

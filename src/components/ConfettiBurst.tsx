import { useEffect, useRef, useState } from 'react'
import { burstConfetti, prefersReducedMotion } from '@/lib/confettiBurst'

/**
 * Full-window canvas confetti overlay for the main app (not nested in a modal).
 * Bumps `playKey` to trigger a burst; respects prefers-reduced-motion.
 */
export function ConfettiBurst({
  playKey,
  onDone,
}: {
  playKey: number | null
  onDone?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (playKey == null) return
    const canvas = canvasRef.current
    if (!canvas) return
    if (prefersReducedMotion()) {
      onDone?.()
      return
    }
    let cancelled = false
    setVisible(true)
    void burstConfetti({ canvas, reducedMotion: false }).then(() => {
      if (cancelled) return
      setVisible(false)
      onDone?.()
    })
    return () => {
      cancelled = true
    }
  }, [playKey, onDone])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[100]"
      hidden={!visible}
      width={1}
      height={1}
    />
  )
}

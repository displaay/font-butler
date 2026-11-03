/** Lightweight canvas confetti (no dependency). Honors reduced motion. */

export type ConfettiBurstOptions = {
  canvas: HTMLCanvasElement
  reducedMotion?: boolean
  durationMs?: number
}

const COLORS = ['#171717', '#737373', '#a1a1aa', '#8ad7ff', '#ffd29a', '#c7b6ff']

export function prefersReducedMotion(media?: MediaQueryList | null): boolean {
  if (media) return media.matches
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function burstConfetti(options: ConfettiBurstOptions): Promise<void> {
  const { canvas, durationMs = 900 } = options
  const reduced =
    options.reducedMotion === true ||
    (options.reducedMotion !== false && prefersReducedMotion())
  if (reduced) return Promise.resolve()

  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve()

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const width = () => (typeof window !== 'undefined' ? window.innerWidth : canvas.clientWidth || 1)
  const height = () =>
    typeof window !== 'undefined' ? window.innerHeight : canvas.clientHeight || 1

  const resize = () => {
    const w = width()
    const h = height()
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()

  const pieces = Array.from({ length: 90 }, () => ({
    x: Math.random() * width(),
    y: -20 - Math.random() * height() * 0.35,
    w: 4 + Math.random() * 6,
    h: 6 + Math.random() * 8,
    vx: -2 + Math.random() * 4,
    vy: 2 + Math.random() * 3.5,
    rot: Math.random() * Math.PI,
    vr: -0.2 + Math.random() * 0.4,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
  }))

  return new Promise((resolve) => {
    const started = performance.now()
    function frame(now: number) {
      const elapsed = now - started
      const w = width()
      const h = height()
      ctx.clearRect(0, 0, w, h)
      for (const piece of pieces) {
        piece.x += piece.vx
        piece.y += piece.vy
        piece.vy += 0.04
        piece.rot += piece.vr
        ctx.save()
        ctx.translate(piece.x, piece.y)
        ctx.rotate(piece.rot)
        ctx.fillStyle = piece.color
        ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h)
        ctx.restore()
      }
      if (elapsed < durationMs) {
        requestAnimationFrame(frame)
      } else {
        ctx.clearRect(0, 0, w, h)
        resolve()
      }
    }
    requestAnimationFrame(frame)
  })
}

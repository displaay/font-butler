import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Loader2 } from 'lucide-react'
import { usePreviewFontStatus } from '@/hooks/usePreviewFontReady'
import { paintedPreviewIndices } from '@/lib/cyclingPreview'
import { fitPreviewTransform } from '@/lib/fitPreview'
import { facesSupportVariationInterpolation } from '@/lib/variationInterpolation'
import { applyLatinPreviewSample, DEFAULT_LATIN_PREVIEW_TEXT } from '@/lib/latinPreview'
import { cn } from '@/lib/utils'

const previewPaintClass = 'isolate contain-paint [transform:translateZ(0)]'

const LatinPreviewContext = createContext(DEFAULT_LATIN_PREVIEW_TEXT)

export function LatinPreviewProvider({
  text,
  children,
}: {
  text: string
  children: ReactNode
}) {
  return <LatinPreviewContext.Provider value={text}>{children}</LatinPreviewContext.Provider>
}

const CYCLE_MS = 600

export type PreviewFace = {
  family: string
  weight?: number
  italic?: boolean
  label: string
  variation?: string
  wait?: boolean
}

function useHoverCycle(length: number, active: boolean, restIndex: number) {
  const [index, setIndex] = useState(restIndex)

  useEffect(() => {
    if (!active || length <= 1) {
      setIndex(restIndex)
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setIndex(restIndex)
      return
    }
    setIndex((restIndex + 1) % length)
    const id = window.setInterval(() => {
      setIndex((value) => (value + 1) % length)
    }, CYCLE_MS)
    return () => window.clearInterval(id)
  }, [active, length, restIndex])

  return index
}

function previewBoxClass(size: 'sm' | 'md') {
  return size === 'sm'
    ? 'size-8 overflow-hidden text-[17px] rounded-md'
    : 'size-11 overflow-hidden text-[24px] rounded-md'
}

function retryControlClass(compact: boolean) {
  return cn(
    'rounded-sm bg-background font-medium text-foreground shadow-[inset_0_0_0_1px_var(--border)]',
    compact ? 'px-1 py-px text-[10px] leading-none' : 'px-1.5 py-0.5 text-xs',
  )
}

type RetrySlot = {
  id: string
  compact: boolean
  retry: () => void
  getAnchor: () => HTMLElement | null
}

type PreviewRetryHost = {
  register: (slot: RetrySlot) => () => void
}

const PreviewRetryContext = createContext<PreviewRetryHost | null>(null)

function positionedAncestor(node: HTMLElement): HTMLElement | null {
  const offset = node.offsetParent as HTMLElement | null
  if (offset) return offset
  return node.parentElement
}

function cardButtonForRetry(retry: HTMLElement): HTMLButtonElement | null {
  const parent = retry.parentElement
  if (!parent) return null
  const buttons = parent.querySelectorAll(':scope > button')
  for (let index = 0; index < buttons.length; index += 1) {
    const button = buttons[index]
    if (button && button !== retry && !button.hasAttribute('data-preview-retry')) {
      return button as HTMLButtonElement
    }
  }
  return null
}

function PreviewRetryButton({ slot }: { slot: RetrySlot }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const fromKey = useRef(false)
  const focused = useRef(false)
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const button = buttonRef.current
    return () => {
      if (!focused.current || !button) return
      cardButtonForRetry(button)?.focus()
    }
  }, [])

  useLayoutEffect(() => {
    function place() {
      const anchor = slot.getAnchor()
      const button = buttonRef.current
      if (!anchor || !button) return
      const parent = positionedAncestor(button)
      if (!parent) return
      const anchorRect = anchor.getBoundingClientRect()
      const parentRect = parent.getBoundingClientRect()
      const next = {
        top: anchorRect.top - parentRect.top - parent.clientTop + parent.scrollTop,
        left: anchorRect.left - parentRect.left - parent.clientLeft + parent.scrollLeft,
        width: anchorRect.width,
        height: anchorRect.height,
      }
      setBox((current) =>
        current &&
        current.top === next.top &&
        current.left === next.left &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next,
      )
    }

    place()
    if (typeof ResizeObserver === 'undefined') return
    const anchor = slot.getAnchor()
    const parent = buttonRef.current ? positionedAncestor(buttonRef.current) : null
    const observer = new ResizeObserver(place)
    if (anchor) observer.observe(anchor)
    if (parent) observer.observe(parent)
    return () => observer.disconnect()
  }, [slot])

  function activate(event: { preventDefault(): void; stopPropagation(): void }) {
    event.preventDefault()
    event.stopPropagation()
    slot.retry()
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      data-preview-retry=""
      className={cn(retryControlClass(slot.compact), 'absolute z-10', box ? undefined : 'invisible')}
      style={box ?? undefined}
      draggable
      onDragStart={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        if (buttonRef.current?.isConnected) focused.current = false
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        if (document.activeElement === buttonRef.current) focused.current = true
        fromKey.current = true
        activate(event)
        queueMicrotask(() => {
          fromKey.current = false
        })
      }}
      onClick={(event) => {
        if (fromKey.current) {
          fromKey.current = false
          event.preventDefault()
          event.stopPropagation()
          return
        }
        activate(event)
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      Retry
    </button>
  )
}

/** Lifts Retry out of a card `<button>` and paints it as the next sibling. */
export function PreviewRetryBoundary({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<RetrySlot | null>(null)
  const register = useCallback((next: RetrySlot) => {
    setSlot(next)
    return () => {
      setSlot((current) => (current === next ? null : current))
    }
  }, [])
  const host = useMemo(() => ({ register }), [register])

  return (
    <PreviewRetryContext.Provider value={host}>
      {children}
      {slot ? <PreviewRetryButton slot={slot} /> : null}
    </PreviewRetryContext.Provider>
  )
}

export function PreviewLoadError({
  onRetry,
  compact = false,
  showRetry = true,
}: {
  onRetry: () => void
  compact?: boolean
  /** Hidden cycling layers omit Retry so it is not focusable inside aria-hidden. */
  showRetry?: boolean
}) {
  const host = useContext(PreviewRetryContext)
  const lift = Boolean(host) && showRetry
  const anchorRef = useRef<HTMLSpanElement>(null)
  const onRetryRef = useRef(onRetry)
  const id = useId()

  useLayoutEffect(() => {
    onRetryRef.current = onRetry
  })

  useLayoutEffect(() => {
    if (!lift || !host) return
    return host.register({
      id,
      compact,
      getAnchor: () => anchorRef.current,
      retry: () => onRetryRef.current(),
    })
  }, [lift, host, id, compact])

  return (
    <span
      className={cn(
        'inline-flex max-w-full flex-col items-center justify-center text-center',
        previewPaintClass,
        compact ? 'gap-px' : 'gap-1',
      )}
      role="alert"
    >
      <span
        className={cn(
          'leading-none',
          compact ? 'text-[10px] text-destructive' : 'text-xs text-muted-foreground',
        )}
      >
        {compact ? 'Failed' : 'Preview failed'}
      </span>
      {showRetry && lift ? (
        <span
          ref={anchorRef}
          data-preview-retry-spacer=""
          aria-hidden="true"
          className={cn(retryControlClass(compact), 'invisible')}
        >
          Retry
        </span>
      ) : null}
      {showRetry && !lift ? (
        <button
          type="button"
          className={retryControlClass(compact)}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRetry()
          }}
        >
          Retry
        </button>
      ) : null}
    </span>
  )
}

function PreviewPending({ size }: { size: 'sm' | 'md' | 'glyph' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center',
        previewPaintClass,
      )}
      role="status"
      aria-label="Loading preview"
    >
      <Loader2
        className={cn(
          'animate-spin text-muted-foreground/70 motion-reduce:animate-none',
          size === 'sm' && 'size-3.5',
          size === 'md' && 'size-4',
          size === 'glyph' && 'size-[0.4em] min-h-4 min-w-4',
        )}
        aria-hidden
      />
    </span>
  )
}

function AaGlyph({
  family,
  weight = 400,
  italic = false,
  variation,
  pendingSize = 'md',
  wait = true,
  sample,
  fit = false,
  animateVariation = false,
  showRetry = true,
}: {
  family: string
  weight?: number
  italic?: boolean
  variation?: string
  pendingSize?: 'sm' | 'md' | 'glyph'
  wait?: boolean
  sample?: string
  fit?: boolean
  animateVariation?: boolean
  showRetry?: boolean
}) {
  const { ready, failed, retry } = usePreviewFontStatus(family, weight, italic, wait)
  const latinText = useContext(LatinPreviewContext)
  const text = applyLatinPreviewSample(sample, latinText)
  const glyphRef = useRef<HTMLSpanElement>(null)
  const [fitStyle, setFitStyle] = useState<CSSProperties>({})

  useLayoutEffect(() => {
    if (!fit || !ready) {
      setFitStyle({})
      return
    }
    const el = glyphRef.current
    const box = el?.parentElement
    if (!el || !box) return
    let frame = 0

    function applyFit() {
      if (!el || !box) return
      el.style.transform = 'none'
      el.style.transformOrigin = '0 0'
      const range = document.createRange()
      range.selectNodeContents(el)
      const ink = range.getBoundingClientRect()
      const frameRect = box.getBoundingClientRect()
      const element = el.getBoundingClientRect()
      if (ink.width <= 0 || ink.height <= 0 || frameRect.width <= 0 || frameRect.height <= 0) return
      const next = fitPreviewTransform(ink, frameRect, element)
      const transform = `translate(${next.translateX}px, ${next.translateY}px) scale(${next.scale})`
      const transformOrigin = `${next.originX}px ${next.originY}px`
      el.style.transformOrigin = transformOrigin
      el.style.transform = transform
      setFitStyle((current) =>
        current.transform === transform && current.transformOrigin === transformOrigin
          ? current
          : { transform, transformOrigin },
      )
    }

    applyFit()
    frame = requestAnimationFrame(applyFit)
    const observer = new ResizeObserver(applyFit)
    observer.observe(box)
    observer.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [fit, ready, family, weight, italic, variation, text])

  if (failed) {
    return (
      <PreviewLoadError onRetry={retry} compact={pendingSize !== 'glyph'} showRetry={showRetry} />
    )
  }
  if (sample == null || !ready) {
    return <PreviewPending size={pendingSize} />
  }
  return (
    <span
      ref={glyphRef}
      className={cn(
        'font-preview select-none whitespace-nowrap',
        !fit && 'translate-y-px overflow-hidden',
        animateVariation &&
          'transition-[font-variation-settings,font-weight] duration-[600ms] ease-out motion-reduce:transition-none',
      )}
      dir="auto"
      style={{
        fontFamily: `"${family}"`,
        fontWeight: weight,
        fontStyle: italic ? 'italic' : 'normal',
        fontSynthesis: 'none',
        fontVariationSettings: variation || undefined,
        ...fitStyle,
      }}
    >
      {text}
    </span>
  )
}

function PreviewLabel({ children }: { children: string }) {
  return (
    <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/85 to-transparent px-2 pb-1.5 pt-6 text-center text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  )
}

export function AaPreview({
  family,
  weight = 400,
  italic = false,
  variation,
  size = 'md',
  sample,
  wait,
}: {
  family: string
  weight?: number
  italic?: boolean
  variation?: string
  size?: 'sm' | 'md'
  sample?: string
  wait?: boolean
}) {
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center bg-muted/40 leading-none text-foreground shadow-[inset_0_0_0_1px_var(--border)]',
        previewPaintClass,
        previewBoxClass(size),
      )}
    >
      <AaGlyph
        family={family}
        weight={weight}
        italic={italic}
        variation={variation}
        pendingSize={size}
        sample={sample}
        wait={wait}
      />
    </div>
  )
}

export function CyclingAaPreview({
  faces,
  rest,
  active,
  size,
  sample,
}: {
  faces: PreviewFace[]
  rest: PreviewFace
  active: boolean
  size: number
  sample?: string
}) {
  const restIndex = Math.max(
    0,
    faces.findIndex(
      (face) =>
        face.family === rest.family &&
        (face.weight ?? 400) === (rest.weight ?? 400) &&
        Boolean(face.italic) === Boolean(rest.italic),
    ),
  )
  const cycling = active && faces.length > 1
  const index = useHoverCycle(faces.length, cycling, restIndex)
  const layers = faces.length > 0 ? faces : [rest]
  const visibleIndex = cycling ? index : restIndex
  const interpolateVariation = facesSupportVariationInterpolation(layers)
  const painted = interpolateVariation
    ? [visibleIndex]
    : paintedPreviewIndices(layers.length, visibleIndex, cycling)
  const visibleFace = layers[visibleIndex] ?? rest

  return (
    <div
      className={cn(
        'relative flex w-full shrink-0 items-center justify-center overflow-hidden rounded-none border-b border-border bg-muted/40 leading-none text-foreground',
        previewPaintClass,
      )}
      style={{ fontSize: `${size}rem`, minHeight: `${size * 2}rem` }}
    >
      {interpolateVariation ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <AaGlyph
            family={visibleFace.family}
            weight={visibleFace.weight}
            italic={visibleFace.italic}
            variation={visibleFace.variation}
            pendingSize="glyph"
            wait={visibleFace.wait !== false}
            sample={sample}
            fit
            animateVariation={cycling}
          />
          {cycling ? <PreviewLabel>{visibleFace.label}</PreviewLabel> : null}
        </div>
      ) : (
        painted.map((faceIndex) => {
          const face = layers[faceIndex]
          if (!face) return null
          return (
            <div
              key={`${face.family}-${face.weight ?? 400}-${face.italic ? 'i' : 'r'}-${face.label}-${faceIndex}`}
              className={cn(
                'absolute inset-0 flex items-center justify-center transition-opacity duration-150 ease-out motion-reduce:transition-none',
                faceIndex === visibleIndex ? 'opacity-100' : 'opacity-0',
              )}
              aria-hidden={faceIndex !== visibleIndex}
            >
              <AaGlyph
                family={face.family}
                weight={face.weight}
                italic={face.italic}
                variation={face.variation}
                pendingSize="glyph"
                wait={face.wait !== false}
                sample={sample}
                fit
                showRetry={faceIndex === visibleIndex}
              />
              {cycling ? <PreviewLabel>{face.label}</PreviewLabel> : null}
            </div>
          )
        })
      )}
    </div>
  )
}

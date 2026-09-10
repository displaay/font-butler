import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Loader2 } from 'lucide-react'
import { usePreviewFontReady } from '@/hooks/usePreviewFontReady'
import { fitPreviewTransform } from '@/lib/fitPreview'
import { applyLatinPreviewSample, DEFAULT_LATIN_PREVIEW_TEXT } from '@/lib/latinPreview'
import { cn } from '@/lib/utils'

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

function PreviewPending({ size }: { size: 'sm' | 'md' | 'glyph' }) {
  return (
    <span
      className="inline-flex items-center justify-center"
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
}: {
  family: string
  weight?: number
  italic?: boolean
  variation?: string
  pendingSize?: 'sm' | 'md' | 'glyph'
  wait?: boolean
  sample?: string
  fit?: boolean
}) {
  const ready = usePreviewFontReady(family, weight, italic, wait || fit)
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

    function measure() {
      if (!el || !box) return
      const previousTransform = el.style.transform
      const previousOrigin = el.style.transformOrigin
      el.style.transform = 'none'
      el.style.transformOrigin = '0 0'
      const range = document.createRange()
      range.selectNodeContents(el)
      const ink = range.getBoundingClientRect()
      const frame = box.getBoundingClientRect()
      const element = el.getBoundingClientRect()
      range.detach()
      el.style.transform = previousTransform
      el.style.transformOrigin = previousOrigin
      if (ink.width <= 0 || ink.height <= 0 || frame.width <= 0 || frame.height <= 0) return
      const next = fitPreviewTransform(ink, frame, element)
      const transform = `translate(${next.translateX}px, ${next.translateY}px) scale(${next.scale})`
      const transformOrigin = `${next.originX}px ${next.originY}px`
      setFitStyle((current) =>
        current.transform === transform && current.transformOrigin === transformOrigin
          ? current
          : { transform, transformOrigin },
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [fit, ready, family, weight, italic, variation, text])

  if (!ready) return <PreviewPending size={pendingSize} />
  return (
    <span
      ref={glyphRef}
      className={cn(
        'font-preview select-none whitespace-nowrap',
        !fit && 'translate-y-px overflow-hidden',
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
  size = 'md',
  sample,
}: {
  family: string
  weight?: number
  italic?: boolean
  size?: 'sm' | 'md'
  sample?: string
}) {
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center bg-muted/40 leading-none text-foreground shadow-[inset_0_0_0_1px_var(--border)]',
        previewBoxClass(size),
      )}
    >
      <AaGlyph family={family} weight={weight} italic={italic} pendingSize={size} sample={sample} />
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

  return (
    <div
      className="relative flex w-full shrink-0 items-center justify-center overflow-hidden rounded-none border-b border-border bg-muted/40 leading-none text-foreground"
      style={{ fontSize: `${size}rem`, minHeight: `${size * 2}rem` }}
    >
      {layers.map((face, faceIndex) => (
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
            wait={faceIndex === visibleIndex}
            sample={sample}
            fit
          />
          {cycling ? <PreviewLabel>{face.label}</PreviewLabel> : null}
        </div>
      ))}
    </div>
  )
}

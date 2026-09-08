import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { usePreviewFontReady } from '@/hooks/usePreviewFontReady'
import { cn } from '@/lib/utils'

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
  return size === 'sm' ? 'size-8 text-[17px] rounded-md' : 'size-11 text-[24px] rounded-md'
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
}: {
  family: string
  weight?: number
  italic?: boolean
  variation?: string
  pendingSize?: 'sm' | 'md' | 'glyph'
  wait?: boolean
}) {
  const ready = usePreviewFontReady(family, weight, italic, wait)
  if (!ready) return <PreviewPending size={pendingSize} />
  return (
    <span
      className="font-preview translate-y-px select-none"
      style={{
        fontFamily: `"${family}"`,
        fontWeight: weight,
        fontStyle: italic ? 'italic' : 'normal',
        fontSynthesis: 'none',
        fontVariationSettings: variation || undefined,
      }}
    >
      Aa
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
}: {
  family: string
  weight?: number
  italic?: boolean
  size?: 'sm' | 'md'
}) {
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center bg-muted/40 leading-none text-foreground shadow-[inset_0_0_0_1px_var(--border)]',
        previewBoxClass(size),
      )}
    >
      <AaGlyph family={family} weight={weight} italic={italic} pendingSize={size} />
    </div>
  )
}

export function CyclingAaPreview({
  faces,
  rest,
  active,
  size,
}: {
  faces: PreviewFace[]
  rest: PreviewFace
  active: boolean
  size: number
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
          />
          {cycling ? <PreviewLabel>{face.label}</PreviewLabel> : null}
        </div>
      ))}
    </div>
  )
}

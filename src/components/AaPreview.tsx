import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const CYCLE_MS = 600

export type PreviewFace = {
  family: string
  weight?: number
  italic?: boolean
  label: string
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

function isFlushPreview(size: 'sm' | 'md' | 'lg' | number) {
  return typeof size === 'number' || size === 'lg'
}

function previewBoxClass(size: 'sm' | 'md' | 'lg' | number) {
  if (typeof size === 'number') {
    return 'w-full overflow-hidden rounded-none border-b border-border'
  }
  if (size === 'sm') return 'size-8 text-[17px] rounded-md'
  if (size === 'lg') return 'min-h-[8.5rem] w-full text-[4.25rem] rounded-none border-b border-border'
  return 'size-11 text-[24px] rounded-md'
}

function AaGlyph({
  family,
  weight = 400,
  italic = false,
}: {
  family: string
  weight?: number
  italic?: boolean
}) {
  return (
    <span
      className="font-preview translate-y-px select-none"
      style={{
        fontFamily: `"${family}", ui-sans-serif, system-ui`,
        fontWeight: weight,
        fontStyle: italic ? 'italic' : 'normal',
        fontSynthesis: 'none',
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
  label,
}: {
  family: string
  weight?: number
  italic?: boolean
  size?: 'sm' | 'md' | 'lg' | number
  label?: string
}) {
  const custom = typeof size === 'number'
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center bg-muted/40 leading-none text-foreground',
        !isFlushPreview(size) && 'shadow-[inset_0_0_0_1px_var(--border)]',
        previewBoxClass(size),
      )}
      style={custom ? { fontSize: `${size}rem`, minHeight: `${size * 2}rem` } : undefined}
    >
      <AaGlyph family={family} weight={weight} italic={italic} />
      {label ? <PreviewLabel>{label}</PreviewLabel> : null}
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
          <AaGlyph family={face.family} weight={face.weight} italic={face.italic} />
          {cycling ? <PreviewLabel>{face.label}</PreviewLabel> : null}
        </div>
      ))}
    </div>
  )
}

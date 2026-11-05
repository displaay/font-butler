import { useLayoutEffect, useRef } from 'react'
import { DEFAULT_TEXT_PREVIEW } from '@/lib/textPreview'

export function TextSampleField({
  label,
  lang,
  family,
  weight = 400,
  italic = false,
  variation,
  featureSettings,
  size,
  value,
  onChange,
}: {
  label: string
  lang?: string
  family: string
  weight?: number
  italic?: boolean
  variation?: string
  featureSettings?: string
  size: number
  value: string
  onChange: (value: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value, size, family, weight, italic, variation, featureSettings])

  return (
    <textarea
      ref={ref}
      data-text-sample=""
      data-no-marquee=""
      lang={lang}
      dir="auto"
      rows={1}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      aria-label={`Sample text for ${label}`}
      placeholder={DEFAULT_TEXT_PREVIEW}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      className="font-preview w-full resize-none bg-transparent px-3 py-3 text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
      style={{
        fontFamily: `"${family}", sans-serif`,
        fontWeight: weight,
        fontStyle: italic ? 'italic' : 'normal',
        fontSize: `${size}rem`,
        lineHeight: 1.2,
        fontSynthesis: 'none',
        fontVariationSettings: variation || undefined,
        fontFeatureSettings: featureSettings || undefined,
      }}
    />
  )
}

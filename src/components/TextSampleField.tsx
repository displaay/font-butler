import { useLayoutEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { PreviewLoadError } from '@/components/AaPreview'
import { usePreviewFontStatus } from '@/hooks/usePreviewFontReady'
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
  const { ready, failed, retry } = usePreviewFontStatus(family, weight, italic)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const box = el.parentElement
    let width = box?.clientWidth ?? 0

    function fit() {
      const node = ref.current
      if (!node) return
      node.style.height = 'auto'
      node.style.height = `${node.scrollHeight}px`
    }

    fit()
    const observer = new ResizeObserver(() => {
      const next = box?.clientWidth ?? 0
      if (next === width) return
      width = next
      fit()
    })
    if (box) observer.observe(box)
    document.fonts?.addEventListener('loadingdone', fit)
    return () => {
      observer.disconnect()
      document.fonts?.removeEventListener('loadingdone', fit)
    }
  }, [value, size, family, weight, italic, variation, featureSettings, ready])

  if (failed) {
    return (
      <div className="flex min-h-16 items-center justify-center px-3 py-6">
        <PreviewLoadError onRetry={retry} />
      </div>
    )
  }

  return (
    <div className="relative min-w-0">
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
          color: ready ? undefined : 'transparent',
          caretColor: ready ? undefined : 'var(--foreground)',
        }}
      />
      {ready ? null : (
        <span
          className="pointer-events-none absolute top-3 left-3 inline-flex items-center text-muted-foreground/70"
          role="status"
          aria-label="Loading preview"
        >
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        </span>
      )}
    </div>
  )
}

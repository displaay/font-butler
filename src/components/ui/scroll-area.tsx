import { useCallback, useEffect, useRef, useState, type ComponentProps, type Ref } from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { cn } from '@/lib/utils'

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') ref(value)
  else ref.current = value
}

function ScrollArea({
  className,
  children,
  viewportRef,
  overlay = false,
  type,
  scrollHideDelay = 600,
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportRef?: Ref<HTMLDivElement>
  overlay?: boolean
}) {
  const hideTimerRef = useRef(0)
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null)
  const [scrolling, setScrolling] = useState(false)

  const setViewportRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setViewportNode((current) => (current === node ? current : node))
      assignRef(viewportRef, node)
    },
    [viewportRef],
  )

  useEffect(() => {
    if (!overlay || !viewportNode) return

    function onScroll() {
      setScrolling(true)
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = window.setTimeout(() => setScrolling(false), scrollHideDelay)
    }

    viewportNode.addEventListener('scroll', onScroll, { passive: true })
    return () => viewportNode.removeEventListener('scroll', onScroll)
  }, [overlay, viewportNode, scrollHideDelay])

  useEffect(() => {
    return () => window.clearTimeout(hideTimerRef.current)
  }, [])

  return (
    <ScrollAreaPrimitive.Root
      {...props}
      type={overlay ? 'always' : type}
      scrollHideDelay={scrollHideDelay}
      className={cn(
        'relative overflow-hidden',
        overlay && 'overlay-scroll',
        overlay && scrolling && 'is-scrolling',
        className,
      )}
    >
      <ScrollAreaPrimitive.Viewport
        ref={setViewportRefs}
        className="h-full w-full [&>div]:flex [&>div]:min-h-full [&>div]:flex-col"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        forceMount={overlay ? true : undefined}
        className={cn(
          'flex w-2 touch-none p-0.5',
          overlay && 'overlay-scroll-bar absolute top-0 right-0 z-10 h-full',
        )}
      >
        <ScrollAreaPrimitive.Thumb
          className={cn('flex-1 rounded-full', overlay ? 'bg-foreground/25' : 'bg-border')}
        />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  )
}

export { ScrollArea }

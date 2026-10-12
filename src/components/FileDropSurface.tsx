import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { hasFontButlerEntries } from '@/lib/projects'

/**
 * Hide a stuck overlay once file dragover events stop arriving.
 * A still pointer only produces dragover about every 350±200ms, so the
 * window has to be longer than that gap.
 */
const DRAG_OVER_IDLE_MS = 1000

function transferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  return Array.from(dataTransfer.types).includes('Files')
}

/**
 * Full-window file drop target. The overlay is shown only for OS file drags,
 * tracked with an enter/leave depth so moving across child cards does not
 * hide it, and cleared when the pointer leaves the window or the drag is
 * cancelled.
 */
export function FileDropSurface({
  children,
  className,
  dragging,
  label,
  ignoreRef,
  onDraggingChange,
  onDrop,
}: {
  children: ReactNode
  className?: string
  dragging: boolean
  label: string
  ignoreRef?: RefObject<boolean>
  onDraggingChange: (dragging: boolean) => void
  onDrop: (dataTransfer: DataTransfer) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const depthRef = useRef(0)
  const draggingRef = useRef(dragging)
  const onDraggingChangeRef = useRef(onDraggingChange)
  const onDropRef = useRef(onDrop)
  const watchdogRef = useRef<number | undefined>(undefined)
  const internalImageDragRef = useRef(false)

  function reset() {
    window.clearTimeout(watchdogRef.current)
    depthRef.current = 0
    if (!draggingRef.current) return
    draggingRef.current = false
    onDraggingChangeRef.current(false)
  }

  useEffect(() => {
    draggingRef.current = dragging
    onDraggingChangeRef.current = onDraggingChange
    onDropRef.current = onDrop
    if (!dragging) depthRef.current = 0
  }, [dragging, onDraggingChange, onDrop])

  useEffect(() => {
    const accepts = (dataTransfer: DataTransfer | null) => {
      if (ignoreRef?.current || internalImageDragRef.current) return false
      if (!dataTransfer || hasFontButlerEntries(dataTransfer)) return false
      return transferHasFiles(dataTransfer)
    }
    const show = () => {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = window.setTimeout(() => {
        depthRef.current = 0
        if (!draggingRef.current) return
        draggingRef.current = false
        onDraggingChangeRef.current(false)
      }, DRAG_OVER_IDLE_MS)
      if (draggingRef.current) return
      draggingRef.current = true
      onDraggingChangeRef.current(true)
    }
    const clear = () => {
      window.clearTimeout(watchdogRef.current)
      depthRef.current = 0
      if (!draggingRef.current) return
      draggingRef.current = false
      onDraggingChangeRef.current(false)
    }
    const onEnter = (event: DragEvent) => {
      if (!accepts(event.dataTransfer)) return
      event.preventDefault()
      depthRef.current += 1
      show()
    }
    const onOver = (event: DragEvent) => {
      if (!accepts(event.dataTransfer)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      show()
    }
    const onDragStart = (event: DragEvent) => {
      const target = event.target
      internalImageDragRef.current = target instanceof Element && target.tagName === 'IMG'
    }
    const onDragEndImage = () => {
      internalImageDragRef.current = false
    }
    const onLeave = (event: DragEvent) => {
      const next = event.relatedTarget
      const root = rootRef.current
      const inside = next instanceof Node && Boolean(root && (next === root || root.contains(next)))
      if (next == null || !inside) {
        clear()
        return
      }
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (depthRef.current === 0) clear()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clear()
    }
    const onMouseMove = (event: MouseEvent) => {
      if (event.buttons === 0) clear()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear()
    }
    const capture = true
    window.addEventListener('dragstart', onDragStart, capture)
    window.addEventListener('dragenter', onEnter, capture)
    window.addEventListener('dragover', onOver, capture)
    window.addEventListener('dragleave', onLeave, capture)
    window.addEventListener('drop', clear, capture)
    window.addEventListener('dragend', clear, capture)
    window.addEventListener('dragend', onDragEndImage, capture)
    window.addEventListener('blur', clear, capture)
    document.addEventListener('visibilitychange', onVisibility, capture)
    window.addEventListener('mousemove', onMouseMove, capture)
    window.addEventListener('keydown', onKeyDown, capture)
    window.addEventListener('click', clear, capture)
    return () => {
      window.clearTimeout(watchdogRef.current)
      window.removeEventListener('dragstart', onDragStart, capture)
      window.removeEventListener('dragenter', onEnter, capture)
      window.removeEventListener('dragover', onOver, capture)
      window.removeEventListener('dragleave', onLeave, capture)
      window.removeEventListener('drop', clear, capture)
      window.removeEventListener('dragend', clear, capture)
      window.removeEventListener('dragend', onDragEndImage, capture)
      window.removeEventListener('blur', clear, capture)
      document.removeEventListener('visibilitychange', onVisibility, capture)
      window.removeEventListener('mousemove', onMouseMove, capture)
      window.removeEventListener('keydown', onKeyDown, capture)
      window.removeEventListener('click', clear, capture)
    }
  }, [ignoreRef])

  return (
    <div
      ref={rootRef}
      className={className}
      onDrop={(event) => {
        event.preventDefault()
        reset()
        onDropRef.current(event.dataTransfer)
      }}
    >
      {children}
      {dragging ? (
        <div
          data-file-drop-overlay=""
          className="fixed inset-3 z-40 flex items-center justify-center rounded-lg border border-dashed border-foreground/20 bg-background/80 md:left-[14.75rem]"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            reset()
          }}
        >
          <p className="text-base font-medium tracking-tight">{label}</p>
        </div>
      ) : null}
    </div>
  )
}

import { useEffect, useRef, type DragEvent as ReactDragEvent, type ReactNode, type RefObject } from 'react'
import { hasFontButlerEntries } from '@/lib/projects'

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
  const depthRef = useRef(0)
  const draggingRef = useRef(dragging)
  const onDraggingChangeRef = useRef(onDraggingChange)

  function reset() {
    depthRef.current = 0
    if (!draggingRef.current) return
    draggingRef.current = false
    onDraggingChangeRef.current(false)
  }

  function accepts(dataTransfer: DataTransfer | null): boolean {
    if (ignoreRef?.current) return false
    if (!dataTransfer || hasFontButlerEntries(dataTransfer)) return false
    return transferHasFiles(dataTransfer)
  }

  useEffect(() => {
    draggingRef.current = dragging
    onDraggingChangeRef.current = onDraggingChange
    if (!dragging) depthRef.current = 0
  }, [dragging, onDraggingChange])

  useEffect(() => {
    const clear = () => {
      depthRef.current = 0
      if (!draggingRef.current) return
      draggingRef.current = false
      onDraggingChangeRef.current(false)
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
    window.addEventListener('drop', clear)
    window.addEventListener('dragend', clear)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('click', clear)
    return () => {
      window.removeEventListener('drop', clear)
      window.removeEventListener('dragend', clear)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('click', clear)
    }
  }, [])

  function onDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!accepts(event.dataTransfer)) return
    event.preventDefault()
    depthRef.current += 1
    if (!draggingRef.current) {
      draggingRef.current = true
      onDraggingChange(true)
    }
  }

  function onDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!accepts(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (event.relatedTarget == null) {
      reset()
      return
    }
    depthRef.current = Math.max(0, depthRef.current - 1)
    if (depthRef.current === 0) reset()
  }

  return (
    <div
      className={className}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        event.preventDefault()
        reset()
        onDrop(event.dataTransfer)
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

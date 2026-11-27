import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_RESIZE_STEP,
  clampSidebarWidth,
  readSidebarWidth,
  sidebarWidthBounds,
  writeSidebarWidth,
} from '@/lib/sidebarWidth'

export function useSidebarResize() {
  const [width, setWidth] = useState(() => readSidebarWidth(window.innerWidth))
  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(width)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  function commit(next: number) {
    widthRef.current = next
    setWidth(next)
    writeSidebarWidth(next)
  }

  useEffect(() => {
    function onResize() {
      if (dragRef.current) return
      const next = clampSidebarWidth(widthRef.current, window.innerWidth)
      if (next === widthRef.current) return
      widthRef.current = next
      setWidth(next)
      writeSidebarWidth(next)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = dragRef.current
      if (!drag) return
      const next = clampSidebarWidth(drag.startWidth + event.clientX - drag.startX, window.innerWidth)
      widthRef.current = next
      setWidth(next)
    }
    function endDrag() {
      if (!dragRef.current) return
      dragRef.current = null
      setDragging(false)
      document.documentElement.removeAttribute('data-sidebar-resizing')
      writeSidebarWidth(widthRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startWidth: widthRef.current }
    setDragging(true)
    document.documentElement.setAttribute('data-sidebar-resizing', '')
  }

  function reset() {
    commit(clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, window.innerWidth))
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      commit(clampSidebarWidth(widthRef.current - SIDEBAR_RESIZE_STEP, window.innerWidth))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      commit(clampSidebarWidth(widthRef.current + SIDEBAR_RESIZE_STEP, window.innerWidth))
    } else if (event.key === 'Home') {
      event.preventDefault()
      reset()
    }
  }

  return {
    width,
    dragging,
    bounds: sidebarWidthBounds(window.innerWidth),
    onPointerDown,
    onKeyDown,
    reset,
  }
}

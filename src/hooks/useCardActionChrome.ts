import { useRef, useState, type FocusEvent as ReactFocusEvent } from 'react'

/** Hover, keyboard focus, and context-menu open — without CSS :hover that sticks after a right-click. */
export function useCardActionChrome() {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const menuOpenRef = useRef(false)

  function onContextMenuOpenChange(open: boolean) {
    menuOpenRef.current = open
    setMenuOpen(open)
    if (!open) {
      setHovered(false)
      setFocusWithin(false)
    }
  }

  const actionsVisible = hovered || menuOpen || focusWithin

  return {
    hovered,
    actionsVisible,
    onContextMenuOpenChange,
    cardChrome: {
      onPointerEnter() {
        setHovered(true)
      },
      onPointerLeave() {
        if (!menuOpenRef.current) setHovered(false)
      },
      onFocusCapture() {
        setFocusWithin(true)
      },
      onBlurCapture(event: ReactFocusEvent<HTMLElement>) {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setFocusWithin(false)
        }
      },
    },
  }
}

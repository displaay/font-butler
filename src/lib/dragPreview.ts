export function fontDragCountLabel(count: number): string {
  return count === 1 ? '1 font' : `${count} fonts`
}

let dragImageHost: HTMLElement | null = null

export function clearFontDragImage(): void {
  dragImageHost?.remove()
  dragImageHost = null
}

export function applyFontDragImage(event: DragEvent, familyNames: string[]): void {
  clearFontDragImage()
  if (familyNames.length < 2 || !event.dataTransfer) return

  const shown = familyNames.slice(0, 3)
  const layers = shown.length
  const cardWidth = 176
  const cardHeight = 44
  const offset = 5

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    transform: 'translate(-200%, -200%)',
    pointerEvents: 'none',
    zIndex: '99999',
  })

  const stack = document.createElement('div')
  Object.assign(stack.style, {
    position: 'relative',
    width: `${cardWidth + (layers - 1) * offset}px`,
    height: `${cardHeight + (layers - 1) * offset}px`,
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  })

  for (let index = shown.length - 1; index >= 0; index -= 1) {
    const layer = document.createElement('div')
    layer.textContent = shown[index] ?? ''
    Object.assign(layer.style, {
      position: 'absolute',
      left: `${index * offset}px`,
      top: `${index * offset}px`,
      width: `${cardWidth}px`,
      height: `${cardHeight}px`,
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      borderRadius: '8px',
      border: '1px solid var(--border)',
      background: 'var(--popover)',
      color: 'var(--popover-foreground)',
      fontSize: '13px',
      fontWeight: '500',
      boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
    })
    stack.appendChild(layer)
  }

  const badge = document.createElement('div')
  badge.textContent = String(familyNames.length)
  badge.setAttribute('aria-label', fontDragCountLabel(familyNames.length))
  Object.assign(badge.style, {
    position: 'absolute',
    top: '-8px',
    right: '-8px',
    minWidth: '22px',
    height: '22px',
    padding: '0 6px',
    borderRadius: '999px',
    background: 'var(--foreground)',
    color: 'var(--background)',
    fontSize: '11px',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
  })
  stack.appendChild(badge)
  host.appendChild(stack)
  document.body.appendChild(host)
  dragImageHost = host
  event.dataTransfer.setDragImage(host, 28, 20)
}

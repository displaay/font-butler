import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export function AppMenuBar({
  busy,
  onClearFontCache,
  onClearOfficeCache,
  onOpenSettings,
}: {
  busy: boolean
  onClearFontCache: () => void
  onClearOfficeCache: () => void
  onOpenSettings: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div className="flex h-8 shrink-0 items-center border-b bg-card/90 px-2">
      <div ref={rootRef} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            'rounded-md px-2 py-1 text-sm hover:bg-muted',
            open && 'bg-muted',
          )}
          onClick={() => setOpen((current) => !current)}
        >
          Font cache
        </button>
        {open ? (
          <div
            role="menu"
            className="absolute top-full left-0 z-50 mt-0.5 min-w-56 rounded-lg border bg-popover p-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              className="flex w-full cursor-default items-center rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted disabled:opacity-40"
              onClick={() => {
                setOpen(false)
                onClearFontCache()
              }}
            >
              Remove font cache
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              className="flex w-full cursor-default items-center rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted disabled:opacity-40"
              onClick={() => {
                setOpen(false)
                onClearOfficeCache()
              }}
            >
              Remove MS Office cache
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="rounded-md px-2 py-1 text-sm hover:bg-muted"
        onClick={onOpenSettings}
      >
        Settings
      </button>
    </div>
  )
}

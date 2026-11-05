import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { TEXT_PREVIEW_LANGUAGES, textPreviewLanguage } from '@/lib/textPreview'
import { cn, CONTROL_H } from '@/lib/utils'

export function SampleLanguageMenu({
  languageId,
  onLanguageChange,
}: {
  languageId: string
  onLanguageChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState(languageId)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typedRef = useRef('')
  const typedAtRef = useRef(0)
  const current = textPreviewLanguage(languageId)

  useEffect(() => {
    if (!open) return
    setActiveId(current.id)
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    const frame = requestAnimationFrame(() => listRef.current?.focus())
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, current.id])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector('[data-active="true"]')
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' })
  }, [open, activeId])

  function moveActive(delta: number) {
    const index = TEXT_PREVIEW_LANGUAGES.findIndex((language) => language.id === activeId)
    const next = TEXT_PREVIEW_LANGUAGES[Math.min(TEXT_PREVIEW_LANGUAGES.length - 1, Math.max(0, index + delta))]
    if (next) setActiveId(next.id)
  }

  function choose(id: string) {
    onLanguageChange(id)
    setOpen(false)
  }

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      moveActive(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      moveActive(-1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      event.stopPropagation()
      const first = TEXT_PREVIEW_LANGUAGES[0]
      if (first) setActiveId(first.id)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      const last = TEXT_PREVIEW_LANGUAGES[TEXT_PREVIEW_LANGUAGES.length - 1]
      if (last) setActiveId(last.id)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      choose(activeId)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    const now = Date.now()
    const prefix = now - typedAtRef.current > 700 ? event.key : `${typedRef.current}${event.key}`
    typedRef.current = prefix
    typedAtRef.current = now
    const match = TEXT_PREVIEW_LANGUAGES.find((language) =>
      language.label.toLowerCase().startsWith(prefix.toLowerCase()),
    )
    if (match) setActiveId(match.id)
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        data-sample-language=""
        className={cn(
          CONTROL_H,
          'flex max-w-44 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13px]',
        )}
        aria-label="Sample language"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="truncate">{current.label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label="Sample language"
          data-sample-language-menu=""
          className="absolute top-full left-0 z-30 mt-1 max-h-80 w-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-sm outline-none"
          onKeyDown={onListKeyDown}
        >
          {TEXT_PREVIEW_LANGUAGES.map((language) => {
            const selected = language.id === current.id
            const active = language.id === activeId
            return (
              <button
                key={language.id}
                type="button"
                role="option"
                aria-selected={selected}
                data-active={active ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted',
                  (selected || active) && 'bg-muted',
                  selected && 'font-medium',
                )}
                onMouseEnter={() => setActiveId(language.id)}
                onClick={() => choose(language.id)}
              >
                <span className="min-w-0 flex-1 truncate">{language.label}</span>
                {selected ? <Check className="size-3.5 shrink-0" /> : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

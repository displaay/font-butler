import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  addSearchToken,
  suggestSearchTokens,
  textAfterTokenChoice,
  type SearchToken,
  type SearchTokenGroup,
} from '../../shared/library-search.ts'

const GROUP_LABELS: Record<SearchTokenGroup, string> = {
  weight: 'Weight',
  style: 'Style',
  figures: 'Figures',
  kind: 'Kind',
}

export function LibrarySearch({
  text,
  tokens,
  onTextChange,
  onTokensChange,
}: {
  text: string
  tokens: SearchToken[]
  onTextChange: (value: string) => void
  onTokensChange: (tokens: SearchToken[]) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const suggestions = useMemo(() => suggestSearchTokens(text.trim().split(/\s+/).at(-1) ?? ''), [text])
  const grouped = useMemo(() => {
    const order: SearchTokenGroup[] = ['weight', 'style', 'figures', 'kind']
    return order
      .map((group) => ({
        group,
        tokens: suggestions.filter((token) => token.group === group),
      }))
      .filter((section) => section.tokens.length > 0)
  }, [suggestions])

  function choose(token: SearchToken) {
    onTokensChange(addSearchToken(tokens, token.id))
    onTextChange(textAfterTokenChoice(text, token))
    setMenuOpen(false)
  }

  return (
    <div className="relative">
      <div className="flex min-h-8 items-center gap-1 rounded-md border bg-background px-2 py-1">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {tokens.map((token) => (
            <button
              key={token.id}
              type="button"
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground"
              aria-label={`Remove ${token.label}`}
              onClick={() => onTokensChange(tokens.filter((item) => item.id !== token.id))}
            >
              {token.label}
              <X className="size-3 opacity-70" />
            </button>
          ))}
          <input
            type="search"
            value={text}
            onChange={(event) => {
              onTextChange(event.target.value)
              if (event.target.value.trim()) setMenuOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Backspace' && text === '' && tokens.length > 0) {
                event.preventDefault()
                onTokensChange(tokens.slice(0, -1))
              }
              if (event.key === 'Escape') setMenuOpen(false)
            }}
            onFocus={() => {
              if (text.trim()) setMenuOpen(true)
            }}
            placeholder={tokens.length > 0 ? '' : 'Search families'}
            aria-label="Search families"
            className="h-6 min-w-[6rem] flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
        <button
          type="button"
          className={cn(
            'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground',
            menuOpen && 'bg-muted text-foreground',
          )}
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          aria-label="Filters"
          onClick={() => setMenuOpen((open) => !open)}
        >
          Filters
        </button>
      </div>
      {menuOpen ? (
        <div
          role="listbox"
          aria-label="Preview filters"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-sm"
        >
          {grouped.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No matching filters</p>
          ) : (
            grouped.map((section) => (
              <div key={section.group} className="mb-1">
                <p className="px-2 pt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  {GROUP_LABELS[section.group]}
                </p>
                {section.tokens.map((token) => {
                  const selected = tokens.some((item) => item.id === token.id)
                  return (
                    <button
                      key={token.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={cn(
                        'flex w-full rounded-md px-2 py-1 text-left text-[13px] hover:bg-muted',
                        selected && 'bg-muted',
                      )}
                      onClick={() => choose(token)}
                    >
                      {token.label}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

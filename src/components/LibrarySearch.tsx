import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FONT_CLASSIFICATION_LABELS, isFontClassification } from '../../shared/font-classification.ts'
import type { LibraryFilter } from '../../shared/library-filters.ts'
import {
  applySearchSuggestion,
  searchFilterSuggestions,
  type SearchFilterCatalog,
  type SearchSuggestion,
  type SearchSuggestionKind,
  type SearchToken,
} from '../../shared/library-search.ts'

const SECTION_LABELS: Record<SearchSuggestionKind, string> = {
  style: 'Filters',
  classification: 'Classification',
  tag: 'Tags',
  foundry: 'Foundries',
}

const NO_TAGS: NonNullable<SearchFilterCatalog['tags']> = []
const NO_FOUNDRIES: string[] = []
const NO_FILTERS: LibraryFilter[] = []

type SearchBarTag =
  | { key: string; label: string; kind: 'token'; tokenId: string }
  | { key: string; label: string; kind: 'filter'; filterId: LibraryFilter }

/** Classification and foundry picks from the suggestions. Sidebar status chips stay in the Filters panel. */
function searchFilterTagLabel(filter: string): string | null {
  if (filter.startsWith('classification:')) {
    const id = filter.slice('classification:'.length)
    return isFontClassification(id) ? FONT_CLASSIFICATION_LABELS[id] : null
  }
  if (filter.startsWith('foundry:')) {
    const name = filter.slice('foundry:'.length).trim()
    return name || null
  }
  return null
}

function searchBarTags(tokens: readonly SearchToken[], libraryFilters: readonly LibraryFilter[]): SearchBarTag[] {
  const tags: SearchBarTag[] = tokens.map((token) => ({
    key: `token:${token.id}`,
    label: token.label,
    kind: 'token',
    tokenId: token.id,
  }))
  for (const filter of libraryFilters) {
    const label = searchFilterTagLabel(filter)
    if (!label) continue
    tags.push({ key: `filter:${filter}`, label, kind: 'filter', filterId: filter })
  }
  return tags
}

export function LibrarySearch({
  text,
  tokens,
  onTextChange,
  onTokensChange,
  tags = NO_TAGS,
  foundries = NO_FOUNDRIES,
  libraryFilters = NO_FILTERS,
  onLibraryFiltersChange,
}: {
  text: string
  tokens: SearchToken[]
  onTextChange: (value: string) => void
  onTokensChange: (tokens: SearchToken[]) => void
  tags?: SearchFilterCatalog['tags']
  foundries?: readonly string[]
  libraryFilters?: readonly LibraryFilter[]
  onLibraryFiltersChange?: (value: LibraryFilter[]) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const activeRef = useRef<HTMLButtonElement>(null)
  const catalog = useMemo<SearchFilterCatalog>(
    () => ({
      tags,
      foundries,
      chosenTokenIds: tokens.map((token) => token.id),
      chosenFilters: libraryFilters,
    }),
    [tags, foundries, tokens, libraryFilters],
  )
  const shown = useMemo(() => searchFilterSuggestions(text, catalog), [text, catalog])
  const barTags = useMemo(() => searchBarTags(tokens, libraryFilters), [tokens, libraryFilters])
  const shownKey = shown.map((item) => item.id).join('\n')
  const [highlightKey, setHighlightKey] = useState(shownKey)
  if (highlightKey !== shownKey) {
    setHighlightKey(shownKey)
    setActiveIndex(shown.length > 0 ? 0 : -1)
  }

  useEffect(() => {
    if (!menuOpen) return
    const node = activeRef.current
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  }, [menuOpen, activeIndex])

  function choose(suggestion: SearchSuggestion) {
    const next = applySearchSuggestion(suggestion, tokens, libraryFilters)
    if (next.text !== text) onTextChange(next.text)
    if (
      next.tokens.length !== tokens.length ||
      next.tokens.some((token, index) => token.id !== tokens[index]?.id)
    ) {
      onTokensChange(next.tokens)
    }
    if (
      onLibraryFiltersChange &&
      (next.libraryFilters.length !== libraryFilters.length ||
        next.libraryFilters.some((filter, index) => filter !== libraryFilters[index]))
    ) {
      onLibraryFiltersChange(next.libraryFilters)
    }
    setMenuOpen(false)
  }

  function removeBarTag(tag: SearchBarTag) {
    if (tag.kind === 'token') {
      onTokensChange(tokens.filter((item) => item.id !== tag.tokenId))
      return
    }
    onLibraryFiltersChange?.(libraryFilters.filter((item) => item !== tag.filterId))
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && text === '' && barTags.length > 0) {
      event.preventDefault()
      const last = barTags[barTags.length - 1]
      if (last) removeBarTag(last)
      return
    }
    if (event.key === 'Escape') {
      if (!menuOpen) return
      event.preventDefault()
      event.stopPropagation()
      setMenuOpen(false)
      return
    }
    if (!menuOpen || shown.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(shown.length - 1, (index < 0 ? -1 : index) + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(0, index - 1))
      return
    }
    if (event.key === 'Enter' && shown[activeIndex]) {
      event.preventDefault()
      choose(shown[activeIndex])
    }
  }

  let lastKind: SearchSuggestionKind | null = null

  return (
    <div className="relative">
      <div className="flex min-h-7 items-center gap-1 rounded-full border bg-background px-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1">
          {barTags.map((tag) => (
            <button
              key={tag.key}
              type="button"
              className="search-token inline-flex h-[18px] max-w-full items-center truncate rounded-[4px] px-1.5 text-[13px] leading-none"
              aria-label={`Remove ${tag.label}`}
              onClick={() => removeBarTag(tag)}
            >
              {tag.label}
            </button>
          ))}
          <input
            type="search"
            value={text}
            onChange={(event) => {
              const value = event.target.value
              onTextChange(value)
              setMenuOpen(searchFilterSuggestions(value, catalog).length > 0)
            }}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (searchFilterSuggestions(text, catalog).length > 0) setMenuOpen(true)
            }}
            placeholder="Search"
            aria-label="Search"
            aria-autocomplete="list"
            aria-controls="library-search-filters"
            aria-expanded={menuOpen}
            aria-activedescendant={menuOpen && activeIndex >= 0 ? `library-search-option-${activeIndex}` : undefined}
            role="combobox"
            className="h-5 min-w-[4rem] flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
      </div>
      {menuOpen ? (
        <div
          id="library-search-filters"
          role="listbox"
          aria-label="Search filters"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-sm"
          onMouseDown={(event) => event.preventDefault()}
        >
          {shown.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No matching filters</p>
          ) : (
            shown.map((suggestion, index) => {
              const header = suggestion.kind === lastKind ? null : SECTION_LABELS[suggestion.kind]
              lastKind = suggestion.kind
              const active = index === activeIndex
              return (
                <div key={suggestion.id}>
                  {header ? (
                    <p className="px-2 pt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      {header}
                    </p>
                  ) : null}
                  <button
                    id={`library-search-option-${index}`}
                    ref={active ? activeRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-kind={suggestion.kind}
                    className={cn(
                      'flex w-full rounded-md px-2 py-1 text-left text-[13px] hover:bg-muted',
                      active && 'bg-muted',
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(suggestion)}
                  >
                    {suggestion.label}
                  </button>
                </div>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}

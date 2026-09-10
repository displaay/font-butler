import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Copy, Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { catalogFontFamily } from '@/components/FontFaceStyles'
import { usePreviewFontReady } from '@/hooks/usePreviewFontReady'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import {
  GLYPH_CELL_KEY,
  GLYPH_CELL_MAX,
  GLYPH_CELL_MIN,
  GLYPH_CELL_STEP,
  GLYPH_GROUP_HEADER_HEIGHT,
  clampGlyphCellSize,
  codePointLabel,
  displayableCodePoints,
  fallbackGlyphName,
  filterGlyphs,
  glyphCharacter,
  glyphFontSize,
  glyphGridLayout,
  glyphLayoutOffsets,
  glyphSectionRows,
  groupGlyphs,
  htmlCode,
  readGlyphCellSize,
  visibleGlyphRowRange,
} from '@/lib/glyphs'
import { hasManagedInstall } from '@/lib/group'
import type { CatalogEntry } from '@/lib/types'
import { cn, CONTROL_H } from '@/lib/utils'

const GAP = 6
const OVERSCAN = 3

export function GlyphGrid({ entry }: { entry: CatalogEntry }) {
  const family = catalogFontFamily(entry.id)
  const face = entry.faces[0]
  const ready = usePreviewFontReady(family, face?.weight ?? 400, Boolean(face?.italic))
  const [points, setPoints] = useState<number[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [cell, setCell] = useState(readGlyphCellSize)
  const [selected, setSelected] = useState<number | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [contain, setContain] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 })
  const which = hasManagedInstall(entry) ? 'installed' : 'source'

  useEffect(() => {
    let cancelled = false
    setPoints(null)
    setFailed(false)
    void api
      .previewMeta(entry.id, which)
      .then((result) => {
        if (!cancelled) setPoints(displayableCodePoints(result.characterSet))
      })
      .catch(() => {
        if (!cancelled) {
          setPoints([])
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [entry.id, which, entry.sourceFingerprint])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) return

    function sync() {
      if (!node) return
      setViewport({
        width: node.clientWidth,
        height: node.clientHeight,
        scrollTop: node.scrollTop,
      })
    }

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    node.addEventListener('scroll', sync, { passive: true })
    return () => {
      observer.disconnect()
      node.removeEventListener('scroll', sync)
    }
  }, [points, cell, searchOpen])

  const shown = useMemo(() => filterGlyphs(points ?? [], query, contain), [points, query, contain])
  const { columns, track } = glyphGridLayout(viewport.width, cell, GAP)
  const rowHeight = track + GAP
  const groups = useMemo(() => groupGlyphs(shown), [shown])
  const layoutRows = useMemo(() => glyphSectionRows(groups, columns), [groups, columns])
  const { tops, totalHeight } = useMemo(
    () => glyphLayoutOffsets(layoutRows, rowHeight),
    [layoutRows, rowHeight],
  )
  const { start, end } = visibleGlyphRowRange(
    layoutRows,
    tops,
    viewport.scrollTop,
    viewport.height,
    rowHeight,
    OVERSCAN,
  )
  const visibleRows = layoutRows.slice(start, end)

  useEffect(() => {
    scrollerRef.current?.scrollTo(0, 0)
    setSelected(null)
    setSearchOpen(false)
    setQuery('')
    setContain(false)
  }, [entry.id])

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    scrollerRef.current?.scrollTo(0, 0)
  }, [query, contain])

  function closeSearch() {
    setSearchOpen(false)
    setQuery('')
  }

  function changeCell(next: number) {
    const size = clampGlyphCellSize(next)
    setCell(size)
    localStorage.setItem(GLYPH_CELL_KEY, String(size))
  }

  if (points === null) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center" role="status" aria-label="Loading glyphs">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70 motion-reduce:animate-none" />
      </div>
    )
  }

  if (failed) {
    return <p className="text-sm text-muted-foreground">Could not read glyphs from this font.</p>
  }

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No glyphs to show for this font.</p>
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <p className="shrink-0 text-sm text-muted-foreground">
            {query.trim()
              ? `${shown.length.toLocaleString()} of ${points.length.toLocaleString()} ${points.length === 1 ? 'glyph' : 'glyphs'}`
              : `${points.length.toLocaleString()} ${points.length === 1 ? 'glyph' : 'glyphs'}`}
          </p>
          {searchOpen ? (
            <>
              <Input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  event.stopPropagation()
                  closeSearch()
                }}
                placeholder="Search"
                aria-label="Search glyphs"
                autoFocus
                className="min-w-0 max-w-48 flex-1 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
              />
              <Label className="flex shrink-0 cursor-pointer items-center gap-1.5 font-normal">
                <input
                  type="checkbox"
                  checked={contain}
                  onChange={(event) => setContain(event.target.checked)}
                  className="size-3.5 rounded border border-input accent-primary"
                />
                Contain
              </Label>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                aria-label="Close search"
                onClick={closeSearch}
              >
                <X />
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              aria-label="Search glyphs"
              onClick={() => setSearchOpen(true)}
            >
              <Search />
            </Button>
          )}
        </div>
        <label className={cn('flex shrink-0 items-center gap-2 rounded-md border bg-background px-2.5', CONTROL_H)}>
          <span className="select-none text-[10px] leading-none text-muted-foreground" aria-hidden>
            A
          </span>
          <input
            type="range"
            min={GLYPH_CELL_MIN}
            max={GLYPH_CELL_MAX}
            step={GLYPH_CELL_STEP}
            value={cell}
            onChange={(event) => changeCell(Number(event.target.value))}
            aria-label="Glyph size"
            className="preview-size-slider w-24"
          />
          <span className="select-none text-sm leading-none text-muted-foreground" aria-hidden>
            A
          </span>
        </label>
      </div>
      <div
        ref={scrollerRef}
        className="min-h-0 w-full flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matching glyphs.</p>
        ) : (
          <TooltipProvider delayDuration={400} skipDelayDuration={200}>
            <div className="relative w-full" style={{ height: totalHeight }}>
              {visibleRows.map((row, offset) => {
                const index = start + offset
                const top = tops[index]
                if (row.kind === 'header') {
                  return (
                    <div
                      key={`h-${row.id}`}
                      className="absolute inset-x-0 flex items-end justify-between gap-2 pb-1"
                      style={{ top, height: GLYPH_GROUP_HEADER_HEIGHT }}
                    >
                      <h3 className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                        {row.label}
                      </h3>
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {row.count.toLocaleString()}
                      </span>
                    </div>
                  )
                }
                return (
                  <div
                    key={`r-${row.codes[0]}-${index}`}
                    className="absolute inset-x-0 grid"
                    style={{
                      top,
                      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                      gap: GAP,
                    }}
                  >
                    {row.codes.map((code) => (
                      <GlyphCell
                        key={code}
                        code={code}
                        family={family}
                        weight={face?.weight ?? 400}
                        italic={Boolean(face?.italic)}
                        ready={ready}
                        cell={track}
                        onOpen={() => setSelected(code)}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          </TooltipProvider>
        )}
      </div>
      <GlyphPreviewDialog
        entryId={entry.id}
        which={which}
        code={selected}
        family={family}
        weight={face?.weight ?? 400}
        italic={Boolean(face?.italic)}
        ready={ready}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
    </div>
  )
}

function GlyphCell({
  code,
  family,
  weight,
  italic,
  ready,
  cell,
  onOpen,
}: {
  code: number
  family: string
  weight: number
  italic: boolean
  ready: boolean
  cell: number
  onOpen: () => void
}) {
  const glyph = glyphCharacter(code)
  const name = fallbackGlyphName(code)
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${name}`}
          className={cn(
            'flex w-full min-w-0 items-center justify-center rounded-md border bg-muted/30 leading-none hover:bg-muted/60',
            !ready && 'text-transparent',
          )}
          style={{ height: cell, fontSize: glyphFontSize(cell) }}
        >
          <span
            className="font-preview select-none"
            style={{
              fontFamily: `"${family}", ui-sans-serif, system-ui`,
              fontWeight: weight,
              fontStyle: italic ? 'italic' : 'normal',
              fontSynthesis: 'none',
            }}
          >
            {glyph}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{name}</TooltipContent>
    </Tooltip>
  )
}

function GlyphPreviewDialog({
  entryId,
  which,
  code,
  family,
  weight,
  italic,
  ready,
  onOpenChange,
}: {
  entryId: string
  which: 'source' | 'installed'
  code: number | null
  family: string
  weight: number
  italic: boolean
  ready: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [fontName, setFontName] = useState<string | null>(null)
  const glyph = code == null ? '' : glyphCharacter(code)
  const unicode = code == null ? '' : codePointLabel(code)
  const html = code == null ? '' : htmlCode(code)
  const name =
    code == null
      ? ''
      : glyphDisplayName(code, fontName)

  useEffect(() => {
    if (code == null) {
      setFontName(null)
      return
    }
    let cancelled = false
    setFontName(null)
    void api
      .previewGlyph(entryId, code, which)
      .then((result) => {
        if (!cancelled) setFontName(result.name)
      })
      .catch(() => {
        if (!cancelled) setFontName(null)
      })
    return () => {
      cancelled = true
    }
  }, [entryId, which, code])

  return (
    <Dialog open={code != null} onOpenChange={onOpenChange}>
      <DialogContent className="app-region-no-drag w-[min(92vw,22rem)] pt-10" data-keep-selection="">
        <DialogHeader className="sr-only mb-0">
          <DialogTitle>{name || unicode}</DialogTitle>
        </DialogHeader>
        {code != null ? (
          <div className="space-y-1">
            <CopyRow
              label="Glyph"
              value={
                <span
                  className={cn('font-preview leading-none', !ready && 'text-transparent')}
                  style={{
                    fontFamily: `"${family}", ui-sans-serif, system-ui`,
                    fontWeight: weight,
                    fontStyle: italic ? 'italic' : 'normal',
                    fontSynthesis: 'none',
                    fontSize: 72,
                  }}
                >
                  {glyph}
                </span>
              }
              copyValue={glyph}
              preview
            />
            <CopyRow label="Name" value={name} copyValue={name} />
            <CopyRow label="Unicode" value={unicode} copyValue={unicode} />
            <CopyRow label="HTML" value={html} copyValue={html} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function CopyRow({
  label,
  value,
  copyValue,
  preview = false,
}: {
  label: string
  value: ReactNode
  copyValue: string
  preview?: boolean
}) {
  const copyIcon = (
    <Copy className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
  )
  return (
    <button
      type="button"
      onClick={() => void copyText(copyValue)}
      aria-label={`Copy ${label.toLowerCase()}`}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/60',
        preview && 'py-4',
      )}
    >
      {preview ? (
        <>
          <span className="size-3.5 shrink-0" aria-hidden />
          <span className="flex min-w-0 flex-1 items-center justify-center">{value}</span>
          {copyIcon}
        </>
      ) : (
        <>
          <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
          <span className="min-w-0 flex-1 truncate text-right font-mono text-sm">{value}</span>
          {copyIcon}
        </>
      )}
    </button>
  )
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.message('Copied')
  } catch {
    toast.error('Could not copy')
  }
}

function glyphDisplayName(code: number, fontName: string | null): string {
  const fallback = fallbackGlyphName(code)
  if (fallback !== codePointLabel(code)) return fallback
  return fontName || fallback
}

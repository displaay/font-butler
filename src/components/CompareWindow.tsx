import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { getApiToken } from '@/lib/api'
import { signFontAccess, withFontAccessQuery } from '@/lib/font-access'
import {
  COMPARE_LIMIT,
  COMPARE_PLACEHOLDER,
  COMPARE_SIZE_MAX,
  COMPARE_SIZE_MIN,
  COMPARE_TINTS,
  compareCandidates,
  compareCssFamily,
  compareSizeStep,
  familyIdForName,
  isCompareFull,
  resolvedCompareFace,
  type CompareFamily,
  type CompareLayout,
  type CompareModel,
} from '@/lib/compare'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

export type CompareLibraryFamily = {
  name: string
  paths: string[]
}

export function CompareWindow({
  model,
  layout,
  text,
  size,
  libraryFamilies,
  onLayout,
  onText,
  onSize,
  onClose,
  onAddFamilies,
  onRemoveFamily,
  onRemoveEntry,
  onStyle,
  onAnotherStyle,
  onTint,
  onMove,
  onOpenFiles,
}: {
  model: CompareModel
  layout: CompareLayout
  text: string
  size: number
  libraryFamilies: CompareLibraryFamily[]
  onLayout: (layout: CompareLayout) => void
  onText: (text: string) => void
  onSize: (size: number) => void
  onClose: () => void
  onAddFamilies: (paths: string[]) => void
  onRemoveFamily: (familyId: string) => void
  onRemoveEntry: (entryId: string) => void
  onStyle: (entryId: string, styleId: string | null) => void
  onAnotherStyle: (entryId: string) => void
  onTint: (entryId: string, tint: number) => void
  onMove: (entryId: string, beforeId: string) => void
  onOpenFiles: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const sample = text.trim() ? text : COMPARE_PLACEHOLDER
  const full = isCompareFull(model)

  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.compareFonts = 'true'
    document.head.appendChild(style)
    let cancelled = false
    void (async () => {
      try {
        const secret = await getApiToken()
        const rules: string[] = []
        for (const family of model.families) {
          for (const face of family.faces) {
            const access = await signFontAccess(secret, { kind: 'compare-font', path: face.filePath })
            const url = withFontAccessQuery(
              `/api/compare-font?${new URLSearchParams({ path: face.filePath })}`,
              access,
            )
            const weight = face.isVariable ? '1 1000' : String(face.weight || 400)
            const slant = face.italic ? 'italic' : 'normal'
            rules.push(
              `@font-face{font-family:"${compareCssFamily(face.id)}";src:url("${url}");font-weight:${weight};font-style:${slant};font-display:swap;}`,
            )
          }
        }
        if (!cancelled) style.textContent = rules.join('\n')
      } catch {
        if (!cancelled) style.textContent = ''
      }
    })()
    return () => {
      cancelled = true
      style.remove()
    }
  }, [model.families])

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-background text-foreground">
      <header className="app-region-drag flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 pt-8">
        <div className="app-region-no-drag relative">
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding((open) => !open)}>
            <Plus /> Add Families
          </Button>
          {adding ? (
            <AddFamilies
              libraryFamilies={libraryFamilies}
              model={model}
              full={full}
              onAdd={(paths) => onAddFamilies(paths)}
              onRemove={onRemoveFamily}
            />
          ) : null}
        </div>
        <div className="app-region-no-drag flex rounded-md border p-0.5" role="group" aria-label="Layout">
          {(['stacked', 'overlay'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={cn(
                'rounded px-2 py-1 text-xs',
                layout === value ? 'bg-muted font-medium' : 'text-muted-foreground',
              )}
              aria-pressed={layout === value}
              onClick={() => onLayout(value)}
            >
              {value === 'stacked' ? 'Stacked' : 'Overlay'}
            </button>
          ))}
        </div>
        <div className="app-region-no-drag relative">
          <Button type="button" size="sm" variant="outline" onClick={() => setOptionsOpen((open) => !open)}>
            Preview Options
          </Button>
          {optionsOpen ? (
            <div className="absolute top-full left-0 z-20 mt-1 w-72 rounded-md border bg-background p-3 shadow-md">
              <label className="mb-1 block text-xs text-muted-foreground" htmlFor="compare-text">
                Preview Text
              </label>
              <Input
                id="compare-text"
                value={text}
                placeholder={COMPARE_PLACEHOLDER}
                onChange={(event) => onText(event.target.value)}
              />
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>Size</span>
                <span>{size} pt</span>
              </div>
              <Slider
                aria-label="Size"
                min={COMPARE_SIZE_MIN}
                max={COMPARE_SIZE_MAX}
                value={size}
                onChange={(event) => onSize(Number(event.target.value))}
              />
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => onSize(compareSizeStep(size, -1))}>
                  Zoom Out
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => onSize(compareSizeStep(size, 1))}>
                  Zoom In
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex-1" />
        <Button type="button" size="sm" variant="ghost" className="app-region-no-drag" onClick={onClose}>
          Close
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {model.entries.length === 0 ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-center">
            <p className="text-lg font-medium">Nothing to Compare</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Add families from anywhere in your library, choose Compare with families selected, or drop font files
              here.
            </p>
            <div className="flex gap-2">
              <Button type="button" onClick={() => setAdding(true)}>
                Add Families
              </Button>
              <Button type="button" variant="outline" onClick={onOpenFiles}>
                Open Fonts…
              </Button>
            </div>
          </div>
        ) : layout === 'stacked' ? (
          <div className="flex flex-col gap-5">
            {model.entries.map((entry) => {
              const family = model.families.find((item) => item.id === entry.familyId)
              if (!family) return null
              return (
                <div
                  key={entry.id}
                  draggable
                  onDragStart={() => setDragId(entry.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragId) onMove(dragId, entry.id)
                    setDragId(null)
                  }}
                >
                  <Sample family={family} entryId={entry.id} styleId={entry.styleId} text={sample} size={size} />
                  <Caption
                    family={family}
                    entry={entry}
                    full={full}
                    showsTint={false}
                    onStyle={onStyle}
                    onAnotherStyle={onAnotherStyle}
                    onTint={onTint}
                    onRemove={() => onRemoveEntry(entry.id)}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <OverlaySamples
            model={model}
            text={sample}
            size={size}
            full={full}
            dragId={dragId}
            onDrag={setDragId}
            onMove={onMove}
            onStyle={onStyle}
            onAnotherStyle={onAnotherStyle}
            onTint={onTint}
            onRemove={onRemoveEntry}
          />
        )}
      </div>
    </div>
  )
}

function Sample({
  family,
  entryId,
  styleId,
  text,
  size,
  color,
}: {
  family: CompareFamily
  entryId: string
  styleId: string | null
  text: string
  size: number
  color?: string
}) {
  const face = resolvedCompareFace({ id: entryId, familyId: family.id, styleId, tint: 0 }, family)
  if (!face) return null
  return (
    <p
      className="m-0 whitespace-nowrap"
      style={{
        fontFamily: `"${compareCssFamily(face.id)}"`,
        fontSize: size,
        lineHeight: 1.15,
        fontWeight: face.isVariable ? face.weight : undefined,
        fontStyle: face.italic ? 'italic' : 'normal',
        color,
      }}
    >
      {text}
    </p>
  )
}

function Caption({
  family,
  entry,
  full,
  showsTint,
  onStyle,
  onAnotherStyle,
  onTint,
  onRemove,
}: {
  family: CompareFamily
  entry: CompareModel['entries'][number]
  full: boolean
  showsTint: boolean
  onStyle: (entryId: string, styleId: string | null) => void
  onAnotherStyle: (entryId: string) => void
  onTint: (entryId: string, tint: number) => void
  onRemove: () => void
}) {
  const face = resolvedCompareFace(entry, family)
  const tint = COMPARE_TINTS[entry.tint] ?? COMPARE_TINTS[0]
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-sm">
      {showsTint ? (
        <label className="relative inline-flex" title="Choose a color">
          <span className="size-2 rounded-full" style={{ background: tint.color }} />
          <select
            aria-label="Color"
            className="absolute inset-0 cursor-pointer opacity-0"
            value={entry.tint}
            onChange={(event) => onTint(entry.id, Number(event.target.value))}
          >
            {COMPARE_TINTS.map((item, index) => (
              <option key={item.title} value={index}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <span className="font-semibold">{family.name}</span>
      <select
        aria-label={`Style for ${family.name}`}
        className="bg-transparent text-muted-foreground"
        value={entry.styleId ?? ''}
        onChange={(event) => {
          if (event.target.value === '__another__') {
            onAnotherStyle(entry.id)
            return
          }
          onStyle(entry.id, event.target.value || null)
        }}
      >
        <option value="">Automatic{face ? ` (${face.styleName})` : ''}</option>
        {family.faces.map((item) => (
          <option key={item.id} value={item.id}>
            {item.styleName}
          </option>
        ))}
        {family.faces.length > 1 ? (
          <option value="__another__" disabled={full}>
            Another Style
          </option>
        ) : null}
      </select>
      <button type="button" className="text-muted-foreground" title="Remove from Compare" onClick={onRemove}>
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function OverlaySamples({
  model,
  text,
  size,
  full,
  dragId,
  onDrag,
  onMove,
  onStyle,
  onAnotherStyle,
  onTint,
  onRemove,
}: {
  model: CompareModel
  text: string
  size: number
  full: boolean
  dragId: string | null
  onDrag: (id: string | null) => void
  onMove: (entryId: string, beforeId: string) => void
  onStyle: (entryId: string, styleId: string | null) => void
  onAnotherStyle: (entryId: string) => void
  onTint: (entryId: string, tint: number) => void
  onRemove: (entryId: string) => void
}) {
  const rows = model.entries.flatMap((entry) => {
    const family = model.families.find((item) => item.id === entry.familyId)
    return family ? [{ entry, family }] : []
  })
  return (
    <div>
      <div className="relative" style={{ minHeight: size * 1.4 }}>
        {rows.map(({ entry, family }, index) => {
          const tint = COMPARE_TINTS[entry.tint] ?? COMPARE_TINTS[0]
          return (
            <div
              key={entry.id}
              className={cn('compare-overlay-ink pointer-events-none', index === 0 ? 'relative' : 'absolute inset-0')}
            >
              <Sample
                family={family}
                entryId={entry.id}
                styleId={entry.styleId}
                text={text}
                size={size}
                color={tint.color}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {rows.map(({ entry, family }) => (
          <div
            key={entry.id}
            className="rounded-full bg-muted px-2.5 py-1"
            draggable
            onDragStart={() => onDrag(entry.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragId) onMove(dragId, entry.id)
              onDrag(null)
            }}
          >
            <Caption
              family={family}
              entry={entry}
              full={full}
              showsTint
              onStyle={onStyle}
              onAnotherStyle={onAnotherStyle}
              onTint={onTint}
              onRemove={() => onRemove(entry.id)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function AddFamilies({
  libraryFamilies,
  model,
  full,
  onAdd,
  onRemove,
}: {
  libraryFamilies: CompareLibraryFamily[]
  model: CompareModel
  full: boolean
  onAdd: (paths: string[]) => void
  onRemove: (familyId: string) => void
}) {
  const [query, setQuery] = useState('')
  const listed = useMemo(() => compareCandidates(libraryFamilies, query), [libraryFamilies, query])
  const compared = new Set(model.families.map((family) => family.name.toLocaleLowerCase()))
  return (
    <div className="absolute top-full left-0 z-20 mt-1 flex h-96 w-80 flex-col rounded-md border bg-background shadow-md">
      <div className="p-2">
        <Input
          autoFocus
          value={query}
          placeholder="Search"
          aria-label="Search"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {listed.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No Families Found</p>
        ) : (
          listed.map((family) => {
            const present = compared.has(family.name.toLocaleLowerCase())
            const disabled = full && !present
            return (
              <button
                key={family.name}
                type="button"
                disabled={disabled}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-40"
                onClick={() => {
                  if (present) onRemove(familyIdForName(family.name))
                  else onAdd(family.paths)
                }}
              >
                <span className="w-4">{present ? '✓' : ''}</span>
                <span className="truncate">{family.name}</span>
              </button>
            )
          })
        )}
      </div>
      {full ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Compare holds up to {COMPARE_LIMIT} styles. Take one out to add another.
        </p>
      ) : (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Or drop font files onto this window, including fonts that are not in the library.
        </p>
      )}
    </div>
  )
}

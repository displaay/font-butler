import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api } from '@/lib/api'
import {
  catalogEntryPickerLabel,
  catalogGroupsForLinkPicker,
  familyPickerSubtitle,
} from '@/lib/finder-link'
import { FONT_FILE_ACCEPT } from '@/lib/results'
import type { CatalogEntry, FamilyGroup, RelinkPreview } from '@/lib/types'
import { cn } from '@/lib/utils'

export function RelinkDialog({
  open,
  entry,
  mode,
  sourcePath,
  remainingCount = 0,
  catalog = [],
  onOpenChange,
  onDone,
}: {
  open: boolean
  entry: CatalogEntry | null
  mode: 'locate' | 'link' | 'link-to'
  sourcePath?: string
  remainingCount?: number
  catalog?: CatalogEntry[]
  onOpenChange: (open: boolean) => void
  onDone: (entry: CatalogEntry) => void
}) {
  const [path, setPath] = useState('')
  const [query, setQuery] = useState('')
  const [pickedGroupKey, setPickedGroupKey] = useState<string | null>(null)
  const [pickedEntry, setPickedEntry] = useState<CatalogEntry | null>(null)
  const [familyPreviews, setFamilyPreviews] = useState<RelinkPreview[]>([])
  const [preview, setPreview] = useState<RelinkPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [linkSource, setLinkSource] = useState(sourcePath)
  const catalogRef = useRef(catalog)
  const linkTo = mode === 'link-to'
  const title = linkTo ? 'Link to …' : mode === 'link' ? 'Link source…' : 'Locate source…'
  const allGroups = useMemo(
    () => (linkTo ? catalogGroupsForLinkPicker(catalog, '') : []),
    [catalog, linkTo],
  )
  const groups = useMemo(
    () => (linkTo ? catalogGroupsForLinkPicker(catalog, query) : []),
    [catalog, linkTo, query],
  )
  const pickedGroup = allGroups.find((group) => group.key === pickedGroupKey) ?? null
  const target = linkTo ? pickedEntry : entry
  const candidatePath = linkTo ? (sourcePath ?? '').trim() : path

  if (open && linkTo && sourcePath !== linkSource) {
    setLinkSource(sourcePath)
    setPickedEntry(null)
    setFamilyPreviews([])
    setPreview(null)
    setBusy(false)
  }

  useEffect(() => {
    catalogRef.current = catalog
  }, [catalog])

  useEffect(() => {
    if (!open || !linkTo || !sourcePath?.trim() || !pickedGroupKey) return
    const group = catalogGroupsForLinkPicker(catalogRef.current, '').find((item) => item.key === pickedGroupKey)
    if (!group) return
    let cancelled = false
    setBusy(true)
    void (async () => {
      const results: RelinkPreview[] = []
      for (const item of group.entries) {
        try {
          results.push(await api.inspectRelink(item.id, sourcePath.trim()))
        } catch {
          // Skip entries that cannot be inspected; the picker still lists them.
        }
      }
      if (cancelled) return
      setFamilyPreviews(results)
      const matches = results.filter((row) => row.identityMatch)
      if (matches.length === 1) {
        const match = matches[0]!
        setPickedEntry(group.entries.find((item) => item.id === match.entryId) ?? null)
        setPreview(match)
      } else {
        setPickedEntry(null)
        setPreview(null)
      }
      setBusy(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open, linkTo, sourcePath, pickedGroupKey])

  async function inspect(nextPath: string, nextEntry = target) {
    if (!nextEntry || !nextPath.trim()) return
    setBusy(true)
    try {
      setPreview(await api.inspectRelink(nextEntry.id, nextPath.trim()))
    } catch (error) {
      setPreview(null)
      toast.error(error instanceof Error ? error.message : 'That file cannot be linked.')
    } finally {
      setBusy(false)
    }
  }

  async function pickFile() {
    const picked = await window.fontButlerDesktop?.pickFile?.()
    if (!picked) return
    setPath(picked)
    await inspect(picked)
  }

  function pickGroup(group: FamilyGroup) {
    setPickedGroupKey(group.key)
    setPickedEntry(null)
    setPreview(null)
    setFamilyPreviews([])
  }

  function pickCatalogEntry(item: CatalogEntry) {
    setPickedEntry(item)
    const existing = familyPreviews.find((row) => row.entryId === item.id)
    if (existing) {
      setPreview(existing)
      return
    }
    void inspect(candidatePath, item)
  }

  async function apply() {
    if (!target || !preview?.identityMatch) return
    setBusy(true)
    try {
      const result = await api.applyRelink(target.id, preview.proposedPath)
      onDone(result.entry)
      if (linkTo && remainingCount > 0) {
        return
      }
      onOpenChange(false)
      setPreview(null)
      setPath('')
      setPickedEntry(null)
      setPickedGroupKey(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not relink the source.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPreview(null)
          setPath('')
          setQuery('')
          setPickedGroupKey(null)
          setPickedEntry(null)
          setFamilyPreviews([])
          setLinkSource(undefined)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className={cn('w-[min(92vw,560px)]', linkTo && 'max-h-[min(90vh,740px)] overflow-y-auto')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {linkTo
              ? 'Choose a catalog family to attach this file as the tracked source. Installation stays a separate action.'
              : 'Relinking updates the tracked source only. Installation stays a separate action.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {linkTo ? (
            <LinkToPicker
              path={candidatePath}
              remainingCount={remainingCount}
              query={query}
              groups={groups}
              pickedGroup={pickedGroup}
              pickedEntry={pickedEntry}
              familyPreviews={familyPreviews}
              busy={busy}
              catalogEmpty={catalog.length === 0}
              onQueryChange={setQuery}
              onPickGroup={pickGroup}
              onPickEntry={pickCatalogEntry}
            />
          ) : (
            <div className="flex gap-2">
              <Input
                value={path}
                accept={FONT_FILE_ACCEPT}
                placeholder="/Users/you/Fonts/Family-Regular.otf"
                aria-label="Source file path"
                onChange={(event) => setPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void inspect(path)
                  }
                }}
              />
              {window.fontButlerDesktop?.pickFile ? (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void pickFile()}>
                  <FolderOpen /> Choose
                </Button>
              ) : (
                <Button type="button" variant="outline" disabled={busy || !path.trim()} onClick={() => void inspect(path)}>
                  Inspect
                </Button>
              )}
            </div>
          )}
          {preview && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Current</dt>
              <dd className="truncate font-mono text-xs" title={preview.oldPath}>
                {preview.oldPath}
              </dd>
              <dt className="text-muted-foreground">Proposed</dt>
              <dd className="truncate font-mono text-xs" title={preview.proposedPath}>
                {preview.proposedPath}
              </dd>
              <dt className="text-muted-foreground">Identity</dt>
              <dd>{preview.identityMatch ? 'Matches this font' : 'Does not match'}</dd>
              <dt className="text-muted-foreground">Format</dt>
              <dd className="uppercase">{preview.format}</dd>
              <dt className="text-muted-foreground">Bytes</dt>
              <dd>{preview.bytesDiffer ? 'Different from the installed copy' : 'Same as the installed copy'}</dd>
              {preview.reason ? (
                <>
                  <dt className="text-muted-foreground">Note</dt>
                  <dd>{preview.reason}</dd>
                </>
              ) : null}
            </dl>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !preview?.identityMatch} onClick={() => void apply()}>
              Link source
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LinkToPicker({
  path,
  remainingCount,
  query,
  groups,
  pickedGroup,
  pickedEntry,
  familyPreviews,
  busy,
  catalogEmpty,
  onQueryChange,
  onPickGroup,
  onPickEntry,
}: {
  path: string
  remainingCount: number
  query: string
  groups: FamilyGroup[]
  pickedGroup: FamilyGroup | null
  pickedEntry: CatalogEntry | null
  familyPreviews: RelinkPreview[]
  busy: boolean
  catalogEmpty: boolean
  onQueryChange: (value: string) => void
  onPickGroup: (group: FamilyGroup) => void
  onPickEntry: (entry: CatalogEntry) => void
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/40 px-2.5 py-2">
        <div className="text-xs text-muted-foreground">Finder file</div>
        <div className="truncate font-mono text-xs" title={path || undefined}>
          {path || 'No file selected'}
        </div>
        {remainingCount > 0 ? (
          <div className="pt-1 text-xs text-muted-foreground">
            {remainingCount === 1 ? '1 more file after this one' : `${remainingCount} more files after this one`}
          </div>
        ) : null}
      </div>
      <Input
        value={query}
        placeholder="Search catalog families"
        aria-label="Search catalog families"
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {catalogEmpty ? 'Nothing in the library to link to yet.' : 'Nothing in the library matches that search.'}
        </p>
      ) : (
        <ScrollArea className="h-[min(32vh,220px)] rounded-md border">
          <div className="p-1">
            {groups.map((group) => {
              const active = pickedGroup?.key === group.key
              return (
                <button
                  key={group.key}
                  type="button"
                  disabled={busy}
                  onClick={() => onPickGroup(group)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left',
                    active ? 'bg-muted' : 'hover:bg-muted/50',
                  )}
                >
                  <span className="truncate text-sm font-medium">{group.familyName}</span>
                  <span className="shrink-0 pl-3 text-xs text-muted-foreground">{familyPickerSubtitle(group)}</span>
                </button>
              )
            })}
          </div>
        </ScrollArea>
      )}
      {pickedGroup ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Choose a style to attach this file to</div>
          {pickedGroup.entries.map((item) => {
            const active = pickedEntry?.id === item.id
            const row = familyPreviews.find((preview) => preview.entryId === item.id)
            return (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                onClick={() => onPickEntry(item)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors',
                  active ? 'border-foreground bg-muted/60' : 'border-border hover:bg-muted/40',
                )}
              >
                <div>
                  <div className="text-sm font-medium">{catalogEntryPickerLabel(item)}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground" title={item.sourcePath}>
                    {item.sourcePath}
                  </div>
                </div>
                <span className="shrink-0 pl-3 text-xs text-muted-foreground">
                  {row ? (row.identityMatch ? 'Matches' : 'Does not match') : 'Inspect'}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

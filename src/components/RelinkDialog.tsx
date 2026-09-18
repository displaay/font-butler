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
  currentFinderLinkAssignment,
  familyPickerSubtitle,
  finderLinkStyleStatus,
  pairFinderFilesToFamily,
  unmatchedFinderLinkCount,
  unmatchedFinderLinkMessage,
  type FinderLinkAssignment,
} from '@/lib/finder-link'
import { FONT_FILE_ACCEPT } from '@/lib/results'
import type { CatalogEntry, FamilyGroup, RelinkPreview } from '@/lib/types'
import { cn } from '@/lib/utils'

export function RelinkDialog({
  open,
  entry,
  mode,
  sourcePath,
  paths = [],
  remainingCount = 0,
  catalog = [],
  onOpenChange,
  onDone,
  onAdvance,
}: {
  open: boolean
  entry: CatalogEntry | null
  mode: 'locate' | 'link' | 'link-to'
  sourcePath?: string
  paths?: string[]
  remainingCount?: number
  catalog?: CatalogEntry[]
  onOpenChange: (open: boolean) => void
  onDone: (entry: CatalogEntry) => void
  onAdvance?: (path: string) => void
}) {
  const [path, setPath] = useState('')
  const [query, setQuery] = useState('')
  const [pickedGroupKey, setPickedGroupKey] = useState<string | null>(null)
  const [pickedEntry, setPickedEntry] = useState<CatalogEntry | null>(null)
  const [familyPreviews, setFamilyPreviews] = useState<RelinkPreview[]>([])
  const [preview, setPreview] = useState<RelinkPreview | null>(null)
  const [assignments, setAssignments] = useState<FinderLinkAssignment[]>([])
  const [busy, setBusy] = useState(false)
  const catalogRef = useRef(catalog)
  const onAdvanceRef = useRef(onAdvance)
  const unmatchedToastFamilyRef = useRef<string | null>(null)
  const skippedPathRef = useRef<string | null>(null)
  const linkTo = mode === 'link-to'
  const title = linkTo ? 'Link to …' : mode === 'link' ? 'Link source…' : 'Locate source…'
  const queuedPaths = useMemo(() => {
    if (!linkTo) return []
    if (paths.length > 0) return paths
    const single = sourcePath?.trim()
    return single ? [single] : []
  }, [linkTo, paths, sourcePath])
  const pathsKey = queuedPaths.join('\0')
  const allGroups = useMemo(
    () => (linkTo ? catalogGroupsForLinkPicker(catalog, '') : []),
    [catalog, linkTo],
  )
  const groups = useMemo(
    () => (linkTo ? catalogGroupsForLinkPicker(catalog, query) : []),
    [catalog, linkTo, query],
  )
  const pickedGroup = allGroups.find((group) => group.key === pickedGroupKey) ?? null
  const active = linkTo ? currentFinderLinkAssignment(assignments) : null
  const target = linkTo ? pickedEntry : entry
  const candidatePath = linkTo ? (active?.path ?? queuedPaths[0] ?? '').trim() : path
  const leftoverCount = unmatchedFinderLinkCount(assignments)
  const shownRemaining = Math.max(remainingCount, Math.max(0, queuedPaths.length - 1))

  useEffect(() => {
    catalogRef.current = catalog
  }, [catalog])

  useEffect(() => {
    onAdvanceRef.current = onAdvance
  }, [onAdvance])

  useEffect(() => {
    if (!open || !linkTo || !pickedGroupKey || !pathsKey) return
    const group = catalogGroupsForLinkPicker(catalogRef.current, '').find((item) => item.key === pickedGroupKey)
    if (!group) return
    const files = pathsKey ? pathsKey.split('\0') : []
    if (files.length === 0) return
    let cancelled = false
    setBusy(true)
    void (async () => {
      const inspects: Record<string, RelinkPreview[]> = {}
      for (const filePath of files) {
        inspects[filePath] = []
        for (const item of group.entries) {
          try {
            inspects[filePath].push(await api.inspectRelink(item.id, filePath))
          } catch {
            // Skip entries that cannot be inspected; pairing still uses the rest.
          }
        }
      }
      if (cancelled) return
      const next = pairFinderFilesToFamily(files, group.entries, inspects)
      setAssignments(next)
      const current = currentFinderLinkAssignment(next)
      setFamilyPreviews(current?.path ? (inspects[current.path] ?? []) : [])
      if (unmatchedToastFamilyRef.current !== pickedGroupKey) {
        unmatchedToastFamilyRef.current = pickedGroupKey
        const leftover = unmatchedFinderLinkCount(next)
        if (leftover > 0) toast(unmatchedFinderLinkMessage(leftover))
      }
      if (current?.status === 'already-linked') {
        const skipPath = current.path
        if (skippedPathRef.current !== skipPath) {
          skippedPathRef.current = skipPath
          setPickedEntry(group.entries.find((item) => item.id === current.entryId) ?? null)
          setPreview(current.preview ?? null)
          toast('Already linked')
          onAdvanceRef.current?.(skipPath)
        }
        setBusy(false)
        return
      }
      if (current?.status === 'pair' && current.entryId && current.preview) {
        setPickedEntry(group.entries.find((item) => item.id === current.entryId) ?? null)
        setPreview(current.preview)
      } else {
        setPickedEntry(null)
        setPreview(null)
      }
      setBusy(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open, linkTo, pickedGroupKey, pathsKey])

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
    unmatchedToastFamilyRef.current = null
    skippedPathRef.current = null
    setPickedGroupKey(group.key)
    setPickedEntry(null)
    setPreview(null)
    setFamilyPreviews([])
    setAssignments([])
  }

  function pickCatalogEntry(item: CatalogEntry) {
    if (active?.status === 'already-linked') return
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
    if (linkTo && active?.status !== 'pair') return
    setBusy(true)
    try {
      const result = await api.applyRelink(target.id, preview.proposedPath)
      const linkedPath = candidatePath
      onDone(result.entry)
      if (linkTo) {
        onAdvance?.(linkedPath)
        if (queuedPaths.length > 1) return
      }
      onOpenChange(false)
      setPreview(null)
      setPath('')
      setPickedEntry(null)
      setPickedGroupKey(null)
      setAssignments([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not relink the source.')
    } finally {
      setBusy(false)
    }
  }

  function resetPicker() {
    setPreview(null)
    setPath('')
    setQuery('')
    setPickedGroupKey(null)
    setPickedEntry(null)
    setFamilyPreviews([])
    setAssignments([])
    unmatchedToastFamilyRef.current = null
    skippedPathRef.current = null
  }

  const canApply = Boolean(
    preview?.identityMatch && (!linkTo || active?.status === 'pair') && !busy,
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetPicker()
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
              remainingCount={shownRemaining}
              leftoverCount={leftoverCount}
              query={query}
              groups={groups}
              pickedGroup={pickedGroup}
              pickedEntry={pickedEntry}
              familyPreviews={familyPreviews}
              assignment={active}
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
              <dd>
                {active?.status === 'already-linked'
                  ? 'Already linked'
                  : preview.identityMatch
                    ? 'Matches this font'
                    : 'Does not match'}
              </dd>
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
            <Button disabled={!canApply} onClick={() => void apply()}>
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
  leftoverCount,
  query,
  groups,
  pickedGroup,
  pickedEntry,
  familyPreviews,
  assignment,
  busy,
  catalogEmpty,
  onQueryChange,
  onPickGroup,
  onPickEntry,
}: {
  path: string
  remainingCount: number
  leftoverCount: number
  query: string
  groups: FamilyGroup[]
  pickedGroup: FamilyGroup | null
  pickedEntry: CatalogEntry | null
  familyPreviews: RelinkPreview[]
  assignment: FinderLinkAssignment | null
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
        {leftoverCount > 0 ? (
          <div className="pt-1 text-xs text-muted-foreground">{unmatchedFinderLinkMessage(leftoverCount)}</div>
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
            const selected = pickedEntry?.id === item.id
            const row = familyPreviews.find((itemPreview) => itemPreview.entryId === item.id)
            return (
              <button
                key={item.id}
                type="button"
                disabled={busy || assignment?.status === 'already-linked'}
                onClick={() => onPickEntry(item)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors',
                  selected ? 'border-foreground bg-muted/60' : 'border-border hover:bg-muted/40',
                )}
              >
                <div>
                  <div className="text-sm font-medium">{catalogEntryPickerLabel(item)}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground" title={item.sourcePath}>
                    {item.sourcePath}
                  </div>
                </div>
                <span className="shrink-0 pl-3 text-xs text-muted-foreground">
                  {finderLinkStyleStatus(row, assignment)}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Search } from 'lucide-react'
import { AaPreview } from '@/components/AaPreview'
import { StatusBadge, VfBadge } from '@/components/Badges'
import { FontFaceStyles, catalogFontFamily, systemFontFamily } from '@/components/FontFaceStyles'
import { InstanceList } from '@/components/InstanceList'
import { Inspector } from '@/components/Inspector'
import { RenameDialog } from '@/components/RenameDialog'
import { ViewOptions, type ViewLayout } from '@/components/ViewOptions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, isNotice, subscribeEvents } from '@/lib/api'
import { familyNameOf, entryIds, familyStatusSummary, groupCatalog, groupSystem, hasSourceMissing, isInactiveEntry, isLibraryEntry, matchesQuery, sourceMissingIds } from '@/lib/group'
import { catalogInstanceRows, systemInstanceRows } from '@/lib/instances'
import type { CatalogEntry, FamilyGroup, SystemFace, SystemFamilyGroup } from '@/lib/types'
import { cn } from '@/lib/utils'

type Tab = 'library' | 'system' | 'uninstalled' | 'updates'

const TABS: { id: Tab; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'system', label: 'On this Mac' },
  { id: 'uninstalled', label: 'Uninstalled' },
  { id: 'updates', label: 'Updates' },
]

export default function App() {
  const [entries, setEntries] = useState<CatalogEntry[]>([])
  const [systemFaces, setSystemFaces] = useState<SystemFace[]>([])
  const [tab, setTab] = useState<Tab>('library')
  const [query, setQuery] = useState('')
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null)
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [renameEntry, setRenameEntry] = useState<CatalogEntry | null>(null)
  const [showSources, setShowSources] = useState(
    () => localStorage.getItem('fontcase-show-sources') === 'true',
  )
  const [viewLayout, setViewLayout] = useState<ViewLayout>(() =>
    localStorage.getItem('fontcase-view-layout') === 'grid' ? 'grid' : 'list',
  )

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        await api.bootstrap()
        const openPath = new URLSearchParams(window.location.search).get('open')
        if (openPath) {
          const opened = await api.open(openPath)
          toast.success(`Installed ${familyNameOf(opened.entry)}`)
        }
        const catalog = await api.catalog()
        if (!cancelled) {
          setEntries(catalog.entries)
          const focus =
            (openPath && catalog.entries.find((entry) => entry.sourcePath === openPath)) ||
            catalog.entries[0]
          if (focus) {
            setSelectedFamily((current) => current ?? familyNameOf(focus))
            setSelectedEntryId((current) => current ?? focus.id)
          }
        }
        const system = await api.system()
        if (!cancelled) setSystemFaces(system.faces)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load fonts')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void boot()
    const stop = subscribeEvents((event) => {
      if (isNotice(event)) {
        toast[event.notice.kind === 'error' ? 'error' : 'success'](event.notice.message)
        if (event.notice.entryId) {
          setEntries((current) => {
            const match = current.find((entry) => entry.id === event.notice.entryId)
            if (match) setSelectedFamily(familyNameOf(match))
            return current
          })
        }
        return
      }
      if (event && typeof event === 'object' && (event as { type?: string }).type === 'catalog') {
        setEntries((event as { entries: CatalogEntry[] }).entries)
      }
      if (event && typeof event === 'object' && (event as { type?: string }).type === 'system') {
        setSystemFaces((event as { faces: SystemFace[] }).faces)
      }
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  const libraryGroups = useMemo(
    () =>
      groupCatalog(entries.filter(isLibraryEntry)).filter((group) =>
        matchesQuery(`${group.familyName} ${group.faces.map((face) => face.styleName).join(' ')}`, query),
      ),
    [entries, query],
  )
  const uninstalledGroups = useMemo(
    () =>
      groupCatalog(entries.filter(isInactiveEntry)).filter((group) =>
        matchesQuery(group.familyName, query),
      ),
    [entries, query],
  )
  const updateGroups = useMemo(
    () =>
      groupCatalog(entries.filter((entry) => entry.status === 'outdated')).filter((group) =>
        matchesQuery(group.familyName, query),
      ),
    [entries, query],
  )
  const systemGroups = useMemo(
    () => groupSystem(systemFaces).filter((group) => matchesQuery(group.familyName, query)),
    [systemFaces, query],
  )
  const shownSystemGroups = query.trim() ? systemGroups : systemGroups.slice(0, 80)
  const missingSourceCount = useMemo(
    () => entries.filter((entry) => entry.status === 'source-missing').length,
    [entries],
  )

  const visibleGroups =
    tab === 'system' ? [] : tab === 'uninstalled' ? uninstalledGroups : tab === 'updates' ? updateGroups : libraryGroups
  const hasCatalogList =
    tab === 'system' ? shownSystemGroups.length > 0 : visibleGroups.length > 0
  const selectedGroup =
    visibleGroups.find((group) => group.familyName === selectedFamily) ?? visibleGroups[0] ?? null
  const selectedEntry =
    selectedGroup?.entries.find((entry) => entry.id === selectedEntryId) ??
    selectedGroup?.entries[0] ??
    null
  const selectedSystemGroup =
    tab === 'system'
      ? (shownSystemGroups.find((group) => group.familyName === selectedSystem) ??
        shownSystemGroups[0] ??
        null)
      : null

  useEffect(() => {
    if (tab !== 'system' && selectedGroup) {
      setSelectedFamily(selectedGroup.familyName)
      setSelectedEntryId((current) => {
        if (current && selectedGroup.entries.some((entry) => entry.id === current)) {
          return current
        }
        return selectedGroup.entries[0]?.id ?? null
      })
    }
    if (tab === 'system' && selectedSystemGroup) setSelectedSystem(selectedSystemGroup.familyName)
  }, [tab, selectedGroup, selectedSystemGroup])

  function selectGroup(group: FamilyGroup) {
    setSelectedFamily(group.familyName)
    setSelectedEntryId(group.entries[0]?.id ?? null)
  }

  function installGroup(group: FamilyGroup, familyName?: string) {
    const ids = entryIds(group)
    return ids.length > 1 ? api.installMany(ids, familyName) : api.install(ids[0], familyName)
  }

  function uninstallGroup(group: FamilyGroup) {
    const ids = entryIds(group)
    return ids.length > 1 ? api.uninstallMany(ids) : api.uninstall(ids[0])
  }

  function deactivateGroup(group: FamilyGroup) {
    const ids = entryIds(group)
    return ids.length > 1 ? api.deactivateMany(ids) : api.deactivate(ids[0])
  }

  function activateGroup(group: FamilyGroup) {
    const ids = entryIds(group)
    return ids.length > 1 ? api.activateMany(ids) : api.activate(ids[0])
  }

  function reinstallGroup(group: FamilyGroup) {
    const ids = entryIds(group)
    return ids.length > 1 ? api.reinstallMany(ids) : api.reinstall(ids[0])
  }

  function forgetGroup(group: FamilyGroup) {
    const ids = sourceMissingIds(group)
    if (ids.length === 0) {
      return Promise.resolve({ removed: 0 })
    }
    return ids.length > 1 ? api.forgetMany(ids) : api.forget(ids[0])
  }

  function forgetEntry(entry: CatalogEntry) {
    return api.forget(entry.id)
  }

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true)
    try {
      await action()
      if (success) toast.success(success)
      const catalog = await api.catalog()
      setEntries(catalog.entries)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    const paths = files
      .map((file) => (file as File & { path?: string }).path)
      .filter((value): value is string => Boolean(value))
    setBusy(true)
    try {
      const result = paths.length ? await api.importPaths(paths) : await api.importFiles(files)
      if (result.errors.length) toast.error(result.errors.join('\n'))
      if (result.entries[0]) {
        setSelectedFamily(familyNameOf(result.entries[0]))
        setTab('library')
        toast.success(
          result.entries.length === 1
            ? `Added ${familyNameOf(result.entries[0])}`
            : `Added ${result.entries.length} fonts`,
        )
      }
      setEntries((await api.catalog()).entries)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add fonts')
    } finally {
      setBusy(false)
      setDragging(false)
    }
  }

  async function revealCatalog(entry: CatalogEntry, which: 'source' | 'installed' = 'source') {
    try {
      const result = await api.reveal({ id: entry.id, which })
      toast.message(`Showing ${result.path}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not show file')
    }
  }

  async function revealSystem(path: string) {
    try {
      const result = await api.reveal({ path })
      toast.message(`Showing ${result.path}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not show file')
    }
  }

  return (
    <TooltipProvider>
      <div
        className="flex h-full min-h-0 flex-col"
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          void handleFiles(event.dataTransfer.files)
        }}
      >
        <FontFaceStyles
          entries={entries}
          systemFaces={tab === 'system' ? shownSystemGroups.flatMap((group) => group.faces) : []}
        />
        <header className="flex flex-col gap-3 border-b bg-card/80 px-4 py-3 backdrop-blur md:flex-row md:items-center">
          <div className="flex items-baseline gap-3">
            <h1 className="font-sans text-[28px] leading-none tracking-tight">Fontcase</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
              Source-tracked fonts
            </p>
          </div>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search families"
              className="pl-8"
            />
          </div>
          <nav className="flex flex-wrap gap-1">
            {TABS.map((item) => {
              const count =
                item.id === 'updates'
                  ? updateGroups.length
                  : item.id === 'uninstalled'
                    ? uninstalledGroups.length
                    : null
              return (
                <Button
                  key={item.id}
                  size="sm"
                  variant={tab === item.id ? 'default' : 'ghost'}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                  {count ? (
                    <Badge tone={item.id === 'updates' ? 'warn' : 'muted'} className="ml-1">
                      {count}
                    </Badge>
                  ) : null}
                </Button>
              )
            })}
          </nav>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <section className="min-h-0 min-w-0 flex-1">
            <ScrollArea className="h-full">
              <div className="p-4">
                {loading && (
                  <p className="px-2 py-12 text-center text-sm text-muted-foreground">
                    Reading fonts…
                  </p>
                )}
                {error && (
                  <p className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900">{error}</p>
                )}
                {!loading && tab !== 'system' && visibleGroups.length === 0 && (
                  <EmptyState
                    tab={tab}
                    onPickFiles={(files) => void handleFiles(files)}
                  />
                )}
                {!loading && tab === 'system' && systemGroups.length === 0 && (
                  <p className="px-2 py-12 text-center text-sm text-muted-foreground">
                    No fonts found in the system folders.
                  </p>
                )}
                {tab === 'system' && !query.trim() && systemGroups.length > shownSystemGroups.length && (
                  <p className="mb-3 text-sm text-muted-foreground">
                    Showing {shownSystemGroups.length} of {systemGroups.length} families. Search to jump to
                    the rest.
                  </p>
                )}
                {!loading && missingSourceCount > 0 && tab !== 'system' && tab !== 'updates' && (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed bg-card/60 px-3 py-2">
                    <p className="text-sm text-muted-foreground">
                      {missingSourceCount}{' '}
                      {missingSourceCount === 1 ? 'font has' : 'fonts have'} a missing source file.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => api.forgetMissingSources(),
                          `Removed ${missingSourceCount} missing ${missingSourceCount === 1 ? 'font' : 'fonts'} from the library`,
                        )
                      }
                    >
                      Remove all missing sources
                    </Button>
                  </div>
                )}
                {!loading && hasCatalogList && (
                  <ViewOptions
                    className="mb-3"
                    layout={viewLayout}
                    onLayoutChange={(next) => {
                      setViewLayout(next)
                      localStorage.setItem('fontcase-view-layout', next)
                    }}
                    showSources={showSources}
                    onShowSourcesChange={(next) => {
                      setShowSources(next)
                      localStorage.setItem('fontcase-show-sources', String(next))
                    }}
                    showSourcesToggle={tab !== 'system'}
                  />
                )}
                <div
                  className={cn(
                    viewLayout === 'grid'
                      ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4'
                      : 'grid gap-2',
                  )}
                >
                  {tab === 'system'
                    ? shownSystemGroups.map((group) => (
                        <SystemCard
                          key={group.key}
                          layout={viewLayout}
                          group={group}
                          selected={selectedSystemGroup?.key === group.key}
                          onSelect={() => setSelectedSystem(group.familyName)}
                          onReveal={() => {
                            setSelectedSystem(group.familyName)
                            void revealSystem(group.faces[0].path)
                          }}
                          onUninstall={() =>
                            void run(async () => {
                              for (const face of uniquePaths(group.faces)) {
                                await api.uninstallSystem(face)
                              }
                              setSystemFaces((await api.system()).faces)
                            }, `Removed ${group.familyName}`)
                          }
                          onDeactivate={() =>
                            void run(async () => {
                              for (const face of uniquePaths(group.faces)) {
                                await api.deactivateSystem(face)
                              }
                              setSystemFaces((await api.system()).faces)
                            }, `Deactivated ${group.familyName}`)
                          }
                        />
                      ))
                    : visibleGroups.map((group) => (
                        <LibraryCard
                          key={group.key}
                          layout={viewLayout}
                          group={group}
                          showSourcePath={showSources}
                          selected={selectedGroup?.key === group.key}
                          selectedEntryId={selectedEntryId}
                          onSelect={() => selectGroup(group)}
                          onSelectEntry={setSelectedEntryId}
                          busy={busy}
                          onInstall={() =>
                            void run(() => installGroup(group), `Installed ${group.familyName}`)
                          }
                          onInstallAs={() => setRenameEntry(selectedEntry ?? group.entries[0])}
                          onReinstall={() =>
                            void run(() => reinstallGroup(group), `Reinstalled ${group.familyName}`)
                          }
                          onUninstall={() =>
                            void run(() => uninstallGroup(group), `Removed ${group.familyName}`)
                          }
                          onDeactivate={() =>
                            void run(() => deactivateGroup(group), `Deactivated ${group.familyName}`)
                          }
                          onActivate={() =>
                            void run(() => activateGroup(group), `Activated ${group.familyName}`)
                          }
                          onReveal={() => {
                            selectGroup(group)
                            void revealCatalog(selectedEntry ?? group.entries[0])
                          }}
                          onForget={() => {
                            const count = sourceMissingIds(group).length
                            void run(
                              () => forgetGroup(group),
                              count === 1
                                ? `Removed ${group.familyName} from the library`
                                : `Removed ${count} missing files from ${group.familyName}`,
                            )
                          }}
                        />
                      ))}
                </div>
              </div>
            </ScrollArea>
          </section>
          <div className="border-t md:border-t-0 md:border-l">
            <Inspector
              group={tab === 'system' ? null : selectedGroup}
              entry={tab === 'system' ? null : selectedEntry}
              statusSummary={selectedGroup ? familyStatusSummary(selectedGroup) : null}
              selectedEntryId={selectedEntryId}
              onSelectEntry={setSelectedEntryId}
              systemGroup={selectedSystemGroup}
              busy={busy}
              onInstall={() =>
                selectedGroup &&
                void run(() => installGroup(selectedGroup), `Installed ${selectedGroup.familyName}`)
              }
              onInstallAs={() => setRenameEntry(selectedEntry)}
              onReinstall={() =>
                selectedGroup && void run(() => reinstallGroup(selectedGroup))
              }
              onUninstall={() =>
                selectedGroup &&
                void run(() => uninstallGroup(selectedGroup), `Removed ${selectedGroup.familyName}`)
              }
              onDeactivate={() =>
                selectedGroup &&
                void run(() => deactivateGroup(selectedGroup), `Deactivated ${selectedGroup.familyName}`)
              }
              onActivate={() =>
                selectedGroup && void run(() => activateGroup(selectedGroup), `Activated ${selectedGroup.familyName}`)
              }
              onReveal={(which) => selectedEntry && void revealCatalog(selectedEntry, which)}
              onUninstallSystem={() =>
                selectedSystemGroup &&
                void run(async () => {
                  for (const face of uniquePaths(selectedSystemGroup.faces)) {
                    await api.uninstallSystem(face)
                  }
                  setSystemFaces((await api.system()).faces)
                }, `Removed ${selectedSystemGroup.familyName}`)
              }
              onDeactivateSystem={() =>
                selectedSystemGroup &&
                void run(async () => {
                  for (const face of uniquePaths(selectedSystemGroup.faces)) {
                    await api.deactivateSystem(face)
                  }
                  setSystemFaces((await api.system()).faces)
                }, `Deactivated ${selectedSystemGroup.familyName}`)
              }
              onRevealSystem={() =>
                selectedSystemGroup?.faces[0] && void revealSystem(selectedSystemGroup.faces[0].path)
              }
              onForget={() => {
                if (!selectedEntry || selectedEntry.status !== 'source-missing') return
                void run(
                  () => forgetEntry(selectedEntry),
                  `Removed ${familyNameOf(selectedEntry)} from the library`,
                )
              }}
            />
          </div>
        </div>

        {dragging && (
          <div className="pointer-events-none fixed inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent/15">
            <p className="font-sans text-3xl">Drop fonts to add them</p>
          </div>
        )}
        <RenameDialog
          entry={renameEntry}
          open={Boolean(renameEntry)}
          onOpenChange={(open) => {
            if (!open) setRenameEntry(null)
          }}
          onDone={(entry) => {
            setSelectedFamily(familyNameOf(entry))
            void api.catalog().then((result) => setEntries(result.entries))
          }}
        />
        <Toaster />
      </div>
    </TooltipProvider>
  )
}

function uniquePaths(faces: SystemFace[]): string[] {
  return [...new Set(faces.map((face) => face.path))]
}

function LibraryCard({
  group,
  layout,
  showSourcePath,
  selected,
  selectedEntryId,
  busy,
  onSelect,
  onSelectEntry,
  onInstall,
  onInstallAs,
  onReinstall,
  onUninstall,
  onDeactivate,
  onActivate,
  onReveal,
  onForget,
}: {
  group: FamilyGroup
  layout: ViewLayout
  showSourcePath?: boolean
  selected: boolean
  selectedEntryId: string | null
  busy: boolean
  onSelect: () => void
  onSelectEntry: (entryId: string) => void
  onInstall: () => void
  onInstallAs: () => void
  onReinstall: () => void
  onUninstall: () => void
  onDeactivate: () => void
  onActivate: () => void
  onReveal: () => void
  onForget: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const preview = group.entries[0]
  const installed = group.status === 'installed' || group.status === 'outdated'
  const missingSource = hasSourceMissing(group)
  const instances = useMemo(() => catalogInstanceRows(group), [group])
  const showInstances = instances.length > 0 && layout === 'list'
  const previewFamily = catalogFontFamily(group.previewEntryId)
  const previewWeight = preview.faces[0]?.weight
  const previewItalic = preview.faces[0]?.italic

  const metadata = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate font-medium">{group.familyName}</span>
        <VfBadge show={group.isVariable} />
        <StatusBadge status={group.status} />
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {group.instanceCount} {group.instanceCount === 1 ? 'instance' : 'instances'}
        {group.entries.length > 1 ? ` · ${group.entries.length} files` : ''}
      </div>
      {showSourcePath && (
        <div className="mt-1 space-y-0.5">
          {group.entries.map((item) => (
            <div
              key={item.id}
              className="truncate font-mono text-[11px] text-muted-foreground/90"
              title={item.sourcePath}
            >
              {item.sourcePath}
            </div>
          ))}
        </div>
      )}
    </>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'overflow-hidden rounded-xl border transition-colors',
            selected ? 'border-primary bg-card shadow-sm' : 'border-transparent bg-card/70',
          )}
        >
          {layout === 'grid' ? (
            <button
              type="button"
              onClick={onSelect}
              className="flex w-full flex-col text-left hover:bg-card"
            >
              <AaPreview
                family={previewFamily}
                weight={previewWeight}
                italic={previewItalic}
                size="lg"
              />
              <div className="p-3">{metadata}</div>
            </button>
          ) : (
            <>
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={onSelect}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-card"
                >
                  <AaPreview
                    family={previewFamily}
                    weight={previewWeight}
                    italic={previewItalic}
                  />
                  <div className="min-w-0 flex-1">{metadata}</div>
                </button>
                {showInstances && (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide instances' : 'Show instances'}
                    onClick={(event) => {
                      event.stopPropagation()
                      setExpanded((value) => !value)
                    }}
                    className="flex w-10 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  >
                    <ChevronDown
                      className={cn('size-4 transition-transform', expanded && 'rotate-180')}
                    />
                  </button>
                )}
              </div>
              {expanded && showInstances && (
                <InstanceList
                  rows={instances}
                  selectedEntryId={selectedEntryId}
                  onSelectEntry={onSelectEntry}
                />
              )}
            </>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onReveal}>Show in Finder</ContextMenuItem>
        <ContextMenuSeparator />
        {installed ? (
          <>
            {group.status === 'outdated' && (
              <ContextMenuItem disabled={busy} onSelect={onReinstall}>
                Reinstall
              </ContextMenuItem>
            )}
            <ContextMenuItem disabled={busy} onSelect={onDeactivate}>
              Deactivate
            </ContextMenuItem>
            <ContextMenuItem disabled={busy} onSelect={onUninstall}>
              Uninstall
            </ContextMenuItem>
          </>
        ) : group.status === 'deactivated' ? (
          <ContextMenuItem disabled={busy} onSelect={onActivate}>
            Activate
          </ContextMenuItem>
        ) : (
          <>
            <ContextMenuItem disabled={busy} onSelect={onInstall}>
              Install
            </ContextMenuItem>
            <ContextMenuItem disabled={busy} onSelect={onInstallAs}>
              Install as…
            </ContextMenuItem>
          </>
        )}
        {missingSource && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={busy}
              className="text-destructive focus:text-destructive"
              onSelect={onForget}
            >
              Remove from library
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function SystemCard({
  group,
  layout,
  selected,
  onSelect,
  onReveal,
  onUninstall,
  onDeactivate,
}: {
  group: SystemFamilyGroup
  layout: ViewLayout
  selected: boolean
  onSelect: () => void
  onReveal: () => void
  onUninstall: () => void
  onDeactivate: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const face = group.faces[0]
  const instances = useMemo(() => systemInstanceRows(group), [group])
  const showInstances = instances.length > 0 && layout === 'list'
  const previewFamily = systemFontFamily(face.path)

  const metadata = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate font-medium">{group.familyName}</span>
        <VfBadge show={group.isVariable} />
        {group.protected && <Badge>System</Badge>}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {group.instanceCount} {group.instanceCount === 1 ? 'instance' : 'instances'}
      </div>
      {layout === 'grid' && (
        <div
          className="mt-1 truncate font-mono text-[11px] text-muted-foreground/90"
          title={face.path}
        >
          {face.path}
        </div>
      )}
    </>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'overflow-hidden rounded-xl border transition-colors',
            selected ? 'border-primary bg-card shadow-sm' : 'border-transparent bg-card/70',
          )}
        >
          {layout === 'grid' ? (
            <button
              type="button"
              onClick={onSelect}
              className="flex w-full flex-col text-left hover:bg-card"
            >
              <AaPreview
                family={previewFamily}
                weight={face.weight}
                italic={face.italic}
                size="lg"
              />
              <div className="p-3">{metadata}</div>
            </button>
          ) : (
            <>
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={onSelect}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-card"
                >
                  <AaPreview
                    family={previewFamily}
                    weight={face.weight}
                    italic={face.italic}
                  />
                  <div className="min-w-0 flex-1">{metadata}</div>
                </button>
                {showInstances && (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide instances' : 'Show instances'}
                    onClick={(event) => {
                      event.stopPropagation()
                      setExpanded((value) => !value)
                    }}
                    className="flex w-10 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  >
                    <ChevronDown
                      className={cn('size-4 transition-transform', expanded && 'rotate-180')}
                    />
                  </button>
                )}
              </div>
              {expanded && showInstances && <InstanceList rows={instances} />}
            </>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onReveal}>Show in Finder</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!group.writable} onSelect={onDeactivate}>
          Deactivate
        </ContextMenuItem>
        <ContextMenuItem disabled={!group.writable} onSelect={onUninstall}>
          Uninstall
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function EmptyState({
  tab,
  onPickFiles,
}: {
  tab: Tab
  onPickFiles: (files: FileList) => void
}) {
  return (
    <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center">
      <p className="font-sans text-2xl">
        {tab === 'updates'
          ? 'No source updates'
          : tab === 'uninstalled'
            ? 'No inactive fonts'
            : 'Drop font files here'}
      </p>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {tab === 'library'
          ? 'TrueType, OpenType, collections, and WOFF files stay linked to their original path.'
          : tab === 'uninstalled'
            ? 'Fonts you uninstall or deactivate stay here. Reinstall or activate them when you need them again.'
            : 'Fonts you uninstall stay in the library so you can put them back in one click.'}
      </p>
      <input
        type="file"
        accept=".ttf,.otf,.ttc,.otc,.woff,.woff2"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) onPickFiles(event.target.files)
        }}
      />
    </label>
  )
}

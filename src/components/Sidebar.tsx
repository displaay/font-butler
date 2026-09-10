import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import {
  ALargeSmall,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleOff,
  Ellipsis,
  Copy,
  Folder,
  FolderMinus,
  FolderOpen,
  Laptop,
  Link2,
  List,
  Filter,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Type,
  Unlink,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  readShowTotals,
  setShowTotal,
  watchShowTotalId,
  writeShowTotals,
} from '@/lib/showTotals'
import type { LibraryFilter, ProjectSet, SavedLibraryFilter, WatchFolder } from '@/lib/types'
import { folderAvailabilityLabel } from '@/lib/folders'
import {
  canDropOnProject,
  readFontButlerEntries,
  readProjectSort,
  sortProjects,
  writeProjectSort,
  type ProjectSortMode,
} from '@/lib/projects'
import { savedFilterMatches } from '@/lib/savedFilters'
import { hasInsetTrafficLights } from '@/lib/desktop'
import { shouldShowUpdatesTab } from '@/lib/app-update'
import { cn } from '@/lib/utils'
import { watchFolderLabel, RETAIL_LIBRARY_FILTER, RETAIL_LIBRARY_LABEL } from '@/lib/watchFolders'

export type Tab = 'library' | 'system' | 'updates' | 'activity'

const LIBRARY_FILTER_GROUPS: {
  heading: string
  filters: {
    id: LibraryFilter
    label: string
    icon: ComponentType<{ className?: string }>
  }[]
}[] = [
  {
    heading: 'Status',
    filters: [
      { id: 'installed', label: 'Installed', icon: CircleCheck },
      { id: 'deactivated', label: 'Deactivated', icon: PowerOff },
      { id: 'uninstalled', label: 'Not installed', icon: CircleOff },
    ],
  },
  {
    heading: 'Type',
    filters: [
      { id: 'vf', label: 'VF', icon: SlidersHorizontal },
      { id: 'static', label: 'Static', icon: ALargeSmall },
    ],
  },
  {
    heading: 'Source',
    filters: [
      { id: 'source', label: 'Source', icon: Link2 },
      { id: 'no-source', label: 'No source', icon: Unlink },
    ],
  },
]

const TABS: { id: Tab; label: string; icon: typeof Type }[] = [
  { id: 'library', label: 'Fonts', icon: Type },
  { id: 'system', label: 'On this Mac', icon: Laptop },
  { id: 'activity', label: 'Activity', icon: List },
  { id: 'updates', label: 'Updates', icon: RefreshCw },
]

function navButtonClass(active: boolean, extra?: string) {
  return cn(
    'h-8 justify-start font-normal text-muted-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.08]',
    active && 'bg-black/[0.05] font-medium text-foreground dark:bg-white/[0.08]',
    extra,
  )
}

function SidebarItem({
  active,
  icon: Icon,
  label,
  count,
  showTotal,
  onShowTotalChange,
  onClick,
  className,
  title,
  badgeTone = 'muted',
  unreadCount = 0,
  lockTotal = false,
  hoverAction,
  onReveal,
  onRemove,
  onOpenWatchFoldersSettings,
  expanded,
  onToggleExpand,
}: {
  active: boolean
  icon: ComponentType<{ className?: string }>
  label: string
  count: number
  showTotal: boolean
  onShowTotalChange: (value: boolean) => void
  onClick: () => void
  className?: string
  title?: string
  badgeTone?: 'muted' | 'warn'
  unreadCount?: number
  lockTotal?: boolean
  hoverAction?: { label: string; onClick: () => void; disabled?: boolean }
  onReveal?: () => void
  onRemove?: () => void
  onOpenWatchFoldersSettings?: () => void
  expanded?: boolean
  onToggleExpand?: () => void
}) {
  const showCount = unreadCount > 0 || lockTotal || showTotal
  const button = (
    <Button
      size="default"
      variant="ghost"
      title={title}
      aria-current={active ? 'page' : undefined}
      aria-expanded={onToggleExpand ? expanded : undefined}
      className={navButtonClass(active, cn((onToggleExpand || hoverAction) && 'group', className))}
      onClick={onClick}
    >
      <span
        className="relative -m-1 inline-flex size-6 shrink-0 items-center justify-center"
        aria-hidden={!onToggleExpand}
        aria-label={
          onToggleExpand ? (expanded ? 'Hide watch folders' : 'Show watch folders') : undefined
        }
        onClick={
          onToggleExpand
            ? (event) => {
                event.preventDefault()
                event.stopPropagation()
                onToggleExpand()
              }
            : undefined
        }
        onPointerDown={onToggleExpand ? (event) => event.stopPropagation() : undefined}
      >
        <Icon
          className={cn(
            'size-3.5 opacity-70 transition-opacity',
            onToggleExpand && 'group-hover:opacity-0',
          )}
        />
        {onToggleExpand ? (
          expanded ? (
            <ChevronDown className="pointer-events-none absolute size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          ) : (
            <ChevronRight className="pointer-events-none absolute size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          )
        ) : null}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      {showCount || hoverAction ? (
        <span className="ml-auto inline-flex items-center gap-0.5">
          {hoverAction ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label={hoverAction.label}
              title={hoverAction.label}
              className={cn(
                'inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]',
                hoverAction.disabled && 'pointer-events-none',
              )}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (!hoverAction.disabled) hoverAction.onClick()
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <RefreshCw className="size-3.5" />
            </span>
          ) : null}
          {unreadCount > 0 ? (
            <Badge tone="accent" aria-label={`${unreadCount} unread`}>
              {unreadCount}
            </Badge>
          ) : lockTotal || showTotal ? (
            <Badge tone={badgeTone}>{count}</Badge>
          ) : null}
        </span>
      ) : null}
    </Button>
  )
  if (lockTotal && !onReveal && !onRemove && !onOpenWatchFoldersSettings) {
    return button
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
      <ContextMenuContent>
        {onReveal || onRemove || onOpenWatchFoldersSettings ? (
          <>
            {onReveal ? (
              <ContextMenuItem onSelect={onReveal}>
                <FolderOpen /> Show in Finder
              </ContextMenuItem>
            ) : null}
            {onRemove ? (
              <ContextMenuItem onSelect={onRemove}>
                <FolderMinus /> Remove Watch folder
              </ContextMenuItem>
            ) : null}
            {onOpenWatchFoldersSettings ? (
              <ContextMenuItem onSelect={onOpenWatchFoldersSettings}>
                <Settings /> Watch folders settings
              </ContextMenuItem>
            ) : null}
            <ContextMenuSeparator />
          </>
        ) : null}
        <ContextMenuCheckboxItem
          checked={showTotal}
          aria-label="Show total"
          onCheckedChange={onShowTotalChange}
        >
          Show total
        </ContextMenuCheckboxItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function Sidebar({
  query,
  onQueryChange,
  tab,
  onTabChange,
  watchFolders,
  watchFolderFilter,
  watchFolderCounts,
  onSelectWatchFolder,
  onRevealWatchFolder,
  onRemoveWatchFolder,
  folders,
  projects,
  projectFilter,
  onSelectProject,
  onActivateProject,
  onDeactivateProject,
  onRenameProject,
  onAddFontsToProject,
  onDropFilesOnProject,
  onRemoveProject,
  onCreateProject,
  savedFilters,
  onSelectSavedFilter,
  onCreateSavedFilter,
  onRenameSavedFilter,
  onRemoveSavedFilter,
  libraryFilters,
  libraryFilterCounts,
  onLibraryFiltersChange,
  duplicatesCount,
  onOpenDuplicates,
  counts,
  activityUnread = 0,
  hasAppUpdate = false,
  hasFontUpdates = false,
  searching = false,
  retailPending = 0,
  retailEnabled = false,
  retailBusy = false,
  retailCount = 0,
  onSyncRetail,
  onReinstallAllUpdates,
  onOpenSettings,
  onOpenWatchFoldersSettings,
}: {
  query: string
  onQueryChange: (value: string) => void
  tab: Tab
  onTabChange: (tab: Tab) => void
  watchFolders: string[]
  watchFolderFilter: string | null
  watchFolderCounts: Record<string, number>
  onSelectWatchFolder: (folder: string | null) => void
  onRevealWatchFolder: (folder: string) => void
  onRemoveWatchFolder: (folder: string) => void
  folders?: WatchFolder[]
  projects?: ProjectSet[]
  projectFilter?: string | null
  onSelectProject?: (id: string | null) => void
  onActivateProject?: (id: string) => void
  onDeactivateProject?: (id: string) => void
  onRenameProject?: (id: string, name: string) => void
  onAddFontsToProject?: (id: string, entryIds: string[]) => void
  onDropFilesOnProject?: (id: string, dataTransfer: DataTransfer) => void
  onRemoveProject?: (id: string) => void
  onCreateProject?: () => void
  savedFilters?: SavedLibraryFilter[]
  onSelectSavedFilter?: (filter: SavedLibraryFilter) => void
  onCreateSavedFilter?: () => void
  onRenameSavedFilter?: (id: string, name: string) => void
  onRemoveSavedFilter?: (id: string) => void
  libraryFilters: LibraryFilter[]
  libraryFilterCounts: Record<LibraryFilter, number>
  onLibraryFiltersChange: (value: LibraryFilter[]) => void
  duplicatesCount?: number
  onOpenDuplicates?: () => void
  counts: { library: number; system: number; updates: number; activity?: number }
  activityUnread?: number
  hasAppUpdate?: boolean
  hasFontUpdates?: boolean
  searching?: boolean
  /** Retail fonts whose newer version is still on the server. */
  retailPending?: number
  retailEnabled?: boolean
  retailBusy?: boolean
  retailCount?: number
  onSyncRetail?: () => void
  onReinstallAllUpdates?: () => void
  onOpenSettings: () => void
  onOpenWatchFoldersSettings?: () => void
}) {
  const insetTrafficLights = hasInsetTrafficLights()
  const [fontsOpen, setFontsOpen] = useState(true)
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [projectSort, setProjectSort] = useState<ProjectSortMode>(readProjectSort)
  const [projectSortOpen, setProjectSortOpen] = useState(false)
  const [showTotals, setShowTotals] = useState(readShowTotals)
  const sortedProjects = useMemo(
    () => sortProjects(projects ?? [], projectSort),
    [projects, projectSort],
  )
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const skipRenameCommitRef = useRef(false)
  const renameSessionRef = useRef<{ id: string; original: string } | null>(null)
  const [savedFiltersOpen, setSavedFiltersOpen] = useState(true)
  const [editingFilterId, setEditingFilterId] = useState<string | null>(null)
  const [filterRenameValue, setFilterRenameValue] = useState('')
  const filterRenameInputRef = useRef<HTMLInputElement>(null)
  const skipFilterRenameCommitRef = useRef(false)
  const filterRenameSessionRef = useRef<{ id: string; original: string } | null>(null)
  const deselectTimerRef = useRef<number | null>(null)
  const currentCriteria = {
    query,
    libraryFilters,
    watchFolder: watchFolderFilter,
  }
  const hasSavedFilters = (savedFilters?.length ?? 0) > 0
  const hasActiveLibraryCriteria =
    currentCriteria.query.trim().length > 0 ||
    currentCriteria.libraryFilters.length > 0 ||
    Boolean(currentCriteria.watchFolder)
  const showSavedFilters =
    tab === 'library' &&
    (hasSavedFilters || Boolean(onCreateSavedFilter && hasActiveLibraryCriteria))
  const hasWatchChildren = watchFolders.length > 0 || retailEnabled
  const fontsActive = tab === 'library' && !watchFolderFilter

  useEffect(() => {
    if (!editingProjectId) return
    const timer = window.setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editingProjectId])

  useEffect(() => {
    if (editingProjectId && !(projects ?? []).some((item) => item.id === editingProjectId)) {
      setEditingProjectId(null)
    }
  }, [editingProjectId, projects])

  useEffect(() => {
    if (!editingFilterId) return
    const timer = window.setTimeout(() => {
      filterRenameInputRef.current?.focus()
      filterRenameInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editingFilterId])

  useEffect(() => {
    if (editingFilterId && !(savedFilters ?? []).some((item) => item.id === editingFilterId)) {
      setEditingFilterId(null)
    }
  }, [editingFilterId, savedFilters])

  function clearDeselectTimer() {
    if (deselectTimerRef.current == null) return
    window.clearTimeout(deselectTimerRef.current)
    deselectTimerRef.current = null
  }

  function startRename(project: ProjectSet) {
    skipRenameCommitRef.current = false
    clearDeselectTimer()
    renameSessionRef.current = { id: project.id, original: project.name }
    setRenameValue(project.name)
    setEditingProjectId(project.id)
  }

  function cancelRename() {
    skipRenameCommitRef.current = true
    renameSessionRef.current = null
    setEditingProjectId(null)
  }

  function commitRename() {
    if (skipRenameCommitRef.current) {
      skipRenameCommitRef.current = false
      renameSessionRef.current = null
      return
    }
    const session = renameSessionRef.current
    if (!session) return
    renameSessionRef.current = null
    const next = renameValue.trim() || 'Untitled project'
    setEditingProjectId(null)
    if (session.original === next) return
    onRenameProject?.(session.id, next)
  }

  function startFilterRename(filter: SavedLibraryFilter) {
    skipFilterRenameCommitRef.current = false
    filterRenameSessionRef.current = { id: filter.id, original: filter.name }
    setFilterRenameValue(filter.name)
    setEditingFilterId(filter.id)
  }

  function cancelFilterRename() {
    skipFilterRenameCommitRef.current = true
    filterRenameSessionRef.current = null
    setEditingFilterId(null)
  }

  function commitFilterRename() {
    if (skipFilterRenameCommitRef.current) {
      skipFilterRenameCommitRef.current = false
      filterRenameSessionRef.current = null
      return
    }
    const session = filterRenameSessionRef.current
    if (!session) return
    filterRenameSessionRef.current = null
    const next = filterRenameValue.trim() || 'Untitled filter'
    setEditingFilterId(null)
    if (session.original === next) return
    onRenameSavedFilter?.(session.id, next)
  }

  function changeShowTotal(id: string, value: boolean) {
    const next = setShowTotal(showTotals, id, value)
    setShowTotals(next)
    writeShowTotals(next)
  }

  function toggleFilter(id: LibraryFilter) {
    onLibraryFiltersChange(
      libraryFilters.includes(id)
        ? libraryFilters.filter((item) => item !== id)
        : [...libraryFilters, id],
    )
  }

  return (
    <aside
      className={cn(
        'flex h-auto w-full shrink-0 flex-col border-b bg-sidebar text-sidebar-foreground md:h-full md:max-h-full md:w-56 md:border-r md:border-b-0',
        insetTrafficLights && 'app-region-drag',
      )}
    >
      {insetTrafficLights ? <div className="hidden h-10 shrink-0 md:block" aria-hidden /> : null}
      <div className="flex flex-col gap-3 px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search families"
            aria-label="Search families"
            className="pl-8 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
          />
        </div>
      </div>
      <nav className="flex min-h-0 flex-1 flex-row flex-wrap gap-0.5 overflow-y-auto px-3 pb-2 md:flex-col md:flex-nowrap">
        {TABS.filter(
          (item) =>
            item.id !== 'updates' ||
            shouldShowUpdatesTab(counts.updates, hasAppUpdate, retailPending) ||
            (searching && hasFontUpdates),
        ).map((item) => {
          if (item.id === 'library') {
            return (
              <div key={item.id} className="flex w-full flex-col gap-0.5">
                <SidebarItem
                  active={fontsActive}
                  icon={item.icon}
                  label={item.label}
                  count={counts.library}
                  showTotal={searching || Boolean(showTotals.library)}
                  onShowTotalChange={(value) => changeShowTotal('library', value)}
                  onClick={() => onSelectWatchFolder(null)}
                  className="w-full"
                  expanded={fontsOpen}
                  onToggleExpand={
                    hasWatchChildren ? () => setFontsOpen((value) => !value) : undefined
                  }
                />
                {fontsOpen &&
                  watchFolders.map((folder) => {
                    const id = watchShowTotalId(folder)
                    return (
                      <SidebarItem
                        key={folder}
                        active={tab === 'library' && watchFolderFilter === folder}
                        icon={Folder}
                        label={watchFolderLabel(folder, watchFolders)}
                        count={watchFolderCounts[folder] ?? 0}
                        showTotal={Boolean(showTotals[id])}
                        onShowTotalChange={(value) => changeShowTotal(id, value)}
                        onClick={() => onSelectWatchFolder(folder)}
                        className="w-full pl-7"
                        title={
                          folders?.find((item) => item.root === folder)
                            ? `${folder} · ${folderAvailabilityLabel(folders.find((item) => item.root === folder)!)}`
                            : folder
                        }
                        onReveal={() => onRevealWatchFolder(folder)}
                        onRemove={() => onRemoveWatchFolder(folder)}
                      />
                    )
                  })}
                {fontsOpen && retailEnabled ? (
                  <SidebarItem
                    key={RETAIL_LIBRARY_FILTER}
                    active={tab === 'library' && watchFolderFilter === RETAIL_LIBRARY_FILTER}
                    icon={Folder}
                    label={RETAIL_LIBRARY_LABEL}
                    count={retailCount}
                    showTotal={Boolean(showTotals[watchShowTotalId(RETAIL_LIBRARY_FILTER)])}
                    onShowTotalChange={(value) =>
                      changeShowTotal(watchShowTotalId(RETAIL_LIBRARY_FILTER), value)
                    }
                    onClick={() => onSelectWatchFolder(RETAIL_LIBRARY_FILTER)}
                    className="w-full pl-7"
                    title={RETAIL_LIBRARY_LABEL}
                    hoverAction={
                      onSyncRetail
                        ? {
                            label: 'Sync',
                            onClick: onSyncRetail,
                            disabled: retailBusy,
                          }
                        : undefined
                    }
                    onOpenWatchFoldersSettings={onOpenWatchFoldersSettings}
                  />
                ) : null}
              </div>
            )
          }
          return (
            <SidebarItem
              key={item.id}
              active={tab === item.id}
              icon={item.icon}
              label={item.label}
              count={
                item.id === 'system'
                  ? counts.system
                  : item.id === 'activity'
                    ? counts.activity ?? 0
                    : item.id === 'updates'
                      ? counts.updates +
                        (hasAppUpdate && !searching ? 1 : 0) +
                        (searching ? 0 : retailPending)
                      : counts.updates
              }
              showTotal={item.id === 'updates' || searching || Boolean(showTotals[item.id])}
              lockTotal={item.id === 'updates'}
              onShowTotalChange={(value) => changeShowTotal(item.id, value)}
              onClick={() => onTabChange(item.id)}
              className="flex-1 md:flex-none"
              badgeTone={item.id === 'updates' ? 'warn' : 'muted'}
              unreadCount={item.id === 'activity' && !searching ? activityUnread : 0}
              hoverAction={
                item.id === 'updates' && counts.updates > 0 && onReinstallAllUpdates
                  ? {
                      label: counts.updates === 1 ? 'Reinstall update' : 'Reinstall all updates',
                      onClick: onReinstallAllUpdates,
                    }
                  : undefined
              }
              title={
                item.id === 'activity' && activityUnread > 0
                  ? `${activityUnread} unread`
                  : item.id === 'updates' && hasAppUpdate
                    ? 'App update available'
                    : item.id === 'updates' && retailPending > 0
                      ? `${retailPending} retail ${retailPending === 1 ? 'font has' : 'fonts have'} a newer version`
                      : undefined
              }
            />
          )
        })}
        {(onCreateProject || (projects && projects.length > 0)) && (
          <div className="flex w-full flex-col gap-0.5 md:mt-2 md:border-t md:pt-2">
            <div className="group/projects flex w-full items-center gap-0.5 px-1 pt-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 px-1 text-left"
                aria-expanded={projectsOpen}
                aria-label={projectsOpen ? 'Hide projects' : 'Show projects'}
                onClick={() => setProjectsOpen((value) => !value)}
              >
                <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  Projects
                </span>
                {projectsOpen ? (
                  <ChevronDown className="size-3 opacity-0 transition-opacity group-hover/projects:opacity-70" />
                ) : (
                  <ChevronRight className="size-3 opacity-0 transition-opacity group-hover/projects:opacity-70" />
                )}
              </button>
              <div
                className={cn(
                  'flex items-center text-muted-foreground md:transition-opacity',
                  projectSortOpen
                    ? 'md:opacity-100'
                    : 'md:opacity-0 md:group-hover/projects:opacity-100',
                )}
              >
                <ProjectSortMenu
                  value={projectSort}
                  open={projectSortOpen}
                  onOpenChange={setProjectSortOpen}
                  onChange={(next) => {
                    setProjectSort(next)
                    writeProjectSort(next)
                  }}
                />
                {onCreateProject ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-6 text-muted-foreground"
                    aria-label="Create new project"
                    onClick={(event) => {
                      onCreateProject()
                      event.currentTarget.blur()
                    }}
                  >
                    <Plus />
                  </Button>
                ) : null}
              </div>
            </div>
            {projectsOpen ? (
              <>
            {sortedProjects.map((project) => {
              const editing = editingProjectId === project.id
              const rowClassName = navButtonClass(
                projectFilter === project.id,
                cn('w-full', dropTargetId === project.id && 'bg-muted text-foreground'),
              )
              const nameField = editing ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  aria-label="Project name"
                  className="min-w-0 flex-1 bg-transparent px-0 text-[13px] font-normal outline-none"
                  onChange={(event) => setRenameValue(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.stopPropagation()
                      commitRename()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      cancelRename()
                    }
                  }}
                  onBlur={commitRename}
                />
              ) : (
                <span
                  className="min-w-0 truncate"
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    startRename(project)
                  }}
                >
                  {project.desiredActive ? `${project.name} · active` : project.name}
                </span>
              )
              const rowBody = (
                <>
                  <Folder className="size-3.5 opacity-70" />
                  {nameField}
                  <Badge className="ml-auto">{project.members.length}</Badge>
                </>
              )
              return (
              <ContextMenu key={project.id}>
                <ContextMenuTrigger asChild>
                  {editing ? (
                    <div
                      className={cn(
                        'inline-flex items-center justify-start gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px]',
                        rowClassName,
                      )}
                      role="group"
                      aria-label="Rename project"
                    >
                      {rowBody}
                    </div>
                  ) : (
                  <Button
                    type="button"
                    size="default"
                    variant="ghost"
                    aria-current={projectFilter === project.id ? 'page' : undefined}
                    className={rowClassName}
                    onClick={(event) => {
                      if (event.detail > 1) return
                      if (projectFilter === project.id) {
                        clearDeselectTimer()
                        deselectTimerRef.current = window.setTimeout(() => {
                          deselectTimerRef.current = null
                          onSelectProject?.(project.id)
                        }, 280)
                        return
                      }
                      onSelectProject?.(project.id)
                    }}
                    onDoubleClick={(event) => {
                      event.preventDefault()
                      startRename(project)
                    }}
                    onDragEnter={(event) => {
                      if (!canDropOnProject(event.dataTransfer)) return
                      event.preventDefault()
                      event.stopPropagation()
                      setDropTargetId(project.id)
                    }}
                    onDragOver={(event) => {
                      if (!canDropOnProject(event.dataTransfer)) return
                      event.preventDefault()
                      event.stopPropagation()
                      event.dataTransfer.dropEffect = 'copy'
                      setDropTargetId(project.id)
                    }}
                    onDragLeave={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget as Node)) return
                      setDropTargetId((current) => (current === project.id ? null : current))
                    }}
                    onDrop={(event) => {
                      if (!canDropOnProject(event.dataTransfer)) return
                      event.preventDefault()
                      event.stopPropagation()
                      setDropTargetId(null)
                      const ids = readFontButlerEntries(event.dataTransfer)
                      if (ids.length > 0) {
                        onAddFontsToProject?.(project.id, ids)
                        return
                      }
                      onDropFilesOnProject?.(project.id, event.dataTransfer)
                    }}
                  >
                    {rowBody}
                  </Button>
                  )}
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => {
                      window.setTimeout(() => startRename(project), 0)
                    }}
                  >
                    <Pencil /> Rename project
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => onActivateProject?.(project.id)}>
                    <Power /> Activate project
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => onDeactivateProject?.(project.id)}>
                    <PowerOff /> Release project
                  </ContextMenuItem>
                  {onRemoveProject ? (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => onRemoveProject(project.id)}>
                        <FolderMinus /> Remove project
                      </ContextMenuItem>
                    </>
                  ) : null}
                </ContextMenuContent>
              </ContextMenu>
              )
            })}
              </>
            ) : null}
          </div>
        )}
        {showSavedFilters && (
          <div className="flex w-full flex-col gap-0.5 md:mt-2 md:border-t md:pt-2">
            <div className="group/filters flex w-full items-center gap-0.5 px-1 pt-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 px-1 text-left"
                aria-expanded={savedFiltersOpen}
                aria-label={savedFiltersOpen ? 'Hide saved filters' : 'Show saved filters'}
                onClick={() => setSavedFiltersOpen((value) => !value)}
              >
                <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  Saved filters
                </span>
                {savedFiltersOpen ? (
                  <ChevronDown className="size-3 opacity-0 transition-opacity group-hover/filters:opacity-70" />
                ) : (
                  <ChevronRight className="size-3 opacity-0 transition-opacity group-hover/filters:opacity-70" />
                )}
              </button>
              {onCreateSavedFilter ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground md:opacity-0 md:transition-opacity md:group-hover/filters:opacity-100"
                  aria-label="Save current filter"
                  onClick={(event) => {
                    onCreateSavedFilter()
                    event.currentTarget.blur()
                  }}
                >
                  <Plus />
                </Button>
              ) : null}
            </div>
            {savedFiltersOpen
              ? (savedFilters ?? []).map((filter) => {
                  const editing = editingFilterId === filter.id
                  const active =
                    tab === 'library' && savedFilterMatches(filter, currentCriteria)
                  const nameField = editing ? (
                    <input
                      ref={filterRenameInputRef}
                      value={filterRenameValue}
                      aria-label="Saved filter name"
                      className="min-w-0 flex-1 bg-transparent px-0 text-[13px] font-normal outline-none"
                      onChange={(event) => setFilterRenameValue(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          event.stopPropagation()
                          commitFilterRename()
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          event.stopPropagation()
                          cancelFilterRename()
                        }
                      }}
                      onBlur={commitFilterRename}
                    />
                  ) : (
                    <span
                      className="min-w-0 truncate"
                      onDoubleClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        startFilterRename(filter)
                      }}
                    >
                      {filter.name}
                    </span>
                  )
                  const rowBody = (
                    <>
                      <Filter className="size-3.5 opacity-70" />
                      {nameField}
                    </>
                  )
                  return (
                    <ContextMenu key={filter.id}>
                      <ContextMenuTrigger asChild>
                        {editing ? (
                          <div
                            className={cn(
                              'inline-flex items-center justify-start gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px]',
                              navButtonClass(active, 'w-full'),
                            )}
                            role="group"
                            aria-label="Rename saved filter"
                          >
                            {rowBody}
                          </div>
                        ) : (
                          <Button
                            type="button"
                            size="default"
                            variant="ghost"
                            aria-current={active ? 'page' : undefined}
                            className={navButtonClass(active, 'w-full')}
                            onClick={(event) => {
                              if (event.detail > 1) return
                              onSelectSavedFilter?.(filter)
                            }}
                            onDoubleClick={(event) => {
                              event.preventDefault()
                              startFilterRename(filter)
                            }}
                          >
                            {rowBody}
                          </Button>
                        )}
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          onSelect={() => {
                            window.setTimeout(() => startFilterRename(filter), 0)
                          }}
                        >
                          <Pencil /> Rename filter
                        </ContextMenuItem>
                        {onRemoveSavedFilter ? (
                          <>
                            <ContextMenuSeparator />
                            <ContextMenuItem onSelect={() => onRemoveSavedFilter(filter.id)}>
                              <FolderMinus /> Remove saved filter
                            </ContextMenuItem>
                          </>
                        ) : null}
                      </ContextMenuContent>
                    </ContextMenu>
                  )
                })
              : null}
          </div>
        )}
        {tab === 'library' && (duplicatesCount ?? 0) > 0 && onOpenDuplicates ? (
          <div className="flex w-full flex-col gap-0.5 md:mt-2 md:border-t md:pt-2">
            <Button
              type="button"
              size="default"
              variant="ghost"
              className={navButtonClass(false, 'w-full text-amber-800 dark:text-amber-200')}
              onClick={onOpenDuplicates}
            >
              <Copy className="size-3.5 opacity-70" />
              <span className="min-w-0 truncate">Duplicates</span>
              <Badge className="ml-auto bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                {duplicatesCount}
              </Badge>
            </Button>
          </div>
        ) : null}
        {tab === 'library' && (
          <div className="flex w-full flex-wrap gap-3 md:mt-2 md:flex-col md:gap-2 md:border-t md:pt-2">
            {LIBRARY_FILTER_GROUPS.map((group) => (
              <div key={group.heading} className="flex w-full flex-col gap-0.5">
                <p className="px-2 pt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  {group.heading}
                </p>
                {group.filters.map((filter) => {
                  const active = libraryFilters.includes(filter.id)
                  const Icon = filter.icon
                  return (
                    <Button
                      key={filter.id}
                      type="button"
                      size="default"
                      variant="ghost"
                      aria-pressed={active}
                      aria-label={`Filter ${filter.label.toLowerCase()}`}
                      className={navButtonClass(active, 'w-full')}
                      onClick={() => toggleFilter(filter.id)}
                    >
                      <Icon className="size-3.5 opacity-70" />
                      <span className="min-w-0 truncate">{filter.label}</span>
                      <Badge className="ml-auto">{libraryFilterCounts[filter.id] ?? 0}</Badge>
                    </Button>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </nav>
      <div className="border-t px-3 py-2">
        <Button
          variant="ghost"
          className={navButtonClass(false, 'w-full')}
          title={hasAppUpdate ? 'App update available' : undefined}
          onClick={onOpenSettings}
        >
          <Settings className="size-3.5 opacity-70" />
          <span className="min-w-0 truncate">Settings</span>
          {hasAppUpdate ? (
            <Badge tone="info" className="ml-auto">
              Update
            </Badge>
          ) : null}
        </Button>
      </div>
    </aside>
  )
}

function ProjectSortMenu({
  value,
  open,
  onOpenChange,
  onChange,
}: {
  value: ProjectSortMode
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (value: ProjectSortMode) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return
      onOpenChange(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onOpenChange])

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-6 text-muted-foreground"
        aria-label="Sort projects"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(event) => {
          const next = !open
          onOpenChange(next)
          if (!next) event.currentTarget.blur()
        }}
      >
        <Ellipsis />
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label="Sort projects"
          className="absolute top-full right-0 z-50 mt-0.5 min-w-44 rounded-md border bg-popover p-1 shadow-sm"
        >
          {(
            [
              { id: 'name', label: 'Sort by name' },
              { id: 'added', label: 'Sort by date added' },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={value === option.id}
              className="relative flex w-full cursor-default items-center rounded-md py-1.5 pr-2 pl-8 text-left text-sm outline-none hover:bg-muted"
              onClick={() => {
                onChange(option.id)
                onOpenChange(false)
              }}
            >
              {value === option.id ? (
                <Check className="pointer-events-none absolute left-2 size-4" />
              ) : null}
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

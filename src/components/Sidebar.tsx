import { useState, type ComponentType } from 'react'
import {
  ALargeSmall,
  ChevronDown,
  CircleCheck,
  CircleOff,
  Folder,
  FolderMinus,
  FolderOpen,
  Laptop,
  Link2,
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
import type { LibraryFilter } from '@/lib/types'
import { cn } from '@/lib/utils'
import { watchFolderLabel } from '@/lib/watchFolders'

export type Tab = 'library' | 'system' | 'updates'

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
  { id: 'updates', label: 'Updates', icon: RefreshCw },
]

function navButtonClass(active: boolean, extra?: string) {
  return cn(
    'h-8 justify-start font-normal text-muted-foreground',
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
  onReveal,
  onRemove,
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
  onReveal?: () => void
  onRemove?: () => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button
          size="default"
          variant="ghost"
          title={title}
          aria-current={active ? 'page' : undefined}
          className={navButtonClass(active, className)}
          onClick={onClick}
        >
          <Icon className="size-3.5 opacity-70" />
          <span className="min-w-0 truncate">{label}</span>
          {showTotal ? (
            <Badge tone={badgeTone} className="ml-auto">
              {count}
            </Badge>
          ) : null}
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onReveal || onRemove ? (
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
  libraryFilters,
  libraryFilterCounts,
  onLibraryFiltersChange,
  counts,
  onOpenSettings,
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
  libraryFilters: LibraryFilter[]
  libraryFilterCounts: Record<LibraryFilter, number>
  onLibraryFiltersChange: (value: LibraryFilter[]) => void
  counts: { library: number; system: number; updates: number }
  onOpenSettings: () => void
}) {
  const insetTrafficLights = window.fontButlerDesktop?.platform === 'darwin'
  const [fontsOpen, setFontsOpen] = useState(true)
  const [showTotals, setShowTotals] = useState(readShowTotals)
  const fontsActive = tab === 'library' && !watchFolderFilter

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
      <nav className="flex min-h-0 flex-1 flex-row flex-wrap gap-0.5 overflow-y-auto px-2 pb-2 md:flex-col md:flex-nowrap">
        {TABS.filter((item) => item.id !== 'updates' || counts.updates > 0).map((item) => {
          if (item.id === 'library') {
            return (
              <div key={item.id} className="flex w-full flex-col gap-0.5">
                <div className="flex items-center gap-0.5">
                  <SidebarItem
                    active={fontsActive}
                    icon={item.icon}
                    label={item.label}
                    count={counts.library}
                    showTotal={Boolean(showTotals.library)}
                    onShowTotalChange={(value) => changeShowTotal('library', value)}
                    onClick={() => onSelectWatchFolder(null)}
                    className="min-w-0 flex-1 md:flex-none md:flex-1"
                  />
                  {watchFolders.length > 0 && (
                    <Button
                      type="button"
                      size="default"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 px-0 text-muted-foreground"
                      aria-expanded={fontsOpen}
                      aria-label={fontsOpen ? 'Hide watch folders' : 'Show watch folders'}
                      onClick={() => setFontsOpen((value) => !value)}
                    >
                      <ChevronDown
                        className={cn('size-3.5 transition-transform', !fontsOpen && '-rotate-90')}
                      />
                    </Button>
                  )}
                </div>
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
                        title={folder}
                        onReveal={() => onRevealWatchFolder(folder)}
                        onRemove={() => onRemoveWatchFolder(folder)}
                      />
                    )
                  })}
              </div>
            )
          }
          return (
            <SidebarItem
              key={item.id}
              active={tab === item.id}
              icon={item.icon}
              label={item.label}
              count={item.id === 'system' ? counts.system : counts.updates}
              showTotal={Boolean(showTotals[item.id])}
              onShowTotalChange={(value) => changeShowTotal(item.id, value)}
              onClick={() => onTabChange(item.id)}
              className="flex-1 md:flex-none"
              badgeTone={item.id === 'updates' ? 'warn' : 'muted'}
            />
          )
        })}
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
      <div className="border-t p-2">
        <Button
          variant="ghost"
          className="h-8 w-full justify-start font-normal text-muted-foreground"
          onClick={onOpenSettings}
        >
          <Settings className="size-3.5 opacity-70" />
          Settings
        </Button>
      </div>
    </aside>
  )
}

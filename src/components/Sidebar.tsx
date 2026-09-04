import { useState, type ComponentType } from 'react'
import { Archive, ChevronDown, Folder, Laptop, RefreshCw, Search, Settings, Type } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  readShowTotals,
  setShowTotal,
  watchShowTotalId,
  writeShowTotals,
} from '@/lib/showTotals'
import { cn } from '@/lib/utils'
import { watchFolderLabel } from '@/lib/watchFolders'

export type Tab = 'library' | 'system' | 'uninstalled' | 'updates'

const TABS: { id: Tab; label: string; icon: typeof Type }[] = [
  { id: 'library', label: 'Fonts', icon: Type },
  { id: 'system', label: 'On this Mac', icon: Laptop },
  { id: 'uninstalled', label: 'Uninstalled', icon: Archive },
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
  counts: { library: number; system: number; uninstalled: number; updates: number }
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
              count={
                item.id === 'system'
                  ? counts.system
                  : item.id === 'updates'
                    ? counts.updates
                    : counts.uninstalled
              }
              showTotal={Boolean(showTotals[item.id])}
              onShowTotalChange={(value) => changeShowTotal(item.id, value)}
              onClick={() => onTabChange(item.id)}
              className="flex-1 md:flex-none"
              badgeTone={item.id === 'updates' ? 'warn' : 'muted'}
            />
          )
        })}
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

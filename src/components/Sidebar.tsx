import { Archive, Laptop, RefreshCw, Search, Settings, Type } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type Tab = 'library' | 'system' | 'uninstalled' | 'updates'

const TABS: { id: Tab; label: string; icon: typeof Type }[] = [
  { id: 'library', label: 'Fonts', icon: Type },
  { id: 'system', label: 'On this Mac', icon: Laptop },
  { id: 'uninstalled', label: 'Uninstalled', icon: Archive },
  { id: 'updates', label: 'Updates', icon: RefreshCw },
]

export function Sidebar({
  query,
  onQueryChange,
  tab,
  onTabChange,
  counts,
  onOpenSettings,
}: {
  query: string
  onQueryChange: (value: string) => void
  tab: Tab
  onTabChange: (tab: Tab) => void
  counts: { uninstalled: number; updates: number }
  onOpenSettings: () => void
}) {
  const insetTrafficLights = window.fontButlerDesktop?.platform === 'darwin'

  return (
    <aside
      className={cn(
        'flex w-full shrink-0 flex-col border-b bg-sidebar text-sidebar-foreground md:h-full md:w-56 md:border-r md:border-b-0',
        insetTrafficLights && 'app-region-drag',
      )}
    >
      {insetTrafficLights ? <div className="hidden h-10 shrink-0 md:block" aria-hidden /> : null}
      <div className="flex flex-col gap-3 px-3 pt-3 pb-2">
        <div className="px-1">
          <h1 className="text-[15px] font-semibold leading-none tracking-tight">Font Butler</h1>
          <p className="mt-1 text-[12px] text-muted-foreground">Source-tracked fonts</p>
        </div>
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
      <nav className="flex flex-1 flex-row flex-wrap gap-0.5 px-2 pb-2 md:flex-col md:flex-nowrap">
        {TABS.filter((item) => item.id !== 'updates' || counts.updates > 0).map((item) => {
          const Icon = item.icon
          const count =
            item.id === 'updates'
              ? counts.updates
              : item.id === 'uninstalled'
                ? counts.uninstalled
                : null
          const active = tab === item.id
          return (
            <Button
              key={item.id}
              size="default"
              variant="ghost"
              aria-current={active ? 'page' : undefined}
              className={cn(
                'h-8 flex-1 justify-start font-normal text-muted-foreground md:flex-none',
                active && 'bg-black/[0.05] font-medium text-foreground dark:bg-white/[0.08]',
              )}
              onClick={() => onTabChange(item.id)}
            >
              <Icon className="size-3.5 opacity-70" />
              <span className="min-w-0 truncate">{item.label}</span>
              {count ? (
                <Badge
                  tone={item.id === 'updates' ? 'warn' : 'muted'}
                  className="ml-auto"
                >
                  {count}
                </Badge>
              ) : null}
            </Button>
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

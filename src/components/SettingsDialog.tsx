import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen, Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSetActionStatus } from '@/components/NotifyProvider'
import { api } from '@/lib/api'
import type { AppSettings, SortMode, ThemeMode, ViewLayout } from '@/lib/types'
import { cn } from '@/lib/utils'

const selectClass =
  'h-8 w-full rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/30'

const THEME_OPTIONS: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
]

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: AppSettings | null
  onSettingsChange: (settings: AppSettings) => void
}) {
  const folderInputRef = useRef<HTMLInputElement>(null)
  const setActionStatus = useSetActionStatus()
  const [busy, setBusy] = useState(false)
  const canPickFolder = Boolean(window.fontButlerDesktop?.pickFolder)
  const watchFolder = settings?.watchFolder ?? ''

  async function save(patch: {
    watchFolder?: string | null
    defaultView?: ViewLayout
    defaultSort?: SortMode
    installAfterUpload?: boolean
    theme?: ThemeMode
    menuBarIcon?: boolean
  }) {
    setBusy(true)
    const watchingFolder = 'watchFolder' in patch
    if (watchingFolder) setActionStatus('Updating watch folder…')
    try {
      const result = await api.updateSettings(patch)
      onSettingsChange(result.settings)
      if (watchingFolder) {
        toast.success(result.settings.watchFolder ? 'Watch folder updated' : 'Watch folder removed')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save settings')
    } finally {
      setBusy(false)
      if (watchingFolder) setActionStatus(null)
    }
  }

  async function chooseFolder() {
    const picked = await window.fontButlerDesktop?.pickFolder()
    if (!picked) return
    await save({ watchFolder: picked })
  }

  function folderFromInput(): string {
    return folderInputRef.current?.value.trim() || watchFolder
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,520px)]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Watch a folder for new fonts, choose whether to install them on drop, and set
            appearance and how families are shown by default.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Watch folder</h2>
            <p className="text-sm text-muted-foreground">
              Fonts you add to this folder are imported automatically. Source files stay linked to
              their original path.
            </p>
            <div className="flex flex-col gap-2">
              <Input
                key={watchFolder || 'none'}
                ref={folderInputRef}
                defaultValue={watchFolder}
                placeholder="/Users/you/Fonts/Inbox"
                aria-label="Watch folder path"
              />
              <div className="flex flex-wrap gap-2">
                {canPickFolder && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void chooseFolder()}
                  >
                    <FolderOpen className="size-4" />
                    Choose folder
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const next = folderFromInput()
                    if (!next) return
                    void save({ watchFolder: next })
                  }}
                >
                  Use this folder
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || !watchFolder}
                  onClick={() => void save({ watchFolder: null })}
                >
                  Remove
                </Button>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Adding fonts</h2>
            <Label className="flex cursor-pointer items-start gap-2 font-normal text-foreground">
              <input
                type="checkbox"
                checked={settings?.installAfterUpload !== false}
                disabled={busy || !settings}
                onChange={(event) =>
                  void save({ installAfterUpload: event.target.checked })
                }
                className="mt-0.5 size-3.5 rounded border border-input accent-primary"
              />
              <span>
                <span className="block text-sm">Install after adding</span>
                <span className="block text-sm text-muted-foreground">
                  Dropping fonts or folders onto Font Butler installs them and selects them in the
                  list. Turn this off to add fonts to the library without installing.
                </span>
              </span>
            </Label>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Menu bar</h2>
            <Label className="flex cursor-pointer items-start gap-2 font-normal text-foreground">
              <input
                type="checkbox"
                checked={settings?.menuBarIcon !== false}
                disabled={busy || !settings}
                onChange={(event) => void save({ menuBarIcon: event.target.checked })}
                className="mt-0.5 size-3.5 rounded border border-input accent-primary"
              />
              <span>
                <span className="block text-sm">Icon in menu bar</span>
                <span className="block text-sm text-muted-foreground">
                  Keep Font Butler running in the menu bar after you close the window. Click the
                  icon to reinstall updated fonts, clear caches, or quit.
                </span>
              </span>
            </Label>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Appearance</h2>
            <p className="text-sm text-muted-foreground">
              Light and dark apply immediately. System follows your macOS appearance.
            </p>
            <div
              role="radiogroup"
              aria-label="Appearance"
              className="flex items-center gap-0.5 rounded-md border bg-background p-0.5"
            >
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon
                const selected = (settings?.theme ?? 'system') === option.id
                return (
                  <Button
                    key={option.id}
                    type="button"
                    size="sm"
                    variant="ghost"
                    role="radio"
                    aria-checked={selected}
                    disabled={busy || !settings}
                    className={cn(
                      'h-8 flex-1 gap-1.5',
                      selected ? 'bg-muted font-medium' : 'text-muted-foreground',
                    )}
                    onClick={() => {
                      if (!selected) void save({ theme: option.id })
                    }}
                  >
                    <Icon className="size-3.5" />
                    {option.label}
                  </Button>
                )
              })}
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="default-view">Default view</Label>
              <select
                id="default-view"
                className={selectClass}
                value={settings?.defaultView ?? 'list'}
                disabled={busy || !settings}
                onChange={(event) =>
                  void save({ defaultView: event.target.value as ViewLayout })
                }
              >
                <option value="list">List</option>
                <option value="grid">Grid</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="default-sort">Default sort</Label>
              <select
                id="default-sort"
                className={selectClass}
                value={settings?.defaultSort ?? 'name'}
                disabled={busy || !settings}
                onChange={(event) =>
                  void save({ defaultSort: event.target.value as SortMode })
                }
              >
                <option value="name">A–Z</option>
                <option value="installed">Installed</option>
              </select>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

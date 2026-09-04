import { useRef, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import type { AppSettings, SortMode, ViewLayout } from '@/lib/types'

const selectClass =
  'h-8 w-full rounded-md border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

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
  const [busy, setBusy] = useState(false)
  const canPickFolder = Boolean(window.fontButlerDesktop?.pickFolder)
  const watchFolder = settings?.watchFolder ?? ''

  async function save(patch: {
    watchFolder?: string | null
    defaultView?: ViewLayout
    defaultSort?: SortMode
  }) {
    setBusy(true)
    try {
      const result = await api.updateSettings(patch)
      onSettingsChange(result.settings)
      if ('watchFolder' in patch) {
        toast.success(
          result.settings.watchFolder
            ? 'Watch folder updated'
            : 'Watch folder removed',
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save settings')
    } finally {
      setBusy(false)
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
            Watch a folder for new fonts, and choose how families are shown by default.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Watch folder</h2>
            <p className="text-sm text-muted-foreground">
              Fonts you add to this folder are imported automatically, the same as dropping
              them onto Font Butler. Source files stay linked to their original path.
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

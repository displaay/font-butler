import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen, Monitor, Moon, Sun, X } from 'lucide-react'
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
import { requestNotificationPermission } from '@/lib/notifications'
import type {
  AdobeFontCacheInfo,
  AppSettings,
  OfficeFontCacheInfo,
  SortMode,
  ThemeMode,
  ViewLayout,
} from '@/lib/types'
import { cn } from '@/lib/utils'
import { mergeWatchFolders, watchFolderName } from '@/lib/watchFolders'

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
  const [officeFontCache, setOfficeFontCache] = useState<OfficeFontCacheInfo | null>(null)
  const [adobeFontCache, setAdobeFontCache] = useState<AdobeFontCacheInfo | null>(null)
  const canPickFolder = Boolean(window.fontButlerDesktop?.pickFolder)
  const isDesktop = Boolean(window.fontButlerDesktop)
  const watchFolders = settings?.watchFolders ?? []
  const officeCacheEnabled = settings?.clearOfficeFontCache !== false
  const adobeCacheEnabled = settings?.clearAdobeFontCache !== false

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void api
      .settings()
      .then((result) => {
        if (cancelled) return
        setOfficeFontCache(result.officeFontCache)
        setAdobeFontCache(result.adobeFontCache)
      })
      .catch(() => {
        if (cancelled) return
        setOfficeFontCache(null)
        setAdobeFontCache(null)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function save(patch: {
    watchFolders?: string[]
    defaultView?: ViewLayout
    defaultSort?: SortMode
    installAfterUpload?: boolean
    installWatchFolderFonts?: boolean
    theme?: ThemeMode
    menuBarIcon?: boolean
    openAtLogin?: boolean
    clearOfficeFontCache?: boolean
    clearAdobeFontCache?: boolean
    autoReinstallOnUpdate?: boolean
    skipCacheClearOnReinstall?: boolean
    nativeNotifications?: boolean
    onboardingCompleted?: boolean
  }) {
    setBusy(true)
    const watchingFolder = 'watchFolders' in patch
    if (watchingFolder) setActionStatus('Updating watch folders…')
    try {
      const result = await api.updateSettings(patch)
      onSettingsChange(result.settings)
      if (result.officeFontCache) setOfficeFontCache(result.officeFontCache)
      if (result.adobeFontCache) setAdobeFontCache(result.adobeFontCache)
      if (watchingFolder) {
        const before = watchFolders.length
        const after = result.settings.watchFolders.length
        toast.success(
          after > before
            ? after === 1
              ? 'Watch folder added'
              : 'Watch folders updated'
            : after < before
              ? 'Watch folder removed'
              : 'Watch folders updated',
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save settings')
    } finally {
      setBusy(false)
      if (watchingFolder) setActionStatus(null)
    }
  }

  async function addFolders(folders: string[]) {
    const next = mergeWatchFolders(watchFolders, folders)
    if (next.length === watchFolders.length) {
      toast.message(folders.length === 1 ? 'Already watching that folder' : 'Already watching those folders')
      return
    }
    await save({ watchFolders: next })
  }

  async function chooseFolder() {
    const picked = await window.fontButlerDesktop?.pickFolder()
    if (!picked) return
    await addFolders([picked])
  }

  function addTypedFolder() {
    const next = folderInputRef.current?.value.trim()
    if (!next) return
    void addFolders([next]).then(() => {
      if (folderInputRef.current) folderInputRef.current.value = ''
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,900px)] w-[min(92vw,640px)] flex-col overflow-hidden p-6">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Watch folders for new fonts, choose whether to install them on drop, and set
            appearance and how families are shown by default.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain">
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Watch folders</h2>
            <p className="text-sm text-muted-foreground">
              Fonts you add to these folders are imported automatically. Source files stay linked
              to their original path.
            </p>
            {watchFolders.length > 0 && (
              <ul className="space-y-1.5">
                {watchFolders.map((folder) => (
                  <li
                    key={folder}
                    className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{watchFolderName(folder)}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground" title={folder}>
                        {folder}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 px-0"
                      disabled={busy}
                      aria-label={`Stop watching ${watchFolderName(folder)}`}
                      onClick={() =>
                        void save({
                          watchFolders: watchFolders.filter((item) => item !== folder),
                        })
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-2">
              <Input
                ref={folderInputRef}
                placeholder="/Users/you/Fonts/Inbox"
                aria-label="Watch folder path"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addTypedFolder()
                  }
                }}
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
                <Button type="button" variant="outline" disabled={busy} onClick={addTypedFolder}>
                  Add folder
                </Button>
              </div>
            </div>
            <Label className="flex cursor-pointer items-start gap-2 font-normal text-foreground">
              <input
                type="checkbox"
                checked={settings?.installWatchFolderFonts !== false}
                disabled={busy || !settings}
                onChange={(event) =>
                  void save({ installWatchFolderFonts: event.target.checked })
                }
                className="mt-0.5 size-3.5 rounded border border-input accent-primary"
              />
              <span>
                <span className="block text-sm">Install fonts added to watch folders</span>
                <span className="block text-sm text-muted-foreground">
                  When a font file appears in a watch folder, install it. Turn this off to keep
                  those fonts in the library without installing.
                </span>
              </span>
            </Label>
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
                  Dropping fonts, or adding a watch folder, installs them and selects them in the
                  list. Turn this off to add fonts to the library without installing.
                </span>
              </span>
            </Label>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Updates</h2>
            <Label className="flex cursor-pointer items-start gap-2 font-normal text-foreground">
              <input
                type="checkbox"
                checked={settings?.autoReinstallOnUpdate === true}
                disabled={busy || !settings}
                onChange={(event) =>
                  void save({ autoReinstallOnUpdate: event.target.checked })
                }
                className="mt-0.5 size-3.5 rounded border border-input accent-primary"
              />
              <span>
                <span className="block text-sm">Automatically reinstall when an update is detected</span>
                <span className="block text-sm text-muted-foreground">
                  When a tracked source file changes, reinstall the installed copy. Off by default.
                </span>
              </span>
            </Label>
            <Label className="flex cursor-pointer items-start gap-2 font-normal text-foreground">
              <input
                type="checkbox"
                checked={settings?.skipCacheClearOnReinstall === true}
                disabled={busy || !settings}
                onChange={(event) =>
                  void save({ skipCacheClearOnReinstall: event.target.checked })
                }
                className="mt-0.5 size-3.5 rounded border border-input accent-primary"
              />
              <span>
                <span className="block text-sm">Turn off clearing caches during reinstall</span>
                <span className="block text-sm text-muted-foreground">
                  Skip ATS, Office, and Adobe cache clearing when you reinstall fonts. The Font
                  cache menu still works.
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
                  Keep Font Buttler running in the menu bar after you close the window. Click the
                  icon to reinstall updated fonts, clear caches, or quit.
                </span>
              </span>
            </Label>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Microsoft Office cache</h2>
            <Label className="flex cursor-pointer items-start gap-2 font-normal text-foreground">
              <input
                type="checkbox"
                checked={officeCacheEnabled}
                disabled={busy || !settings}
                onChange={(event) =>
                  void save({ clearOfficeFontCache: event.target.checked })
                }
                className="mt-0.5 size-3.5 rounded border border-input accent-primary"
              />
              <span>
                <span className="block text-sm">Remove MS Office cache</span>
                <span className="block text-sm text-muted-foreground">
                  Clear Office’s FontCache when you reinstall fonts or use the Font cache menu.
                  Turn this off to leave Office alone.
                </span>
              </span>
            </Label>
            {officeCacheEnabled && (
              <div className="rounded-md border bg-background px-2 py-1.5">
                {officeFontCache?.exists ? (
                  <>
                    <div className="text-sm">Found on this Mac</div>
                    <div
                      className="truncate font-mono text-[11px] text-muted-foreground"
                      title={officeFontCache.path}
                    >
                      {officeFontCache.path}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-muted-foreground">
                      No Microsoft Office font cache was found on this Mac.
                    </div>
                    {officeFontCache?.path ? (
                      <div
                        className="truncate font-mono text-[11px] text-muted-foreground"
                        title={officeFontCache.path}
                      >
                        Looked in {officeFontCache.path}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Adobe cache</h2>
            <Label className="flex cursor-pointer items-start gap-2 font-normal text-foreground">
              <input
                type="checkbox"
                checked={adobeCacheEnabled}
                disabled={busy || !settings}
                onChange={(event) =>
                  void save({ clearAdobeFontCache: event.target.checked })
                }
                className="mt-0.5 size-3.5 rounded border border-input accent-primary"
              />
              <span>
                <span className="block text-sm">Remove Adobe font cache</span>
                <span className="block text-sm text-muted-foreground">
                  Clear Adobe font list caches when you reinstall fonts or use the Font cache
                  menu. Open Adobe apps still need a relaunch. Turn this off to leave Adobe
                  alone.
                </span>
              </span>
            </Label>
            {adobeCacheEnabled && (
              <div className="rounded-md border bg-background px-2 py-1.5">
                {adobeFontCache?.exists ? (
                  <>
                    <div className="text-sm">
                      Found {adobeFontCache.paths.length}{' '}
                      {adobeFontCache.paths.length === 1 ? 'location' : 'locations'} on this Mac
                    </div>
                    {adobeFontCache.paths.slice(0, 3).map((item) => (
                      <div
                        key={item}
                        className="truncate font-mono text-[11px] text-muted-foreground"
                        title={item}
                      >
                        {item}
                      </div>
                    ))}
                    {adobeFontCache.paths.length > 3 ? (
                      <div className="text-[11px] text-muted-foreground">
                        and {adobeFontCache.paths.length - 3} more
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="text-sm text-muted-foreground">
                      No Adobe font cache was found on this Mac.
                    </div>
                    {adobeFontCache?.roots[0] ? (
                      <div
                        className="truncate font-mono text-[11px] text-muted-foreground"
                        title={adobeFontCache.roots.join('\n')}
                      >
                        Looked in {adobeFontCache.roots[0]}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </section>

          {isDesktop && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-foreground">Startup</h2>
              <Label className="flex cursor-pointer items-start gap-2 font-normal text-foreground">
                <input
                  type="checkbox"
                  checked={settings?.openAtLogin === true}
                  disabled={busy || !settings}
                  onChange={(event) => void save({ openAtLogin: event.target.checked })}
                  className="mt-0.5 size-3.5 rounded border border-input accent-primary"
                />
                <span>
                  <span className="block text-sm">Open at login</span>
                  <span className="block text-sm text-muted-foreground">
                    Start Font Buttler when you turn on this computer.
                  </span>
                </span>
              </Label>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Notifications</h2>
            <Label className="flex cursor-pointer items-start gap-2 font-normal text-foreground">
              <input
                type="checkbox"
                checked={settings?.nativeNotifications === true}
                disabled={busy || !settings}
                onChange={(event) => {
                  const enabled = event.target.checked
                  if (!enabled) {
                    void save({ nativeNotifications: false })
                    return
                  }
                  void (async () => {
                    const permission = await requestNotificationPermission()
                    if (permission !== 'granted') {
                      toast.message(
                        'Notifications were not allowed. You can enable them in System Settings.',
                      )
                      return
                    }
                    await save({ nativeNotifications: true })
                  })()
                }}
                className="mt-0.5 size-3.5 rounded border border-input accent-primary"
              />
              <span>
                <span className="block text-sm">Allow notifications</span>
                <span className="block text-sm text-muted-foreground">
                  Font Buttler can notify you when fonts are installed or updated.
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
                <option value="added">Added</option>
              </select>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

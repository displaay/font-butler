import { useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import {
  Eraser,
  FolderOpen,
  History,
  Layers,
  Monitor,
  Moon,
  Pause,
  Play,
  Settings,
  Sun,
  Type,
  X,
} from 'lucide-react'
import { FolderRelinkDialog } from '@/components/FolderRelinkDialog'
import { FolderSetupDialog } from '@/components/FolderSetupDialog'
import { AppUpdateCard } from '@/components/AppUpdateCard'
import { SettingsRow, SettingsSection } from '@/components/SettingsRow'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSetActionStatus } from '@/components/NotifyProvider'
import { api } from '@/lib/api'
import { persistNativeNotificationsEnabled, requestNotificationPermission } from '@/lib/notifications'
import type {
  AdobeFontCacheInfo,
  AppSettings,
  AppUpdateStatus,
  DestinationCapability,
  DestinationInvestigationRow,
  OfficeFontCacheInfo,
  SortMode,
  ThemeMode,
  ViewLayout,
} from '@/lib/types'
import { cn } from '@/lib/utils'
import { DESTINATIONS, FOLDER_POLICIES, adobeTestingFolderAvailable, destinationLabel, destinationNeedsAdobe, folderAvailabilityLabel, folderPolicyLabel } from '@/lib/folders'
import { watchFolderName } from '@/lib/watchFolders'
import type { FolderPolicyPreset, WatchFolder } from '@/lib/types'

const selectClass =
  'h-8 w-auto min-w-[9.5rem] max-w-full rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/30'

const checkboxClass = 'size-4 shrink-0 cursor-pointer rounded border border-input accent-primary'

const THEME_OPTIONS: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
]

type SettingsCategoryId =
  | 'general'
  | 'folders'
  | 'fonts'
  | 'destinations'
  | 'caches'
  | 'history'

const CATEGORIES: {
  id: SettingsCategoryId
  label: string
  icon: ComponentType<{ className?: string }>
  description: string
}[] = [
  {
    id: 'general',
    label: 'General',
    icon: Settings,
    description: 'Appearance, library defaults, and how Font Buttler runs on this Mac.',
  },
  {
    id: 'folders',
    label: 'Watch folders',
    icon: FolderOpen,
    description: 'Watch folders for new fonts and choose a policy for each one.',
  },
  {
    id: 'fonts',
    label: 'Fonts',
    icon: Type,
    description: 'Choose whether dropped or updated fonts are installed automatically.',
  },
  {
    id: 'destinations',
    label: 'Destinations',
    icon: Layers,
    description: 'Where Font Buttler places installed copies, including the Adobe testing folder.',
  },
  {
    id: 'caches',
    label: 'Caches',
    icon: Eraser,
    description: 'Clear Office and Adobe font caches when you reinstall or use the Font cache menu.',
  },
  {
    id: 'history',
    label: 'History',
    icon: History,
    description: 'How long retained versions and activity stay on this Mac.',
  },
]

type SettingsPatch = {
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
  revisionBudgetBytes?: number
  activityRetentionDays?: number
  activityMaxOperations?: number
  defaultDestination?: AppSettings['defaultDestination']
}

function navButtonClass(active: boolean) {
  return cn(
    'h-8 w-full justify-start font-normal text-muted-foreground',
    active && 'bg-black/[0.05] font-medium text-foreground dark:bg-white/[0.08]',
  )
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  onDestinationsChange,
  appUpdate = null,
  checkingAppUpdate = false,
  onCheckAppUpdate,
  highlightAppUpdate = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: AppSettings | null
  onSettingsChange: (settings: AppSettings) => void
  onDestinationsChange?: (destinations: DestinationCapability[]) => void
  appUpdate?: AppUpdateStatus | null
  checkingAppUpdate?: boolean
  onCheckAppUpdate?: (refresh?: boolean) => void
  highlightAppUpdate?: boolean
}) {
  const setActionStatus = useSetActionStatus()
  const tablistId = useId()
  const [category, setCategory] = useState<SettingsCategoryId>('general')
  const [busy, setBusy] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [relinkRoot, setRelinkRoot] = useState<string | null>(null)
  const [officeFontCache, setOfficeFontCache] = useState<OfficeFontCacheInfo | null>(null)
  const [adobeFontCache, setAdobeFontCache] = useState<AdobeFontCacheInfo | null>(null)
  const [destinations, setDestinations] = useState<DestinationCapability[]>([])
  const [investigation, setInvestigation] = useState<DestinationInvestigationRow[]>([])
  const tabRefs = useRef<Partial<Record<SettingsCategoryId, HTMLButtonElement | null>>>({})
  const isDesktop = Boolean(window.fontButlerDesktop)
  const watchFolders = settings?.watchFolders ?? []
  const folders = settings?.folders ?? []
  const officeCacheEnabled = settings?.clearOfficeFontCache !== false
  const adobeCacheEnabled = settings?.clearAdobeFontCache !== false
  const selected = CATEGORIES.find((item) => item.id === category) ?? CATEGORIES[0]

  useEffect(() => {
    if (open) return
    setCategory('general')
  }, [open])

  useEffect(() => {
    if (!open || !highlightAppUpdate) return
    setCategory('general')
  }, [open, highlightAppUpdate])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void api
      .settings()
      .then((result) => {
        if (cancelled) return
        setOfficeFontCache(result.officeFontCache)
        setAdobeFontCache(result.adobeFontCache)
        if (result.destinations) {
          setDestinations(result.destinations.destinations)
          setInvestigation(result.destinations.investigation)
          onDestinationsChange?.(result.destinations.destinations)
        }
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

  async function createAdobeFolder() {
    setBusy(true)
    try {
      const result = await api.createAdobeTestingFolder()
      setDestinations(result.destinations)
      setInvestigation(result.investigation)
      onDestinationsChange?.(result.destinations)
      toast.success('Created the Adobe testing folder')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create that folder')
    } finally {
      setBusy(false)
    }
  }

  async function save(patch: SettingsPatch) {
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

  function selectCategory(id: SettingsCategoryId, focus = false) {
    setCategory(id)
    if (focus) tabRefs.current[id]?.focus()
  }

  function onCategoryKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = CATEGORIES.findIndex((item) => item.id === category)
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      selectCategory(CATEGORIES[(index + 1) % CATEGORIES.length].id, true)
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      selectCategory(CATEGORIES[(index - 1 + CATEGORIES.length) % CATEGORIES.length].id, true)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      selectCategory(CATEGORIES[0].id, true)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      selectCategory(CATEGORIES[CATEGORIES.length - 1].id, true)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(86vh,620px)] w-[min(92vw,820px)] flex-col overflow-hidden p-0">
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-[200px] shrink-0 flex-col border-r bg-muted/30 px-2 pb-3 pt-4">
            <DialogTitle className="px-2 pb-3 text-base font-semibold tracking-tight">
              Settings
            </DialogTitle>
            <div
              role="tablist"
              aria-label="Settings categories"
              aria-orientation="vertical"
              className="flex flex-col gap-0.5"
            >
              {CATEGORIES.map((item) => {
                const Icon = item.icon
                const active = item.id === category
                return (
                  <Button
                    key={item.id}
                    ref={(node) => {
                      tabRefs.current[item.id] = node
                    }}
                    type="button"
                    size="default"
                    variant="ghost"
                    role="tab"
                    id={`${tablistId}-${item.id}`}
                    aria-selected={active}
                    aria-controls={`${tablistId}-panel`}
                    tabIndex={active ? 0 : -1}
                    className={navButtonClass(active)}
                    onClick={() => selectCategory(item.id)}
                    onKeyDown={onCategoryKeyDown}
                  >
                    <Icon className="size-3.5 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                  </Button>
                )
              })}
            </div>
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="shrink-0 space-y-1 border-b px-5 py-4 pr-12">
              <h2 className="text-base font-semibold tracking-tight">{selected.label}</h2>
              <DialogDescription>{selected.description}</DialogDescription>
            </header>
            <div
              role="tabpanel"
              id={`${tablistId}-panel`}
              aria-labelledby={`${tablistId}-${selected.id}`}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
            >
              {category === 'general' && (
                <GeneralPane
                  settings={settings}
                  busy={busy}
                  isDesktop={isDesktop}
                  onSave={save}
                  appUpdate={appUpdate}
                  checkingAppUpdate={checkingAppUpdate}
                  onCheckAppUpdate={onCheckAppUpdate}
                  highlightAppUpdate={highlightAppUpdate}
                />
              )}
              {category === 'folders' && (
                <FoldersPane
                  settings={settings}
                  folders={folders}
                  watchFolders={watchFolders}
                  busy={busy}
                  onSave={save}
                  onAddFolder={() => setSetupOpen(true)}
                  onRelink={(root) => setRelinkRoot(root)}
                  onSettingsChange={onSettingsChange}
                />
              )}
              {category === 'fonts' && (
                <FontsPane settings={settings} busy={busy} onSave={save} />
              )}
              {category === 'destinations' && (
                <DestinationsPane
                  settings={settings}
                  busy={busy}
                  destinations={destinations}
                  investigation={investigation}
                  onSave={save}
                  onCreateAdobeFolder={() => void createAdobeFolder()}
                />
              )}
              {category === 'caches' && (
                <CachesPane
                  settings={settings}
                  busy={busy}
                  officeCacheEnabled={officeCacheEnabled}
                  adobeCacheEnabled={adobeCacheEnabled}
                  officeFontCache={officeFontCache}
                  adobeFontCache={adobeFontCache}
                  onSave={save}
                />
              )}
              {category === 'history' && (
                <HistoryPane settings={settings} busy={busy} onSave={save} />
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <FolderSetupDialog
      open={setupOpen}
      onOpenChange={setSetupOpen}
      onDone={async () => {
        const latest = await api.settings()
        onSettingsChange(latest.settings)
      }}
    />
    <FolderRelinkDialog
      open={Boolean(relinkRoot)}
      oldRoot={relinkRoot ?? ''}
      onOpenChange={(next) => {
        if (!next) setRelinkRoot(null)
      }}
      onDone={() => {
        void api.settings().then((result) => onSettingsChange(result.settings))
      }}
    />
    </>
  )
}

function GeneralPane({
  settings,
  busy,
  isDesktop,
  onSave,
  appUpdate,
  checkingAppUpdate,
  onCheckAppUpdate,
  highlightAppUpdate,
}: {
  settings: AppSettings | null
  busy: boolean
  isDesktop: boolean
  onSave: (patch: SettingsPatch) => Promise<void>
  appUpdate: AppUpdateStatus | null
  checkingAppUpdate: boolean
  onCheckAppUpdate?: (refresh?: boolean) => void
  highlightAppUpdate: boolean
}) {
  return (
    <div>
      <SettingsSection title="Appearance">
        <SettingsRow
          label="Theme"
          description="Light and dark apply immediately. System follows your macOS appearance."
        >
          <div
            role="radiogroup"
            aria-label="Theme"
            className="inline-flex items-center gap-0.5 rounded-md border bg-background p-0.5"
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
                    'h-8 gap-1.5 px-2.5',
                    selected ? 'bg-muted font-medium' : 'text-muted-foreground',
                  )}
                  onClick={() => {
                    if (!selected) void onSave({ theme: option.id })
                  }}
                >
                  <Icon className="size-3.5" />
                  {option.label}
                </Button>
              )
            })}
          </div>
        </SettingsRow>
        <SettingsRow
          label="Default view"
          description="List or grid when you open the library."
          htmlFor="default-view"
        >
          <select
            id="default-view"
            className={selectClass}
            value={settings?.defaultView ?? 'list'}
            disabled={busy || !settings}
            onChange={(event) =>
              void onSave({ defaultView: event.target.value as ViewLayout })
            }
          >
            <option value="list">List</option>
            <option value="grid">Grid</option>
          </select>
        </SettingsRow>
        <SettingsRow
          label="Default sort"
          description="How fonts are ordered when you open the library."
          htmlFor="default-sort"
        >
          <select
            id="default-sort"
            className={selectClass}
            value={settings?.defaultSort ?? 'name'}
            disabled={busy || !settings}
            onChange={(event) =>
              void onSave({ defaultSort: event.target.value as SortMode })
            }
          >
            <option value="name">A–Z</option>
            <option value="added">Added</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="App">
        <SettingsRow
          label="Icon in menu bar"
          description="Keep Font Buttler running in the menu bar after you close the window. Click the icon to reinstall updated fonts, clear caches, or quit."
          htmlFor="menu-bar-icon"
        >
          <input
            id="menu-bar-icon"
            type="checkbox"
            checked={settings?.menuBarIcon !== false}
            disabled={busy || !settings}
            onChange={(event) => void onSave({ menuBarIcon: event.target.checked })}
            className={checkboxClass}
          />
        </SettingsRow>
        {isDesktop ? (
          <SettingsRow
            label="Open at login"
            description="Start Font Buttler when you turn on this computer."
            htmlFor="open-at-login"
          >
            <input
              id="open-at-login"
              type="checkbox"
              checked={settings?.openAtLogin === true}
              disabled={busy || !settings}
              onChange={(event) => void onSave({ openAtLogin: event.target.checked })}
              className={checkboxClass}
            />
          </SettingsRow>
        ) : null}
        <SettingsRow
          label="Allow notifications"
          description="Font Buttler can notify you when fonts are installed or updated."
          htmlFor="native-notifications"
        >
          <input
            id="native-notifications"
            type="checkbox"
            checked={settings?.nativeNotifications === true}
            disabled={busy || !settings}
            onChange={(event) => {
              const enabled = event.target.checked
              if (!enabled) {
                void onSave({ nativeNotifications: false })
                return
              }
              void (async () => {
                const permission = await requestNotificationPermission()
                const next = persistNativeNotificationsEnabled(true, permission)
                await onSave({ nativeNotifications: next })
                if (!next) {
                  toast.message(
                    'Notifications were not allowed. You can enable them in System Settings.',
                  )
                }
              })()
            }}
            className={checkboxClass}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="App updates">
        <div
          className={cn(
            'py-3.5',
            highlightAppUpdate && 'rounded-md ring-2 ring-ring/40 ring-offset-2 ring-offset-background',
          )}
        >
          <AppUpdateCard
            status={appUpdate}
            checking={checkingAppUpdate}
            onCheck={onCheckAppUpdate ? () => onCheckAppUpdate(true) : undefined}
          />
        </div>
      </SettingsSection>
    </div>
  )
}

function FoldersPane({
  settings,
  folders,
  watchFolders,
  busy,
  onSave,
  onAddFolder,
  onRelink,
  onSettingsChange,
}: {
  settings: AppSettings | null
  folders: WatchFolder[]
  watchFolders: string[]
  busy: boolean
  onSave: (patch: SettingsPatch) => Promise<void>
  onAddFolder: () => void
  onRelink: (root: string) => void
  onSettingsChange: (settings: AppSettings) => void
}) {
  return (
    <div>
      <SettingsSection>
        {folders.map((folder) => (
          <SettingsFolderRow
            key={folder.id}
            folder={folder}
            busy={busy}
            onPause={() =>
              void (folder.paused ? api.resumeFolder(folder.id) : api.pauseFolder(folder.id))
                .then(async () => onSettingsChange((await api.settings()).settings))
                .catch((error) =>
                  toast.error(error instanceof Error ? error.message : 'Could not update folder'),
                )
            }
            onPolicy={(policy) =>
              void api
                .configureFolder({ id: folder.id, root: folder.root, policy })
                .then(async () => onSettingsChange((await api.settings()).settings))
                .catch((error) =>
                  toast.error(error instanceof Error ? error.message : 'Could not update folder'),
                )
            }
            onRelink={() => onRelink(folder.root)}
            onRemove={() =>
              void onSave({
                watchFolders: watchFolders.filter((item) => item !== folder.root),
              })
            }
          />
        ))}
        <SettingsRow
          label="Add a watch folder"
          description="Each folder has its own policy. Pause stops automatic imports and updates. Adding a folder previews a scan before watching starts."
        >
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onAddFolder}>
            <FolderOpen className="size-4" />
            Add folder
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Install fonts added to watch folders"
          description="When a font file appears in a watch folder, install it. Turn this off to keep those fonts in the library without installing."
          htmlFor="install-watch-folder-fonts"
        >
          <input
            id="install-watch-folder-fonts"
            type="checkbox"
            checked={settings?.installWatchFolderFonts !== false}
            disabled={busy || !settings}
            onChange={(event) =>
              void onSave({ installWatchFolderFonts: event.target.checked })
            }
            className={checkboxClass}
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}

function FontsPane({
  settings,
  busy,
  onSave,
}: {
  settings: AppSettings | null
  busy: boolean
  onSave: (patch: SettingsPatch) => Promise<void>
}) {
  return (
    <SettingsSection>
      <SettingsRow
        label="Install after adding"
        description="Dropping fonts, or adding a watch folder, installs them and selects them in the list. Turn this off to add fonts to the library without installing."
        htmlFor="install-after-upload"
      >
        <input
          id="install-after-upload"
          type="checkbox"
          checked={settings?.installAfterUpload !== false}
          disabled={busy || !settings}
          onChange={(event) =>
            void onSave({ installAfterUpload: event.target.checked })
          }
          className={checkboxClass}
        />
      </SettingsRow>
      <SettingsRow
        label="Automatically reinstall when an update is detected"
        description="When a tracked source file changes, reinstall the installed copy. Off by default."
        htmlFor="auto-reinstall-on-update"
      >
        <input
          id="auto-reinstall-on-update"
          type="checkbox"
          checked={settings?.autoReinstallOnUpdate === true}
          disabled={busy || !settings}
          onChange={(event) =>
            void onSave({ autoReinstallOnUpdate: event.target.checked })
          }
          className={checkboxClass}
        />
      </SettingsRow>
    </SettingsSection>
  )
}

function DestinationsPane({
  settings,
  busy,
  destinations,
  investigation,
  onSave,
  onCreateAdobeFolder,
}: {
  settings: AppSettings | null
  busy: boolean
  destinations: DestinationCapability[]
  investigation: DestinationInvestigationRow[]
  onSave: (patch: SettingsPatch) => Promise<void>
  onCreateAdobeFolder: () => void
}) {
  const adobeAvailable = adobeTestingFolderAvailable(destinations)
  const adobe = destinations.find((item) => item.id === 'adobe-shared')
  const adobeRemedy = adobe?.remedy
    ?.replace(/\s*Font Buttler will not create or chmod a system Adobe folder\./g, '')
    .trim()
  return (
    <SettingsSection>
      <SettingsRow
        label="Default install destination"
        description="Choose where new installs go. Adobe is a testing folder for apps to pick up — not the same as installing for macOS, and Font Buttler does not claim a font is active in InDesign or Photoshop."
        htmlFor="default-destination"
      >
        <select
          id="default-destination"
          className={selectClass}
          aria-label="Default install destination"
          disabled={busy || !settings}
          value={settings?.defaultDestination ?? 'macos'}
          onChange={(event) =>
            void onSave({ defaultDestination: event.target.value as AppSettings['defaultDestination'] })
          }
        >
          {DESTINATIONS.map((option) => (
            <option
              key={option.id}
              value={option.id}
              disabled={destinationNeedsAdobe(option.id) && !adobeAvailable}
            >
              {option.label}
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow
        label="Adobe testing folder"
        description={
          adobe?.supported
            ? 'Available for file placement on this Mac.'
            : 'Unavailable on this Mac.'
        }
        extra={
          <div className="rounded-md border bg-background px-2.5 py-2 text-sm">
            <div className="truncate font-mono text-[11px] text-muted-foreground" title={adobe?.path}>
              {adobe?.path}
            </div>
            {adobe?.reason && !adobe.supported ? (
              <div className="mt-1 text-xs text-muted-foreground">{adobe.reason}</div>
            ) : null}
            {adobeRemedy && !adobe.canCreate ? (
              <div className="mt-1 text-xs text-muted-foreground">{adobeRemedy}</div>
            ) : null}
            {investigation[0] ? (
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer text-sm text-foreground">Compatibility notes</summary>
                <div className="mt-2 space-y-2">
                  {investigation.map((row) => (
                    <div key={row.path}>
                      <div className="font-medium text-foreground">{row.destination}</div>
                      <div>{row.applications}</div>
                      <div>{row.conclusion}</div>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        }
      >
        {adobe?.canCreate ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCreateAdobeFolder}>
            Create folder
          </Button>
        ) : null}
      </SettingsRow>
    </SettingsSection>
  )
}

function CachesPane({
  settings,
  busy,
  officeCacheEnabled,
  adobeCacheEnabled,
  officeFontCache,
  adobeFontCache,
  onSave,
}: {
  settings: AppSettings | null
  busy: boolean
  officeCacheEnabled: boolean
  adobeCacheEnabled: boolean
  officeFontCache: OfficeFontCacheInfo | null
  adobeFontCache: AdobeFontCacheInfo | null
  onSave: (patch: SettingsPatch) => Promise<void>
}) {
  return (
    <div>
      <SettingsSection title="Microsoft Office">
        <SettingsRow
          label="Remove MS Office cache"
          description="Clear Office’s FontCache when you reinstall fonts or use the Font cache menu. Turn this off to leave Office alone."
          htmlFor="clear-office-font-cache"
          extra={
            officeCacheEnabled ? (
              <div className="rounded-md border bg-background px-2.5 py-2">
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
            ) : null
          }
        >
          <input
            id="clear-office-font-cache"
            type="checkbox"
            checked={officeCacheEnabled}
            disabled={busy || !settings}
            onChange={(event) =>
              void onSave({ clearOfficeFontCache: event.target.checked })
            }
            className={checkboxClass}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Adobe">
        <SettingsRow
          label="Remove Adobe font cache"
          description="Clear Adobe font list caches when you reinstall fonts or use the Font cache menu. Open Adobe apps still need a relaunch. Turn this off to leave Adobe alone."
          htmlFor="clear-adobe-font-cache"
          extra={
            adobeCacheEnabled ? (
              <div className="rounded-md border bg-background px-2.5 py-2">
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
            ) : null
          }
        >
          <input
            id="clear-adobe-font-cache"
            type="checkbox"
            checked={adobeCacheEnabled}
            disabled={busy || !settings}
            onChange={(event) =>
              void onSave({ clearAdobeFontCache: event.target.checked })
            }
            className={checkboxClass}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Reinstall">
        <SettingsRow
          label="Clear caches during reinstall"
          description="Clear ATS, Office, and Adobe caches when you reinstall fonts. Turn this off to skip that step. The Font cache menu still works."
          htmlFor="clear-caches-on-reinstall"
        >
          <input
            id="clear-caches-on-reinstall"
            type="checkbox"
            checked={settings?.skipCacheClearOnReinstall !== true}
            disabled={busy || !settings}
            onChange={(event) =>
              void onSave({ skipCacheClearOnReinstall: !event.target.checked })
            }
            className={checkboxClass}
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}

function HistoryPane({
  settings,
  busy,
  onSave,
}: {
  settings: AppSettings | null
  busy: boolean
  onSave: (patch: SettingsPatch) => Promise<void>
}) {
  return (
    <SettingsSection>
      <SettingsRow
        label="Revision budget"
        description="How much disk retained versions may use. Required rollback and pinned copies are kept even if older extras are removed."
        htmlFor="revision-budget"
      >
        <div className="flex items-center gap-2">
          <Input
            id="revision-budget"
            type="number"
            min={64}
            className="w-[7.5rem]"
            value={Math.round((settings?.revisionBudgetBytes ?? 1073741824) / 1024 / 1024)}
            disabled={busy || !settings}
            onBlur={(event) =>
              void onSave({
                revisionBudgetBytes: Math.max(64, Number(event.target.value) || 1024) * 1024 * 1024,
              })
            }
          />
          <span className="text-[13px] text-muted-foreground">MB</span>
        </div>
      </SettingsRow>
      <SettingsRow
        label="Activity retention"
        description="How long activity stays on this Mac."
        htmlFor="activity-retention"
      >
        <div className="flex items-center gap-2">
          <Input
            id="activity-retention"
            type="number"
            min={7}
            className="w-[7.5rem]"
            value={settings?.activityRetentionDays ?? 90}
            disabled={busy || !settings}
            onBlur={(event) =>
              void onSave({ activityRetentionDays: Math.max(7, Number(event.target.value) || 90) })
            }
          />
          <span className="text-[13px] text-muted-foreground">days</span>
        </div>
      </SettingsRow>
    </SettingsSection>
  )
}

function SettingsFolderRow({
  folder,
  busy,
  onPause,
  onPolicy,
  onRelink,
  onRemove,
}: {
  folder: WatchFolder
  busy: boolean
  onPause: () => void
  onPolicy: (policy: FolderPolicyPreset) => void
  onRelink: () => void
  onRemove: () => void
}) {
  const policyOptions = FOLDER_POLICIES.filter(
    (item) => item.id !== 'custom' || folder.policy === 'custom',
  )
  const name = watchFolderName(folder.root)
  return (
    <SettingsRow
      label={<span className="block truncate" title={name}>{name}</span>}
      description={
        <span className="block">
          {folderPolicyLabel(folder.policy)} · {folderAvailabilityLabel(folder)} ·{' '}
          {destinationLabel(folder.destinationId)}
          <span className="mt-0.5 block truncate font-mono text-[11px]" title={folder.root}>
            {folder.root}
          </span>
        </span>
      }
    >
        <div className="flex max-w-[min(100%,22rem)] flex-wrap items-center justify-end gap-1.5">
          <select
            className={selectClass}
            value={folder.policy}
            disabled={busy}
            aria-label={`Policy for ${name}`}
            onChange={(event) => onPolicy(event.target.value as FolderPolicyPreset)}
          >
            {policyOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onPause}>
            {folder.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {folder.paused ? 'Resume' : 'Pause'}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRelink}>
            Relink
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 px-0"
            disabled={busy}
            aria-label={`Stop watching ${name}`}
            onClick={onRemove}
          >
            <X className="size-3.5" />
          </Button>
        </div>
    </SettingsRow>
  )
}

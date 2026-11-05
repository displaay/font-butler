import { useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import {
  Archive,
  Eraser,
  Folder,
  FolderOpen,
  History,
  Layers,
  Monitor,
  Moon,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Sun,
  Type,
  X,
} from 'lucide-react'
import {
  ClearAllFontCachesControl,
  ClearFontCachesControl,
} from '@/components/ClearFontCachesControl'
import { FolderRelinkDialog } from '@/components/FolderRelinkDialog'
import { FolderSetupDialog } from '@/components/FolderSetupDialog'
import { AppUpdateCard } from '@/components/AppUpdateCard'
import { RetailDisableDialog } from '@/components/RetailDisableDialog'
import { RetailPane } from '@/components/RetailPane'
import { SettingsRow, SettingsSection, settingsSelectClass } from '@/components/SettingsRow'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSetActionStatus } from '@/components/NotifyProvider'
import { api, type BackupPreview, type RestoreReport } from '@/lib/api'
import { BACKUP_LICENSE_WARNING, BACKUP_RESTORE_WARNING, formatBackupBytes } from '@/lib/backup'
import { startQueuedFontAction } from '@/lib/actionQueue'
import {
  LATIN_PREVIEW_MAX_LENGTH,
  LATIN_PREVIEW_PRESETS,
  normalizeLatinPreviewCustom,
} from '@/lib/latinPreview'
import { persistNativeNotificationsEnabled, requestNotificationPermission } from '@/lib/notifications'
import type {
  AdobeFontCacheInfo,
  AppSettings,
  AppUpdateStatus,
  DestinationCapability,
  DestinationInvestigationRow,
  LatinPreviewPreset,
  OfficeFontCacheInfo,
  SortMode,
  ThemeMode,
  ViewLayout,
} from '@/lib/types'
import { APP_ICON_OPTIONS, appIconPreviewSrc, parseAppIconStyle } from '@/lib/appIcon'
import { cn } from '@/lib/utils'
import { DESTINATIONS, GLOBAL_AUTO_REINSTALL_DESCRIPTION, WATCH_FOLDER_ACTIONS, adobeTestingFolderAvailable, destinationLabel, destinationNeedsAdobe, folderAvailabilityLabel } from '@/lib/folders'
import { watchFolderName } from '@/lib/watchFolders'
import type { RetailDisableAction, RetailSyncStatus, WatchFolder } from '@/lib/types'

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
  | 'backup'
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
    description: 'Appearance, library defaults, and how Cuttler runs on this Mac.',
  },
  {
    id: 'folders',
    label: 'Watch folders',
    icon: Folder,
    description: 'Watch folders for new fonts, and the optional Displaay retail collection.',
  },
  {
    id: 'fonts',
    label: 'Fonts',
    icon: Type,
    description: 'Choose whether fonts you add are activated.',
  },
  {
    id: 'destinations',
    label: 'Destinations',
    icon: Layers,
    description: 'Where Cuttler places installed copies, including the Adobe folder.',
  },
  {
    id: 'caches',
    label: 'Caches',
    icon: Eraser,
    description: 'Clear Office and Adobe caches from the Font cache menu. The macOS font cache is cleared only when you choose Clear font caches or Clear all font caches.',
  },
  {
    id: 'backup',
    label: 'Backup',
    icon: Archive,
    description: 'Export the whole library — fonts included — to one file, or restore from a backup. Restoring organisation replaces projects, tags, and settings after saving a snapshot.',
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
  theme?: ThemeMode
  appIcon?: AppSettings['appIcon']
  menuBarIcon?: boolean
  openAtLogin?: boolean
  clearOfficeFontCache?: boolean
  clearAdobeFontCache?: boolean
  autoReinstallOnUpdate?: boolean
  nativeNotifications?: boolean
  watchDocumentOpens?: boolean
  onboardingCompleted?: boolean
  revisionBudgetBytes?: number
  activityRetentionDays?: number
  activityMaxOperations?: number
  defaultDestination?: AppSettings['defaultDestination']
  latinPreview?: AppSettings['latinPreview']
}

function navButtonClass(active: boolean) {
  return cn(
    'h-8 w-full justify-start font-normal text-muted-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.08]',
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
  highlightWatchFolders = false,
  highlightFinderSync = false,
  onStartOnboarding,
  retail = null,
  retailFamiliesOnMac,
  onRetailChange,
  onRetailSync,
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
  highlightWatchFolders?: boolean
  /** Open General and scroll to the Finder Sync control in the App section. */
  highlightFinderSync?: boolean
  onStartOnboarding?: () => void
  retail?: RetailSyncStatus | null
  retailFamiliesOnMac?: ReadonlySet<string>
  onRetailChange?: (status: RetailSyncStatus) => void
  onRetailSync?: () => void
}) {
  const setActionStatus = useSetActionStatus()
  const tablistId = useId()
  const [category, setCategory] = useState<SettingsCategoryId>('general')
  const [busy, setBusy] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [relinkRoot, setRelinkRoot] = useState<string | null>(null)
  const [retailDisableOpen, setRetailDisableOpen] = useState(false)
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
    setRetailDisableOpen(false)
  }, [open])

  useEffect(() => {
    if (!open || !highlightAppUpdate) return
    setCategory('general')
  }, [open, highlightAppUpdate])

  useEffect(() => {
    if (!open || !highlightWatchFolders) return
    setCategory('folders')
  }, [open, highlightWatchFolders])

  useEffect(() => {
    if (!open || !highlightFinderSync) return
    setCategory('general')
  }, [open, highlightFinderSync])

  useEffect(() => {
    if (!open || !highlightFinderSync || category !== 'general') return
    const frame = requestAnimationFrame(() => {
      const control = document.querySelector<HTMLElement>('[aria-label="Finder menu in Login Items"]')
      const row = control?.closest('.grid')
      const target = row instanceof HTMLElement ? row : document.getElementById('finder-sync-settings')
      target?.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, highlightFinderSync, category])

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

  function applyDestinations(result: {
    destinations: DestinationCapability[]
    investigation: DestinationInvestigationRow[]
  }) {
    setDestinations(result.destinations)
    setInvestigation(result.investigation)
    onDestinationsChange?.(result.destinations)
    return result.destinations
  }

  async function createAdobeFolder() {
    setBusy(true)
    try {
      applyDestinations(await api.createAdobeTestingFolder())
      toast.success('Created the Adobe folder')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create that folder')
    } finally {
      setBusy(false)
    }
  }

  async function refreshDestinations() {
    setBusy(true)
    try {
      const destinations = applyDestinations(await api.destinations())
      if (adobeTestingFolderAvailable(destinations)) {
        toast.success('Adobe folder is available')
      } else {
        toast.message('Adobe folder is still not available')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not check that folder')
    } finally {
      setBusy(false)
    }
  }

  function disableRetail(action: RetailDisableAction) {
    setRetailDisableOpen(false)
    const removing = action === 'remove'
    startQueuedFontAction(async () => {
      setBusy(true)
      if (removing) setActionStatus('Uninstalling Displaay fonts…')
      try {
        const result = await api.retail.configure({ enabled: false, disableAction: action })
        onRetailChange?.(result.status)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not turn sync off')
      } finally {
        setBusy(false)
        if (removing) setActionStatus(null)
      }
    })
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
              className="min-h-0 flex-1 overflow-hidden"
            >
              <ScrollArea className="overlay-scroll-on-scroll h-full" overlay>
                <div className="overscroll-contain px-5 py-4">
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
                  highlightFinderSync={highlightFinderSync}
                  onStartOnboarding={onStartOnboarding}
                />
              )}
              {category === 'folders' && (
                <FoldersPane
                  folders={folders}
                  watchFolders={watchFolders}
                  busy={busy}
                  retail={retail}
                  retailFamiliesOnMac={retailFamiliesOnMac}
                  onRetailChange={onRetailChange}
                  onRetailSync={onRetailSync}
                  onSave={save}
                  onAddFolder={() => setSetupOpen(true)}
                  onRelink={(root) => setRelinkRoot(root)}
                  onSettingsChange={onSettingsChange}
                  onRequestRetailDisable={() => setRetailDisableOpen(true)}
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
                  onRefreshDestinations={() => void refreshDestinations()}
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
              {category === 'backup' && <BackupPane />}
              {category === 'history' && (
                <HistoryPane settings={settings} busy={busy} onSave={save} />
              )}
                </div>
              </ScrollArea>
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
    <RetailDisableDialog
      open={retailDisableOpen}
      busy={busy}
      onDismiss={() => setRetailDisableOpen(false)}
      onChoose={(action) => void disableRetail(action)}
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
  highlightFinderSync,
  onStartOnboarding,
}: {
  settings: AppSettings | null
  busy: boolean
  isDesktop: boolean
  onSave: (patch: SettingsPatch) => Promise<void>
  appUpdate: AppUpdateStatus | null
  checkingAppUpdate: boolean
  onCheckAppUpdate?: (refresh?: boolean) => void
  highlightAppUpdate: boolean
  highlightFinderSync: boolean
  onStartOnboarding?: () => void
}) {
  return (
    <div>
      <SettingsSection>
        <SettingsRow
          label="Automatically reinstall when an update is detected"
          description={GLOBAL_AUTO_REINSTALL_DESCRIPTION}
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
                    'h-7 gap-1.5 px-2.5',
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
          label="App icon"
          description="Dock and menu bar. A packaged app’s Finder icon updates when you install a new build."
        >
          <div role="radiogroup" aria-label="App icon" className="flex max-w-full flex-wrap items-end justify-end gap-2">
            {APP_ICON_OPTIONS.map((option) => {
              const selected = parseAppIconStyle(settings?.appIcon) === option.id
              return (
                <Button
                  key={option.id}
                  type="button"
                  variant="ghost"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option.label}
                  title={option.label}
                  disabled={busy || !settings}
                  className={cn(
                    'h-auto flex-col gap-1 rounded-xl border px-1.5 pb-1 pt-0.5',
                    selected
                      ? 'border-foreground/30 bg-muted ring-2 ring-ring/40'
                      : 'border-border text-muted-foreground',
                  )}
                  onClick={() => {
                    if (!selected) void onSave({ appIcon: option.id })
                  }}
                >
                  <img
                    src={appIconPreviewSrc(option.id)}
                    alt=""
                    className="size-12 rounded-[0.6rem]"
                  />
                  <span className="whitespace-nowrap text-[11px] leading-4">{option.label}</span>
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
            className={settingsSelectClass}
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
            className={settingsSelectClass}
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
        <LatinPreviewRow settings={settings} busy={busy} onSave={onSave} />
      </SettingsSection>

      <SettingsSection
        id="finder-sync-settings"
        title="App"
        className={cn(
          highlightFinderSync && 'rounded-md ring-2 ring-ring/40 ring-offset-2 ring-offset-background',
        )}
      >
        <SettingsRow
          label="Icon in menu bar"
          description="Keep Cuttler running in the menu bar after you close the window. The Dock icon hides until you show the window again. Click the icon to show the window, reinstall updated fonts, clear caches, or quit."
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
            label="Watch documents in Adobe and Office"
            description="When InDesign is in front, ask it for the fonts in its open documents, including while Missing Fonts is open. Illustrator, Photoshop, Acrobat, Word, and PowerPoint are read from the open file. A Figma file is not parsed. Off until you turn this on. This only opens the font sheet."
            htmlFor="watch-document-opens"
          >
            <input
              id="watch-document-opens"
              type="checkbox"
              checked={settings?.watchDocumentOpens === true}
              disabled={busy || !settings}
              onChange={(event) => void onSave({ watchDocumentOpens: event.target.checked })}
              className={checkboxClass}
            />
          </SettingsRow>
        ) : null}
        {isDesktop ? (
          <SettingsRow
            label="Open at login"
            description="Start Cuttler when you turn on this computer."
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
        {isDesktop ? (
          <SettingsRow
            label="Finder menu"
            description="Enable the Finder menu in Login Items & Extensions. Until that is on, use Services → Install."
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Finder menu in Login Items"
              disabled={busy}
              onClick={() => {
                void window.fontButlerDesktop?.openFinderLoginItems?.()
              }}
            >
              Open Login Items & Extensions
            </Button>
          </SettingsRow>
        ) : null}
        <SettingsRow
          label="Allow notifications"
          description="Cuttler can notify you when fonts are installed or updated."
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
        <SettingsRow
          label="Onboarding"
          description="Show the setup screens from the first time you opened Cuttler."
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !onStartOnboarding}
            onClick={onStartOnboarding}
          >
            Start onboarding
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}

function LatinPreviewRow({
  settings,
  busy,
  onSave,
}: {
  settings: AppSettings | null
  busy: boolean
  onSave: (patch: SettingsPatch) => Promise<void>
}) {
  const preset = settings?.latinPreview?.preset ?? 'Aa'
  const storedCustom = settings?.latinPreview?.custom ?? ''
  const [custom, setCustom] = useState(storedCustom)

  useEffect(() => {
    setCustom(storedCustom)
  }, [storedCustom])

  function persist(nextPreset: LatinPreviewPreset, nextCustom = custom) {
    void onSave({
      latinPreview: {
        preset: nextPreset,
        custom: normalizeLatinPreviewCustom(nextCustom),
      },
    })
  }

  function commitCustom() {
    const next = normalizeLatinPreviewCustom(custom)
    setCustom(next)
    if (next === storedCustom && preset === 'custom') return
    persist('custom', next)
  }

  return (
    <SettingsRow
      label="Latin preview"
      description="Letters shown on library and system cards for Latin-primary faces. Other scripts keep their own glyph."
      extra={
        preset === 'custom' ? (
          <div className="flex justify-end">
            <Input
              id="latin-preview-custom"
              value={custom}
              maxLength={LATIN_PREVIEW_MAX_LENGTH}
              disabled={busy || !settings}
              placeholder="Aa"
              aria-label="Custom Latin preview"
              className="max-w-[9.5rem]"
              onChange={(event) => setCustom(event.target.value.slice(0, LATIN_PREVIEW_MAX_LENGTH))}
              onBlur={commitCustom}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
            />
          </div>
        ) : null
      }
    >
      <div
        role="radiogroup"
        aria-label="Latin preview"
        className="inline-flex flex-wrap items-center justify-end gap-0.5 rounded-md border bg-background p-0.5"
      >
        {[...LATIN_PREVIEW_PRESETS, 'custom' as const].map((option) => {
          const selected = preset === option
          return (
            <Button
              key={option}
              type="button"
              size="sm"
              variant="ghost"
              role="radio"
              aria-checked={selected}
              disabled={busy || !settings}
              className={cn(
                'h-7 px-2.5',
                selected ? 'bg-muted font-medium' : 'text-muted-foreground',
              )}
              onClick={() => {
                if (!selected) persist(option)
              }}
            >
              {option === 'custom' ? 'Custom' : option}
            </Button>
          )
        })}
      </div>
    </SettingsRow>
  )
}

function FoldersPane({
  folders,
  watchFolders,
  busy,
  retail,
  retailFamiliesOnMac,
  onRetailChange,
  onRetailSync,
  onSave,
  onAddFolder,
  onRelink,
  onSettingsChange,
  onRequestRetailDisable,
}: {
  folders: WatchFolder[]
  watchFolders: string[]
  busy: boolean
  retail?: RetailSyncStatus | null
  retailFamiliesOnMac?: ReadonlySet<string>
  onRetailChange?: (status: RetailSyncStatus) => void
  onRetailSync?: () => void
  onSave: (patch: SettingsPatch) => Promise<void>
  onAddFolder: () => void
  onRelink: (root: string) => void
  onSettingsChange: (settings: AppSettings) => void
  onRequestRetailDisable?: () => void
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
            onActions={(flags) =>
              void api
                .configureFolder({ id: folder.id, root: folder.root, ...flags })
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
          description="Each folder chooses whether to install new fonts and whether to reinstall updates. Pause stops both. Adding a folder previews a scan before watching starts."
        >
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onAddFolder}>
            <FolderOpen className="size-4" />
            Add folder
          </Button>
        </SettingsRow>
      </SettingsSection>
      <RetailPane
        status={retail ?? null}
        familiesOnMac={retailFamiliesOnMac}
        busy={busy}
        onStatus={(next) => onRetailChange?.(next)}
        onSync={onRetailSync}
        onRequestDisable={onRequestRetailDisable}
      />
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
        label="Activate after adding"
        description="Turn this off to add fonts to the library without activating."
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
  onRefreshDestinations,
}: {
  settings: AppSettings | null
  busy: boolean
  destinations: DestinationCapability[]
  investigation: DestinationInvestigationRow[]
  onSave: (patch: SettingsPatch) => Promise<void>
  onCreateAdobeFolder: () => void
  onRefreshDestinations: () => void
}) {
  const adobeAvailable = adobeTestingFolderAvailable(destinations)
  const adobe = destinations.find((item) => item.id === 'adobe-shared')
  const adobeRemedy = adobe?.remedy
    ?.replace(/\s*Cuttler will not create or chmod a system Adobe folder\./g, '')
    .trim()
  return (
    <SettingsSection>
      <SettingsRow
        label="Default install destination"
        description="Choose where new installs go. Adobe is a folder for apps to pick up — not the same as installing for macOS."
        htmlFor="default-destination"
      >
        <select
          id="default-destination"
          className={settingsSelectClass}
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
        label="Adobe folder"
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
        {adobe && !adobe.supported ? (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onRefreshDestinations}
            >
              <RefreshCw className="size-3.5" />
              Check again
            </Button>
            {adobe.canCreate ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCreateAdobeFolder}>
                Create folder
              </Button>
            ) : null}
          </div>
        ) : null}
      </SettingsRow>
    </SettingsSection>
  )
}

function BackupPane() {
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [includeFonts, setIncludeFonts] = useState(true)
  const [restoreFonts, setRestoreFonts] = useState(true)
  const [restoreOrganization, setRestoreOrganization] = useState(true)
  const [destination, setDestination] = useState('')
  const [created, setCreated] = useState<{ destinationPath: string; size: number } | null>(null)
  const [restorePath, setRestorePath] = useState('')
  const [report, setReport] = useState<RestoreReport | null>(null)
  const [planned, setPlanned] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api
      .backupPreview(includeFonts)
      .then((result) => {
        if (!cancelled) setPreview(result.preview)
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [includeFonts])

  async function createBackup() {
    setBusy(true)
    try {
      const result = await api.createBackup(destination.trim() || undefined, includeFonts)
      setCreated(result)
      setPreview(result.preview)
      toast.success(`Backup saved (${formatBackupBytes(result.size)})`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the backup')
    } finally {
      setBusy(false)
    }
  }

  async function planRestore() {
    setBusy(true)
    try {
      const result = await api.planRestore(restorePath.trim(), { restoreFonts, restoreOrganization })
      setReport(result.report)
      setPlanned(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read that backup')
    } finally {
      setBusy(false)
    }
  }

  async function applyRestore() {
    setBusy(true)
    try {
      const result = await api.restoreBackup(restorePath.trim(), { restoreFonts, restoreOrganization })
      setReport(result.report)
      setPlanned(false)
      toast.success('Backup restored — fonts that were on are on again.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not restore that backup')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <SettingsSection title="Export library backup">
        <div className="py-3.5">
          <p className="text-[13px] leading-5 text-muted-foreground">{BACKUP_LICENSE_WARNING}</p>
          {preview ? (
            <p className="mt-2 text-sm">
              {preview.fontFiles} font files · {preview.catalogEntries} library entries ·{' '}
              {formatBackupBytes(preview.uncompressedSize)} uncompressed. The backup file (.cuttlerbackup)
              will be about this size.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Reading library size…</p>
          )}
          {preview && preview.missingFiles.length > 0 ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {preview.missingFiles.length} file(s) are missing on disk and cannot be included; they will be
              named in the backup report.
            </p>
          ) : null}
          {preview && preview.skippedProtected.length > 0 ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {preview.skippedProtected.length} protected system, app, or Adobe Fonts file(s) are not included
              in backups.
            </p>
          ) : null}
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeFonts}
              onChange={(event) => setIncludeFonts(event.target.checked)}
              className={checkboxClass}
            />
            Include font files (turn off for a smaller, organisation-only backup)
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              aria-label="Backup destination path"
              placeholder="Destination .cuttlerbackup path (optional)"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              className="min-w-[16rem] flex-1"
            />
            <Button type="button" disabled={busy} onClick={() => void createBackup()}>
              Create backup
            </Button>
          </div>
          {created ? (
            <p className="mt-2 break-all text-[13px] text-muted-foreground">
              Saved to {created.destinationPath} ({formatBackupBytes(created.size)})
            </p>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection title="Restore from backup">
        <div className="py-3.5">
          <p className="text-[13px] leading-5 text-muted-foreground">
            {BACKUP_RESTORE_WARNING} Restoring organisation replaces your current projects, smart projects,
            tags, and settings — a snapshot of your current library is saved first. Fonts already on disk are
            left as they are, fonts that were on come back on, and nothing deletes or parks your only copy of
            a font.
          </p>
          <div className="mt-3 space-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={restoreFonts}
                onChange={(event) => setRestoreFonts(event.target.checked)}
                className={checkboxClass}
              />
              Restore fonts
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={restoreOrganization}
                onChange={(event) => setRestoreOrganization(event.target.checked)}
                className={checkboxClass}
              />
              Restore organisation — replaces projects, smart projects, tags, and settings (snapshot saved first)
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              aria-label="Backup file path"
              placeholder="Path to a .cuttlerbackup file"
              value={restorePath}
              onChange={(event) => {
                setRestorePath(event.target.value)
                setPlanned(false)
              }}
              className="min-w-[16rem] flex-1"
            />
            <Button type="button" variant="outline" disabled={busy || !restorePath.trim()} onClick={() => void planRestore()}>
              Preview restore
            </Button>
            <Button type="button" disabled={busy || !restorePath.trim()} onClick={() => void applyRestore()}>
              Restore
            </Button>
          </div>
          {report ? (
            <div className="mt-3 space-y-1 text-[13px] leading-5">
              <p>
                {planned ? 'Would restore' : 'Restored'} {report.restored.length} · back on{' '}
                {report.reactivated.length} · already on disk, left as-is {report.leftAsIs.length} · skipped
                (already present) {report.skippedIdentical.length} · parked as extra{' '}
                {report.parkedAsExtra.length} · could not restore {report.failed.length}
              </p>
              {report.snapshotPath ? (
                <p className="text-muted-foreground">Snapshot of your previous library saved to {report.snapshotPath}.</p>
              ) : null}
              {report.failed.map((item) => (
                <p key={`${item.fileName}-${item.message}`} className="text-muted-foreground">
                  Not restored: {item.message}
                </p>
              ))}
              {report.watchFoldersNotRestored.map((item) => (
                <p key={item.root} className="text-muted-foreground">
                  Watch folder {item.root}: {item.reason}.
                </p>
              ))}
              {report.watchFoldersRestoredPaused.map((item) => (
                <p key={item.root} className="text-muted-foreground">
                  Watch folder {item.root} restored paused — resume it when you are ready.
                </p>
              ))}
              {report.settingsKeysSkipped.length > 0 ? (
                <p className="text-muted-foreground">
                  Settings secrets were not restored: {report.settingsKeysSkipped.join(', ')}.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </SettingsSection>
    </div>
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
          description="Clear Office’s FontCache from the Font cache menu. Reinstall leaves it alone. Turn this off to leave Office alone."
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
          description="Clear Adobe font list caches from the Font cache menu. Reinstall leaves them alone. Open Adobe apps still need a relaunch. Turn this off to leave Adobe alone."
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

      <SettingsSection title="macOS">
        <SettingsRow
          label="Clear font caches"
          description="Removes the macOS user font cache. Some apps may not see new or updated fonts until you log out. Reinstall never does this."
        >
          <ClearFontCachesControl
            disabled={busy}
            onClear={() => api.clearFontCaches()}
            onLogOut={() => api.requestLogout()}
            onProbe={() => api.requestLogoutProbe()}
          />
        </SettingsRow>
        <SettingsRow
          label="Clear all font caches"
          description="Clears the macOS user font cache and, where turned on above, the Microsoft Office and Adobe font caches. It removes cache files only — no fonts or library entries are removed, and no administrator password is needed. Open apps may need to be relaunched to see updated fonts, and some apps may not see new or updated fonts until you log out."
        >
          <ClearAllFontCachesControl
            disabled={busy}
            onClearAll={() => api.clearAllFontCaches()}
            onLogOut={() => api.requestLogout()}
            onProbe={() => api.requestLogoutProbe()}
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}

function HistoryNumberInput({
  id,
  value,
  min,
  disabled,
  onCommit,
}: {
  id: string
  value: number
  min: number
  disabled: boolean
  onCommit: (next: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])
  return (
    <Input
      id={id}
      type="number"
      min={min}
      className="w-[7.5rem]"
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = Math.max(min, Number(draft) || value)
        setDraft(String(next))
        if (next !== value) onCommit(next)
      }}
    />
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
          <HistoryNumberInput
            id="revision-budget"
            value={Math.round((settings?.revisionBudgetBytes ?? 1073741824) / 1024 / 1024)}
            min={64}
            disabled={busy || !settings}
            onCommit={(next) => void onSave({ revisionBudgetBytes: next * 1024 * 1024 })}
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
          <HistoryNumberInput
            id="activity-retention"
            value={settings?.activityRetentionDays ?? 90}
            min={7}
            disabled={busy || !settings}
            onCommit={(next) => void onSave({ activityRetentionDays: next })}
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
  onActions,
  onRelink,
  onRemove,
}: {
  folder: WatchFolder
  busy: boolean
  onPause: () => void
  onActions: (flags: { installNew: boolean; autoUpdate: boolean }) => void
  onRelink: () => void
  onRemove: () => void
}) {
  const name = watchFolderName(folder.root)
  return (
    <SettingsRow
      label={<span className="block truncate" title={name}>{name}</span>}
      description={
        <span className="block">
          {folderAvailabilityLabel(folder)} · {destinationLabel(folder.destinationId)}
          <span className="mt-0.5 block truncate font-mono text-[11px]" title={folder.root}>
            {folder.root}
          </span>
        </span>
      }
      extra={
        <div className="flex flex-col gap-2 py-1">
          {WATCH_FOLDER_ACTIONS.map((action) => (
            <label key={action.key} className="flex items-center justify-between gap-3">
              <span className="text-sm">{action.label}</span>
              <input
                type="checkbox"
                className={checkboxClass}
                checked={folder[action.key]}
                disabled={busy}
                aria-label={`${action.label} for ${name}`}
                onChange={(event) =>
                  onActions({
                    installNew: action.key === 'installNew' ? event.target.checked : folder.installNew,
                    autoUpdate: action.key === 'autoUpdate' ? event.target.checked : folder.autoUpdate,
                  })
                }
              />
            </label>
          ))}
        </div>
      }
    >
        <div className="flex max-w-[min(100%,22rem)] flex-wrap items-center justify-end gap-1.5">
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

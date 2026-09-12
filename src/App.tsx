import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { ActivityView } from '@/components/ActivityView'
import {
  BatchActionBar,
  BatchActionBarContainer,
  CatalogBatchButtons,
  SystemBatchButtons,
} from '@/components/BatchActions'
import { DropFolderDialog } from '@/components/DropFolderDialog'
import { DuplicatesDialog } from '@/components/DuplicatesDialog'
import { EmptyState } from '@/components/EmptyState'
import { AppUpdateCard } from '@/components/AppUpdateCard'
import { RetailUpdateCard } from '@/components/RetailUpdateCard'
import { FolderRelinkDialog } from '@/components/FolderRelinkDialog'
import { FolderSetupDialog } from '@/components/FolderSetupDialog'
import { FontFaceStyles } from '@/components/FontFaceStyles'
import { FormatDialog } from '@/components/FormatDialog'
import { ImportPlanDialog } from '@/components/ImportPlanDialog'
import { Inspector, InspectorTabList, inspectorPaneTabs, type InspectorPaneTab } from '@/components/Inspector'
import { LibraryCard } from '@/components/LibraryCard'
import { MarqueeOverlay } from '@/components/MarqueeOverlay'
import { OnboardingDialog } from '@/components/OnboardingDialog'
import { RelinkDialog } from '@/components/RelinkDialog'
import { RenameDialog } from '@/components/RenameDialog'
import { ReplaceFormatDialog } from '@/components/ReplaceFormatDialog'
import { RetailCollisionDialog } from '@/components/RetailCollisionDialog'
import { LatinPreviewProvider } from '@/components/AaPreview'
import { SettingsDialog } from '@/components/SettingsDialog'
import { Sidebar, type Tab } from '@/components/Sidebar'
import { SystemCard } from '@/components/SystemCard'
import {
  GRID_PREVIEW_SIZE_KEY,
  ViewOptions,
  gridCardMinWidthRem,
  readGridPreviewSize,
} from '@/components/ViewOptions'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { NotifyProvider, useSetActionStatus } from '@/components/NotifyProvider'
import { Toaster } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useFontActions, type FormatPrompt, type ReplacePrompt } from '@/hooks/useFontActions'
import { api, isAppUpdateEvent, isDuplicatesEvent, isNotice, isOperationsEvent, isProjectsEvent, isRetailEvent, isSettingsEvent, subscribeEvents } from '@/lib/api'
import {
  mergeUnreadFlags,
  unreadActivityCount,
  unreadOperationIdsToMark,
} from '@/lib/activityInbox'
import { desktopPathForFile, hasInsetTrafficLights } from '@/lib/desktop'
import {
  collectDropPayload,
  commonDroppedFolder,
  droppedFolderProjectName,
  importPathsForProjectDrop,
  partitionDropPayload,
  planPathsForImport,
} from '@/lib/drop'
import { fontActionQueue } from '@/lib/actionQueue'
import { familyHasSwitch, switchableEntries } from '@/lib/eligibility'
import { adobeTestingFolderAvailable } from '@/lib/folders'
import { canSwitchTo } from '@/lib/identity'
import {
  createSavedFilter,
  deleteSavedFilter,
  emptyLibraryCriteria,
  renameSavedFilter,
  savedFilterMatches,
} from '@/lib/savedFilters'
import { familyNameOf, catalogEntriesMatch, catalogRevealEntry, countFamilyNames, countLibraryFilters, entryIds, familyStatusSummary, groupCatalog, groupSystem, matchesLibraryFilter, matchesQuery, retailFamiliesToOptOut, sortFamilyGroups, uniquePaths } from '@/lib/group'
import {
  LIBRARY_FILTERS_KEY,
  readLibraryFilters,
  readSortMode,
  shouldShowOnboarding,
} from '@/lib/preferences'
import { actionCopy, emptyImportError, importDoneCopy } from '@/lib/notify'
import { planNeedsReview } from '@/lib/planner'
import { clearFontDragImage } from '@/lib/dragPreview'
import {
  defaultProjectName,
  hasFontButlerEntries,
  memberIdsForProjectImport,
  removeMemberIds,
  uniqueMemberIds,
} from '@/lib/projects'
import { latinPreviewText } from '@/lib/latinPreview'
import { specimenFromSettings } from '@/lib/specimen'
import { bakeReportWarnings } from '@/lib/otFeatures'
import { needsLocateSource } from '@/lib/state'
import { formatSwap } from '@/lib/formats'
import {
  catalogBatchPlan,
  catalogBatchSummary,
  systemBatchPlan,
  systemBatchSummary,
} from '@/lib/batch'
import {
  canStartMarquee,
  clickPreservesSelection,
  clientRect,
  collectFamilyCardRects,
  keysInMarquee,
  mergeMarqueeSelection,
  nextSelection,
  pointerUpClearsSelection,
  sameKeys,
  shortcutAction,
  type Rect,
} from '@/lib/selection'
import {
  clickOpensInspector,
  DEFAULT_INSPECTOR_DENSITY,
  inspectorHidesBrowseGrid,
  type InspectorDensity,
} from '@/lib/inspector'
import { applyTheme } from '@/lib/theme'
import { allUpdateGroups, visibleUpdateGroups } from '@/lib/updateInventory'
import { operationMatchesQuery, tabWithSearchHits } from '@/lib/search'
import type { AppSettings, AppUpdateStatus, CatalogEntry, DestinationCapability, DuplicateWarning, FamilyGroup, ImportPlan, ImportPlanItem, LibraryFilter, Operation, PreviewPreferences, ProjectSet, RetailCollisionAction, RetailFamilyCollision, RetailSyncStatus, SavedLibraryFilter, SortMode, SystemFace, SystemFamilyGroup, ViewLayout } from '@/lib/types'
import { retailLibraryEntryVisible } from '@/lib/types'
import { cn } from '@/lib/utils'
import { isPathUnderFolder, isRetailLibraryFilter, isWatchFolderEntry, libraryFolderFilterLabel, matchesLibraryFolderFilter, RETAIL_LIBRARY_FILTER, watchFolderName } from '@/lib/watchFolders'

const EMPTY_WATCH_FOLDERS: string[] = []
const EMPTY_SYSTEM_FACES: SystemFace[] = []

export default function App() {
  return (
    <TooltipProvider>
      <NotifyProvider>
        <AppShell />
      </NotifyProvider>
    </TooltipProvider>
  )
}

function AppShell() {
  const setActionStatus = useSetActionStatus()
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
  const busyRef = useRef(false)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [renameEntry, setRenameEntry] = useState<CatalogEntry | null>(null)
  const [bakeRenameFeatures, setBakeRenameFeatures] = useState<string[] | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsFocusAppUpdate, setSettingsFocusAppUpdate] = useState(false)
  const [settingsFocusWatchFolders, setSettingsFocusWatchFolders] = useState(false)
  const [appUpdate, setAppUpdate] = useState<AppUpdateStatus | null>(null)
  const [retail, setRetail] = useState<RetailSyncStatus | null>(null)
  const [retailBusy, setRetailBusy] = useState(false)
  const [syncCollisions, setSyncCollisions] = useState<RetailFamilyCollision[]>([])
  const [dropRetailPrompt, setDropRetailPrompt] = useState<{
    remaining: RetailFamilyCollision[]
    choices: Record<string, RetailCollisionAction>
    resolve: (choices: Record<string, RetailCollisionAction> | null) => void
  } | null>(null)
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const settingsRef = useRef<AppSettings | null>(null)
  const [watchFolderFilter, setWatchFolderFilter] = useState<string | null>(null)
  const [folderDrop, setFolderDrop] = useState<{
    folders: string[]
    paths: string[]
    files: File[]
  } | null>(null)
  const [formatPrompt, setFormatPrompt] = useState<FormatPrompt | null>(null)
  const [replacePrompt, setReplacePrompt] = useState<ReplacePrompt | null>(null)
  const [showSources, setShowSources] = useState(
    () => localStorage.getItem('font-butler-show-sources') === 'true',
  )
  const [showAdded, setShowAdded] = useState(
    () => localStorage.getItem('font-butler-show-added') === 'true',
  )
  const [hideDestinations, setHideDestinations] = useState(
    () => localStorage.getItem('font-butler-hide-destinations') === 'true',
  )
  const [viewLayout, setViewLayout] = useState<ViewLayout>(() =>
    localStorage.getItem('font-butler-view-layout') === 'grid' ? 'grid' : 'list',
  )
  const [sortMode, setSortMode] = useState<SortMode>(readSortMode)
  const [selectedFamilyKeys, setSelectedFamilyKeys] = useState<string[]>([])
  const [selectedSystemKeys, setSelectedSystemKeys] = useState<string[]>([])
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)
  const [inspectSelection, setInspectSelection] = useState(false)
  const [inspectorDensity, setInspectorDensity] = useState<InspectorDensity>(DEFAULT_INSPECTOR_DENSITY)
  const [inspectorPane, setInspectorPane] = useState<InspectorPaneTab>('details')
  const inspectorTablistId = useId()
  useEffect(() => {
    if (tab === 'system' && inspectorPane === 'glyphs') setInspectorPane('details')
  }, [tab, inspectorPane])
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null)
  const marqueeRef = useRef<{
    startX: number
    startY: number
    lastX: number
    lastY: number
    additive: boolean
    baseKeys: string[]
    active: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const fontDragRef = useRef(false)
  const applyMarqueeKeysRef = useRef<(keys: string[]) => void>(() => {})
  const reinstallFromMenuBarRef = useRef<(ids: string[]) => void>(() => {})
  const [scrollToFamily, setScrollToFamily] = useState<string | null>(null)
  const [libraryFilters, setLibraryFilters] = useState<LibraryFilter[]>(readLibraryFilters)
  const [gridPreviewSize, setGridPreviewSize] = useState(readGridPreviewSize)
  const [projects, setProjects] = useState<ProjectSet[]>([])
  const [operations, setOperations] = useState<Operation[]>([])
  const operationsRef = useRef<Operation[]>([])
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null)
  type ImportPlanDecision = {
    choices: Record<string, ImportPlanItem['defaultChoice']>
    familyName?: string
  }
  const [importPlanResolve, setImportPlanResolve] = useState<
    ((decision: ImportPlanDecision | null) => void) | null
  >(null)
  const [relinkEntry, setRelinkEntry] = useState<CatalogEntry | null>(null)
  const [relinkMode, setRelinkMode] = useState<'locate' | 'link'>('locate')
  const [folderSetupRoots, setFolderSetupRoots] = useState<string[] | null>(null)
  const [folderRelinkRoot, setFolderRelinkRoot] = useState<string | null>(null)
  const [highlightOperation, setHighlightOperation] = useState<string | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateWarning[]>([])
  const [duplicatesOpen, setDuplicatesOpen] = useState(false)
  const [adobeAvailable, setAdobeAvailable] = useState(true)

  function applyAdobeAvailability(destinations?: DestinationCapability[]) {
    setAdobeAvailable(adobeTestingFolderAvailable(destinations))
  }

  function applySettings(next: AppSettings) {
    const current = settingsRef.current
    settingsRef.current = next
    setSettings(next)
    if (!current || current.defaultView !== next.defaultView) {
      setViewLayout(next.defaultView)
      localStorage.setItem('font-butler-view-layout', next.defaultView)
    }
    if (!current || current.defaultSort !== next.defaultSort) {
      setSortMode(next.defaultSort)
      localStorage.setItem('font-butler-sort', next.defaultSort)
    }
    if (!current || current.theme !== next.theme) {
      applyTheme(next.theme)
    }
  }

  async function persistPreferences(patch: { defaultView?: ViewLayout; defaultSort?: SortMode }) {
    try {
      const result = await api.updateSettings(patch)
      applySettings(result.settings)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save settings')
    }
  }

  async function loadAppUpdate(refresh = false) {
    setCheckingAppUpdate(true)
    try {
      const result = await api.appUpdate(refresh)
      setAppUpdate(result.update)
    } catch {
      // Keep the last successful check; Settings still offers a manual retry.
    } finally {
      setCheckingAppUpdate(false)
    }
  }

  /**
   * Local read only — settings plus the on-disk manifest, no network. Safe right after boot; the
   * worker is only contacted by an explicit check or the background one below.
   */
  async function loadRetailStatus() {
    try {
      const result = await api.retail.status()
      setRetail(result.status)
    } catch {
      // The pane offers a manual retry; a missing status must not surface as an app error.
    }
  }

  async function syncRetail(choices?: Record<string, RetailCollisionAction>) {
    setRetailBusy(true)
    try {
      const result = await api.retail.sync(choices)
      setRetail(result.status)
      setSyncCollisions(result.status.collisions ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sync the retail collection')
    } finally {
      setRetailBusy(false)
    }
  }

  function retailOptOutNames(entries: CatalogEntry[]): string[] {
    return retailFamiliesToOptOut(entries, retail?.fonts ?? [], retail?.disabledGlyphsFiles ?? [])
  }

  async function turnRetailSyncOff(familyNames: string[]) {
    if (familyNames.length === 0) return
    setRetailBusy(true)
    try {
      const result = await api.retail.optOut(familyNames)
      setRetail(result.status)
      toast.success(
        familyNames.length === 1
          ? `Turned sync off for ${familyNames[0]}`
          : `Turned sync off for ${familyNames.length} fonts`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not turn sync off')
    } finally {
      setRetailBusy(false)
    }
  }

  function askDropRetailCollisions(
    collisions: RetailFamilyCollision[],
  ): Promise<Record<string, RetailCollisionAction> | null> {
    return new Promise((resolve) => {
      setDropRetailPrompt({ remaining: collisions, choices: {}, resolve })
    })
  }

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const boot = await api.bootstrap()
        if (!cancelled && boot.settings) {
          applySettings(boot.settings)
        }
        const openPath = new URLSearchParams(window.location.search).get('open')
        if (openPath) {
          await api.open(openPath)
        }
        const [catalog, settingsResult, projectResult, activityResult, duplicatesResult] = await Promise.all([
          api.catalog(),
          api.settings(),
          api.projects().catch(() => ({ projects: [] })),
          api.activity().catch(() => ({ operations: [] })),
          api.duplicates().catch(() => ({ duplicates: [] })),
        ])
        if (!cancelled) {
          applySettings(settingsResult.settings)
          applyAdobeAvailability(settingsResult.destinations?.destinations)
          setProjects(projectResult.projects)
          setOperations(activityResult.operations)
          operationsRef.current = activityResult.operations
          setDuplicates(duplicatesResult.duplicates)
          if (shouldShowOnboarding(settingsResult.settings)) {
            setOnboardingOpen(true)
          }
          setEntries(catalog.entries)
          const focus = openPath
            ? catalog.entries.find((entry) => entry.sourcePath === openPath)
            : undefined
          if (focus) {
            const name = familyNameOf(focus)
            setSelectedFamily(name)
            setSelectedFamilyKeys([name])
            setSelectedEntryId(focus.id)
            setSelectionAnchor(name)
          }
        }
        const system = await api.system()
        if (!cancelled) {
          setSystemFaces(system.faces)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load fonts')
      } finally {
        if (!cancelled) setLoading(false)
      }
      if (!cancelled) void loadAppUpdate()
      if (!cancelled) void loadRetailStatus()
    }
    void boot()
    const stop = subscribeEvents((event) => {
      if (isNotice(event)) {
        if (event.notice.kind === 'error' || !busyRef.current) {
          toast[event.notice.kind === 'error' ? 'error' : 'success'](event.notice.message, {
            action: event.notice.operationId
              ? {
                  label: 'Activity',
                  onClick: () => {
                    setHighlightOperation(event.notice.operationId ?? null)
                    setTab('activity')
                  },
                }
              : undefined,
          })
        }
        if (event.notice.entryId) {
          setEntries((current) => {
            const match = current.find((entry) => entry.id === event.notice.entryId)
            if (match) {
              setSelectedFamily(familyNameOf(match))
              if (match.previewOnly) {
                setInspectorDensity(DEFAULT_INSPECTOR_DENSITY)
                setInspectorPane('details')
                setInspectSelection(true)
              }
            }
            return current
          })
        }
        return
      }
      if (isSettingsEvent(event)) {
        applySettings(event.settings)
        return
      }
      if (isProjectsEvent(event)) {
        setProjects(event.projects)
        return
      }
      if (isDuplicatesEvent(event)) {
        setDuplicates(event.duplicates)
        return
      }
      if (isAppUpdateEvent(event)) {
        setAppUpdate(event.update)
        return
      }
      if (isRetailEvent(event)) {
        setRetail(event.status)
        if (event.status.collisions) setSyncCollisions(event.status.collisions)
        return
      }
      if (isOperationsEvent(event)) {
        const ids = unreadOperationIdsToMark({
          previous: operationsRef.current,
          next: event.operations,
          foregroundBusy: busyRef.current,
          windowHidden: document.visibilityState !== 'visible',
          markVisibleBackground: false,
        })
        const next = mergeUnreadFlags(event.operations, ids)
        operationsRef.current = next
        setOperations(next)
        if (ids.length > 0) {
          void api
            .markActivityUnread(ids)
            .then((result) => {
              operationsRef.current = result.operations
              setOperations(result.operations)
            })
            .catch(() => {
              // Keep the optimistic unread flags if the persist call fails.
            })
        }
        return
      }
      if (event && typeof event === 'object' && (event as { type?: string }).type === 'catalog') {
        const next = (event as { entries: CatalogEntry[] }).entries
        setEntries((current) => (catalogEntriesMatch(current, next) ? current : next))
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

  useLayoutEffect(() => {
    if (!loading) return
    setActionStatus('Reading fonts…')
    return () => setActionStatus(null)
  }, [loading, setActionStatus])

  useEffect(() => {
    operationsRef.current = operations
  }, [operations])

  useEffect(() => {
    const mode = settings?.theme
    if (!mode) return
    applyTheme(mode)
    if (mode !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [settings?.theme])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    const stopDesktop = window.fontButlerDesktop?.onOpenSettings((payload) => {
      setSettingsFocusAppUpdate(payload?.focus === 'app-update')
      setSettingsOpen(true)
    })
    const stopReinstall = window.fontButlerDesktop?.onReinstallFonts?.((payload) => {
      const ids = Array.isArray(payload?.ids)
        ? payload.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
      reinstallFromMenuBarRef.current(ids)
    })
    const stopOpenTab = window.fontButlerDesktop?.onOpenTab?.((payload) => {
      const next = payload?.tab
      if (next !== 'library' && next !== 'system' && next !== 'updates' && next !== 'activity') {
        return
      }
      setTab(next)
      if (next !== 'library') setWatchFolderFilter(null)
      if (next === 'activity' && payload.operationId) {
        setHighlightOperation(payload.operationId)
      }
    })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      stopDesktop?.()
      stopReinstall?.()
      stopOpenTab?.()
    }
  }, [])

  const watchFolders = settings?.watchFolders ?? EMPTY_WATCH_FOLDERS
  const projectMemberIds = useMemo(() => {
    const project = projects.find((item) => item.id === projectFilter)
    return new Set(project?.members.map((member) => member.assetId) ?? [])
  }, [projects, projectFilter])
  const searching = Boolean(query.trim())
  const librarySourceEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (!retailLibraryEntryVisible(entry, retail?.fonts ?? [])) return false
        if (searching) return true
        if (watchFolderFilter && !matchesLibraryFolderFilter(entry, watchFolderFilter)) return false
        if (projectFilter && !projectMemberIds.has(entry.id)) return false
        return true
      }),
    [entries, watchFolderFilter, projectFilter, projectMemberIds, searching, retail],
  )
  const libraryGroups = useMemo(
    () =>
      sortFamilyGroups(
        groupCatalog(
          librarySourceEntries.filter((entry) => matchesLibraryFilter(entry, libraryFilters)),
        ).filter((group) =>
          matchesQuery(`${group.familyName} ${group.faces.map((face) => face.styleName).join(' ')}`, query),
        ),
        sortMode,
      ),
    [librarySourceEntries, query, sortMode, libraryFilters],
  )
  const libraryGroupsUnfiltered = useMemo(
    () => groupCatalog(librarySourceEntries),
    [librarySourceEntries],
  )
  const libraryFilterCounts = useMemo(
    () => countLibraryFilters(librarySourceEntries),
    [librarySourceEntries],
  )
  const watchFolderCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const folder of watchFolders) {
      counts[folder] = countFamilyNames(entries.filter((entry) => isWatchFolderEntry(entry, folder)))
    }
    counts[RETAIL_LIBRARY_FILTER] = countFamilyNames(
      entries.filter(
        (entry) =>
          matchesLibraryFolderFilter(entry, RETAIL_LIBRARY_FILTER) &&
          retailLibraryEntryVisible(entry, retail?.fonts ?? []),
      ),
    )
    return counts
  }, [entries, watchFolders, retail])
  const allUpdates = useMemo(() => allUpdateGroups(entries, sortMode), [entries, sortMode])
  const updateGroups = useMemo(() => visibleUpdateGroups(allUpdates, query), [allUpdates, query])
  const systemGroups = useMemo(
    () =>
      groupSystem(systemFaces).filter((group) =>
        matchesQuery(`${group.familyName} ${group.faces.map((face) => face.styleName).join(' ')}`, query),
      ),
    [systemFaces, query],
  )
  const shownSystemGroups = useMemo(
    () => (query.trim() ? systemGroups : systemGroups.slice(0, 80)),
    [query, systemGroups],
  )
  const previewSystemFaces = useMemo(
    () => (tab === 'system' ? shownSystemGroups.flatMap((group) => group.faces) : EMPTY_SYSTEM_FACES),
    [tab, shownSystemGroups],
  )
  const missingSourceCount = useMemo(
    () => entries.filter((entry) => entry.status === 'source-missing').length,
    [entries],
  )
  const visibleOperations = useMemo(
    () => operations.filter((operation) => operationMatchesQuery(operation, query)),
    [operations, query],
  )
  const tabCounts = useMemo(() => {
    if (searching) {
      return {
        library: libraryGroups.length,
        system: systemGroups.length,
        updates: updateGroups.length,
        activity: visibleOperations.length,
      }
    }
    return {
      library: countFamilyNames(entries),
      system: groupSystem(systemFaces).length,
      updates: countFamilyNames(entries.filter((entry) => entry.status === 'outdated')),
      activity: operations.length,
    }
  }, [
    searching,
    libraryGroups.length,
    systemGroups.length,
    updateGroups.length,
    visibleOperations.length,
    entries,
    systemFaces,
    operations.length,
  ])
  const activityUnread = useMemo(() => unreadActivityCount(operations), [operations])

  const visibleGroups = useMemo(
    () =>
      tab === 'system' || tab === 'activity' ? [] : tab === 'updates' ? updateGroups : libraryGroups,
    [tab, updateGroups, libraryGroups],
  )
  const selectedGroup =
    selectedFamily && selectedFamilyKeys.includes(selectedFamily)
      ? (visibleGroups.find((group) => group.familyName === selectedFamily) ?? null)
      : null
  const selectedEntry =
    selectedGroup?.entries.find((entry) => entry.id === selectedEntryId) ??
    selectedGroup?.entries[0] ??
    null
  const selectedSystemGroup =
    tab === 'system' && selectedSystem && selectedSystemKeys.includes(selectedSystem)
      ? (shownSystemGroups.find((group) => group.familyName === selectedSystem) ?? null)
      : null

  useEffect(() => {
    if (
      tab === 'updates' &&
      allUpdates.length === 0 &&
      !appUpdate?.updateAvailable &&
      (retail?.pending ?? 0) === 0
    ) {
      setTab('library')
    }
  }, [tab, allUpdates.length, appUpdate?.updateAvailable, retail?.pending])

  const searchTab = tabWithSearchHits({
    current: tab,
    query,
    libraryHits: libraryGroups.length,
    systemHits: systemGroups.length,
    updateHits: updateGroups.length,
    activityHits: visibleOperations.length,
  })
  if (searchTab !== tab) {
    setTab(searchTab)
    if (searchTab !== 'library') setWatchFolderFilter(null)
    if (searchTab === 'library') setProjectFilter(null)
  }

  useEffect(() => {
    if (!watchFolderFilter) return
    if (isRetailLibraryFilter(watchFolderFilter)) {
      if (!retail?.enabled) setWatchFolderFilter(null)
      return
    }
    if (!watchFolders.includes(watchFolderFilter)) {
      setWatchFolderFilter(null)
    }
  }, [watchFolderFilter, watchFolders, retail?.enabled])

  useEffect(() => {
    if (loading) return
    if (tab === 'system') {
      const visible = new Set(shownSystemGroups.map((group) => group.familyName))
      setSelectedSystemKeys((current) => {
        const kept = current.filter((key) => visible.has(key))
        if (sameKeys(current, kept)) return current
        return kept
      })
      setSelectedSystem((current) => (current && visible.has(current) ? current : null))
      return
    }
    const visible = new Set(visibleGroups.map((group) => group.familyName))
    setSelectedFamilyKeys((current) => {
      const kept = current.filter((key) => visible.has(key))
      if (sameKeys(current, kept)) return current
      return kept
    })
    setSelectedFamily((current) => (current && visible.has(current) ? current : null))
  }, [loading, tab, visibleGroups, shownSystemGroups])

  useEffect(() => {
    if (!selectedGroup) {
      setSelectedEntryId(null)
      return
    }
    setSelectedEntryId((current) => {
      if (current && selectedGroup.entries.some((entry) => entry.id === current)) {
        return current
      }
      return selectedGroup.entries[0]?.id ?? null
    })
  }, [selectedGroup])

  useEffect(() => {
    if (!scrollToFamily) return
    const node = document.querySelector(`[data-family-key="${CSS.escape(scrollToFamily)}"]`)
    if (!node) return
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    setScrollToFamily(null)
  }, [scrollToFamily, visibleGroups, tab])

  function selectGroup(group: FamilyGroup) {
    setSelectedFamily(group.familyName)
    setSelectedFamilyKeys([group.familyName])
    setSelectionAnchor(group.familyName)
    setSelectedEntryId(group.entries[0]?.id ?? null)
    setInspectSelection(true)
    setInspectorDensity(DEFAULT_INSPECTOR_DENSITY)
    setInspectorPane('details')
  }

  function handleCatalogSelect(group: FamilyGroup, event: MouseEvent) {
    if (suppressClickRef.current) return
    if (event.detail > 1) return
    const current = selectedFamilyKeys
    const range = event.shiftKey
    const toggle = event.metaKey || event.ctrlKey
    if (clickOpensInspector(current, group.familyName, { toggle, range })) {
      if (!inspectSelection) {
        setInspectorDensity(DEFAULT_INSPECTOR_DENSITY)
        setInspectorPane('details')
        setInspectSelection(true)
      }
      return
    }
    const keys = nextSelection(
      visibleGroups.map((item) => item.familyName),
      current,
      group.familyName,
      { toggle, range },
      selectionAnchor ?? selectedFamily,
    )
    setSelectedFamilyKeys(keys)
    setSelectedFamily(keys[keys.length - 1] ?? null)
    setSelectedEntryId(keys.length ? group.entries[0]?.id ?? null : null)
    if (!range) setSelectionAnchor(keys.length ? group.familyName : null)
    if (range || toggle || keys.length !== 1) setInspectSelection(false)
  }

  function inspectSystemGroup(group: SystemFamilyGroup) {
    setSelectedSystem(group.familyName)
    setSelectedSystemKeys([group.familyName])
    setSelectionAnchor(group.familyName)
    setInspectSelection(true)
    setInspectorDensity(DEFAULT_INSPECTOR_DENSITY)
    setInspectorPane('details')
  }

  function handleSystemSelect(group: SystemFamilyGroup, event: MouseEvent) {
    if (suppressClickRef.current) return
    if (event.detail > 1) return
    const current = selectedSystemKeys
    const range = event.shiftKey
    const toggle = event.metaKey || event.ctrlKey
    if (clickOpensInspector(current, group.familyName, { toggle, range })) {
      if (!inspectSelection) {
        setInspectorDensity(DEFAULT_INSPECTOR_DENSITY)
        setInspectorPane('details')
        setInspectSelection(true)
      }
      return
    }
    const keys = nextSelection(
      shownSystemGroups.map((item) => item.familyName),
      current,
      group.familyName,
      { toggle, range },
      selectionAnchor ?? selectedSystem,
    )
    setSelectedSystemKeys(keys)
    setSelectedSystem(keys[keys.length - 1] ?? null)
    if (!range) setSelectionAnchor(keys.length ? group.familyName : null)
    if (range || toggle || keys.length !== 1) setInspectSelection(false)
  }

  function selectedCatalogGroups(): FamilyGroup[] {
    const keys = new Set(selectedFamilyKeys)
    return visibleGroups.filter((group) => keys.has(group.familyName))
  }

  function selectedSystemList(): SystemFamilyGroup[] {
    const keys = new Set(selectedSystemKeys)
    return shownSystemGroups.filter((group) => keys.has(group.familyName))
  }

  const catalogSelection = selectedCatalogGroups()
  const systemSelection = selectedSystemList()
  const catalogPlan = catalogBatchPlan(catalogSelection, adobeAvailable)
  const systemPlan = systemBatchPlan(systemSelection)
  const catalogSummary = catalogBatchSummary(catalogSelection)
  const systemSummary = systemBatchSummary(systemSelection)
  const selectionCount = tab === 'system' ? systemSelection.length : catalogSelection.length
  const showInspector = selectionCount === 1 && inspectSelection
  const showBatchBar = selectionCount > 1 || (selectionCount === 1 && !inspectSelection)
  const hideBrowseGrid = inspectorHidesBrowseGrid(showInspector)
  const insetTrafficLights = hasInsetTrafficLights()

  function closeInspector() {
    setInspectSelection(false)
    setInspectorDensity(DEFAULT_INSPECTOR_DENSITY)
    setInspectorPane('details')
  }

  function clearSelection() {
    setSelectedFamily(null)
    setSelectedFamilyKeys([])
    setSelectedEntryId(null)
    setSelectedSystem(null)
    setSelectedSystemKeys([])
    setSelectionAnchor(null)
    closeInspector()
  }

  applyMarqueeKeysRef.current = (keys: string[]) => {
    setInspectSelection(false)
    if (tab === 'system') {
      setSelectedSystemKeys((current) => (sameKeys(current, keys) ? current : keys))
      setSelectedSystem(keys[keys.length - 1] ?? null)
      setSelectionAnchor(keys[0] ?? null)
      return
    }
    setSelectedFamilyKeys((current) => (sameKeys(current, keys) ? current : keys))
    const last = keys[keys.length - 1] ?? null
    setSelectedFamily(last)
    const group = visibleGroups.find((item) => item.familyName === last)
    setSelectedEntryId(group?.entries[0]?.id ?? null)
    setSelectionAnchor(keys[0] ?? null)
  }

  function handleListPointerDown(event: PointerEvent<HTMLElement>) {
    if (dragging || event.button !== 0) return
    if (!canStartMarquee(event.target)) return

    const currentKeys = tab === 'system' ? selectedSystemKeys : selectedFamilyKeys
    const additive = event.metaKey || event.ctrlKey || event.shiftKey
    const downPreserves = clickPreservesSelection(event.target)
    let contextMenuOpened = false
    marqueeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      additive,
      baseKeys: additive ? currentKeys : [],
      active: false,
    }

    const updateFromPoint = (x: number, y: number) => {
      const session = marqueeRef.current
      if (!session) return
      session.lastX = x
      session.lastY = y
      const distance = Math.hypot(x - session.startX, y - session.startY)
      if (!session.active) {
        if (distance < 5) return
        session.active = true
        suppressClickRef.current = true
        setInspectSelection(false)
      }
      const rect = clientRect(session.startX, session.startY, x, y)
      setMarqueeRect(rect)
      const hit = keysInMarquee(collectFamilyCardRects(), rect)
      applyMarqueeKeysRef.current(mergeMarqueeSelection(session.baseKeys, hit, session.additive))
    }

    const onMove = (move: globalThis.PointerEvent) => {
      if (marqueeRef.current?.active) move.preventDefault()
      updateFromPoint(move.clientX, move.clientY)
    }
    const onScroll = () => {
      const session = marqueeRef.current
      if (!session?.active) return
      updateFromPoint(session.lastX, session.lastY)
    }
    const onContextMenu = () => {
      contextMenuOpened = true
    }
    const onUp = (up: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
      const session = marqueeRef.current
      marqueeRef.current = null
      setMarqueeRect(null)
      if (
        pointerUpClearsSelection({
          marqueeActive: Boolean(session?.active),
          downPreserves,
          contextMenuOpened,
          button: up.button,
          upPreserves: clickPreservesSelection(up.target),
        })
      ) {
        clearSelection()
        return
      }
      if (contextMenuOpened) {
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 400)
        return
      }
      if (session?.active) {
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('contextmenu', onContextMenu, true)
  }

  function selectAllVisible() {
    setInspectSelection(false)
    if (tab === 'system') {
      const keys = shownSystemGroups.map((group) => group.familyName)
      if (keys.length === 0) return
      setSelectedSystemKeys(keys)
      setSelectedSystem(keys[keys.length - 1] ?? null)
      setSelectionAnchor(keys[0] ?? null)
      return
    }
    const keys = visibleGroups.map((group) => group.familyName)
    if (keys.length === 0) return
    setSelectedFamilyKeys(keys)
    const last = visibleGroups[visibleGroups.length - 1]
    setSelectedFamily(last?.familyName ?? null)
    setSelectedEntryId(last?.entries[0]?.id ?? null)
    setSelectionAnchor(keys[0] ?? null)
  }


  const {
    uninstallGroup,
    deactivateGroup,
    reinstallGroup,
    forgetGroup,
    forgetEntry,
    removeSelected,
    installSelected,
    activateSelected,
    installOrActivateSelected,
    installGroupGuarded,
    installToAdobeFor,
    uninstallFromAdobeFor,
    uninstallInstanceFromAdobe,
    installInstanceGuarded,
    activateInstanceGuarded,
    deactivateInstance,
    uninstallInstance,
    installInstanceToAdobe,
    activateGroupGuarded,
    reinstallSelected,
    repairSelected,
    reinstallAllUpdates,
    reinstallFromMenuBar,
    forgetSelected,
    deleteFilesFor,
    deleteFilesSelected,
    uninstallAndRemoveFor,
    uninstallAndRemoveSelected,
    uninstallSelected,
    uninstallFormatFrom,
    swapFormatFrom,
    swapInstanceFormat,
    deactivateSelected,
    showDoneToast,
    run,
  } = useFontActions({
    entries,
    setEntries,
    setSystemFaces,
    operations,
    setOperations,
    busyRef,
    setBusy,
    setActionStatus,
    setTab,
    setWatchFolderFilter,
    setHighlightOperation,
    selectedCatalogGroups,
    selectedSystemList,
    tab,
    allUpdates,
    setFormatPrompt,
    setReplacePrompt,
  })
  reinstallFromMenuBarRef.current = reinstallFromMenuBar

  async function markAllActivityRead() {
    try {
      const result = await api.markActivityRead()
      operationsRef.current = result.operations
      setOperations(result.operations)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not mark activity as read')
    }
  }

  async function clearAllActivity() {
    if (operations.length === 0) return
    const confirmed = window.confirm(
      'Clear all activity history? Undo will no longer be available for these actions.',
    )
    if (!confirmed) return
    try {
      const result = await api.clearActivity()
      operationsRef.current = result.operations
      setOperations(result.operations)
      setHighlightOperation(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not clear activity')
    }
  }

  async function createProjectWith(ids: string[], familyNames: string[], name = defaultProjectName(familyNames)) {
    try {
      const result = await api.createProject(name, ids)
      setProjects((current) => [result.project, ...current.filter((item) => item.id !== result.project.id)])
      setProjectFilter(result.project.id)
      setTab('library')
      setWatchFolderFilter(null)
      toast.success(`Created ${result.project.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create project')
    }
  }

  async function createProjectFromSelection() {
    const groups = selectedCatalogGroups()
    await createProjectWith(groups.flatMap(entryIds), groups.map((group) => group.familyName))
  }

  async function addFontsToProject(projectId: string, ids: string[]) {
    const project = projects.find((item) => item.id === projectId)
    if (!project || ids.length === 0) return
    const next = uniqueMemberIds(
      project.members.map((member) => member.assetId),
      ids,
    )
    if (next.length === project.members.length) {
      toast.message(`Already in ${project.name}`)
      return
    }
    try {
      const result = await api.updateProject(projectId, { memberIds: next })
      setProjects((current) => current.map((item) => (item.id === result.project.id ? result.project : item)))
      toast.success(`Added to ${result.project.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add to project')
    }
  }

  async function removeFontsFromProject(projectId: string, ids: string[]) {
    const project = projects.find((item) => item.id === projectId)
    if (!project || ids.length === 0) return
    const next = removeMemberIds(
      project.members.map((member) => member.assetId),
      ids,
    )
    if (next.length === project.members.length) return
    try {
      const result = await api.updateProject(projectId, { memberIds: next })
      setProjects((current) => current.map((item) => (item.id === result.project.id ? result.project : item)))
      toast.success(`Removed from ${result.project.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove from project')
    }
  }

  async function renameProject(id: string, name: string) {
    try {
      const result = await api.updateProject(id, { name })
      setProjects((current) => current.map((item) => (item.id === result.project.id ? result.project : item)))
      toast.success(`Renamed to ${result.project.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rename project')
    }
  }

  function beginFontDrag() {
    fontDragRef.current = true
    marqueeRef.current = null
    setMarqueeRect(null)
  }

  function endFontDrag() {
    fontDragRef.current = false
    clearFontDragImage()
  }

  async function removeProject(id: string) {
    const project = projects.find((item) => item.id === id)
    try {
      await api.deleteProject(id)
      setProjects((current) => current.filter((item) => item.id !== id))
      setProjectFilter((current) => (current === id ? null : current))
      toast.success(`Removed ${project?.name ?? 'project'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove project')
    }
  }

  const savedFilters = settings?.savedFilters ?? []

  function persistLibraryFilters(next: LibraryFilter[]) {
    setLibraryFilters(next)
    localStorage.setItem(LIBRARY_FILTERS_KEY, JSON.stringify(next))
  }

  async function persistSavedFilters(next: SavedLibraryFilter[], done?: string) {
    try {
      const result = await api.updateSettings({ savedFilters: next })
      applySettings(result.settings)
      if (done) toast.success(done)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update saved filters')
    }
  }

  function createSavedFilterFromView() {
    void persistSavedFilters(
      createSavedFilter(savedFilters, {
        query,
        libraryFilters,
        watchFolder: watchFolderFilter,
      }),
      'Saved filter',
    )
  }

  function applySavedFilter(filter: SavedLibraryFilter) {
    const current = { query, libraryFilters, watchFolder: watchFolderFilter }
    setTab('library')
    setProjectFilter(null)
    if (savedFilterMatches(filter, current)) {
      const empty = emptyLibraryCriteria()
      setQuery(empty.query)
      persistLibraryFilters([...empty.libraryFilters])
      setWatchFolderFilter(empty.watchFolder)
      return
    }
    setQuery(filter.query)
    persistLibraryFilters(filter.libraryFilters)
    setWatchFolderFilter(filter.watchFolder)
  }

  async function persistSpecimen(next: PreviewPreferences) {
    const current = settingsRef.current
    if (!current) return
    applySettings({
      ...current,
      specimen: next,
    })
    try {
      const result = await api.updateSettings({ specimen: next })
      applySettings(result.settings)
    } catch {
      // Specimen text is remembered locally even if settings fail to persist.
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (busy || renameEntry) return
      if (document.querySelector('[role="dialog"]')) return
      const action = shortcutAction(event)
      if (!action) return
      if (action === 'collapse') {
        if (!inspectSelection) return
        if (document.querySelector('[data-radix-popper-content-wrapper], [role="menu"]')) return
        event.preventDefault()
        closeInspector()
        return
      }
      if (action === 'inspect') {
        if (selectionCount !== 1) return
        event.preventDefault()
        if (!inspectSelection) {
          setInspectorDensity(DEFAULT_INSPECTOR_DENSITY)
          setInspectorPane('details')
          setInspectSelection(true)
        }
        return
      }
      if (action === 'specimen') {
        if (!inspectSelection) return
        event.preventDefault()
        setInspectorPane('tester')
        return
      }
      event.preventDefault()
      if (action === 'remove') void removeSelected()
      if (action === 'install') void installOrActivateSelected()
      if (action === 'deactivate') void deactivateSelected()
      if (action === 'selectAll') selectAllVisible()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    const paths = files
      .map((file) => desktopPathForFile(file))
      .filter((value): value is string => Boolean(value))
    await importDropped(paths, files, libraryProjectTarget())
  }

  function libraryProjectTarget(): string | undefined {
    return tab === 'library' ? projectFilter ?? undefined : undefined
  }

  async function handleDrop(dataTransfer: DataTransfer, projectId?: string) {
    if (fontDragRef.current || hasFontButlerEntries(dataTransfer)) {
      setDragging(false)
      return
    }
    const targetProjectId = projectId ?? libraryProjectTarget()
    try {
      const payload = await collectDropPayload(dataTransfer)
      setDragging(false)
      let folders = payload.folders
      let paths = payload.paths
      const nativePaths = [...new Set([...payload.folders, ...payload.paths])]
      if (nativePaths.length > 0) {
        try {
          const inspected = await api.inspectDrop(nativePaths)
          folders = [...new Set([...folders, ...inspected.folders])]
          if (inspected.files.length > 0) {
            paths = inspected.files
          }
        } catch {
          // Keep the renderer payload when the API cannot stat native paths.
        }
      }
      if (folders.length === 0 && payload.hadDirectory && paths.length > 0) {
        const fallback = commonDroppedFolder(paths)
        if (fallback) folders = [fallback]
      }
      if (targetProjectId) {
        await importDropped(
          importPathsForProjectDrop(paths, folders),
          payload.files,
          targetProjectId,
        )
        return
      }
      if (folders.length > 0) {
        setFolderDrop({ folders, paths, files: payload.files })
        return
      }
      await importDropped(paths, payload.files)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add fonts')
      setDragging(false)
    }
  }

  function selectLibrary(folder: string | null) {
    setTab('library')
    setWatchFolderFilter(folder)
    setProjectFilter(null)
    if (folder === null) closeInspector()
  }

  async function watchDroppedFolders(folders: string[], leftover: { paths: string[]; files: File[] }) {
    setFolderSetupRoots(folders)
    const loosePaths = leftover.paths.filter(
      (filePath) => !folders.some((folder) => isPathUnderFolder(filePath, folder)),
    )
    if (loosePaths.length || leftover.files.length) {
      await importDropped(loosePaths, leftover.files)
    }
  }

  function askImportPlan(plan: ImportPlan): Promise<ImportPlanDecision | null> {
    return new Promise((resolve) => {
      setImportPlan(plan)
      setImportPlanResolve(() => resolve)
    })
  }

  async function applyImportPlan(
    plan: ImportPlan,
    choices?: Record<string, ImportPlanItem['defaultChoice']>,
    familyName?: string,
  ) {
    const result = await api.applyPlan(plan.id, choices, {
      idempotencyKey: plan.id,
      familyName,
    })
    const latest = (await api.catalog()).entries
    setEntries(latest)
    const preview = result.entries.filter((entry) => entry.previewOnly).length
    const firstEntry = result.entries[0]
    const names = [...new Set(result.entries.map(familyNameOf))]
    if (result.entries.length) {
      setQuery('')
      setWatchFolderFilter(null)
      setTab('library')
      setSelectedFamily(names[0] ?? null)
      setSelectedFamilyKeys(names)
      setSelectionAnchor(names[0] ?? null)
      setInspectSelection(names.length === 1)
      setSelectedEntryId(result.entries[0]?.id ?? null)
      setScrollToFamily(names[0] ?? null)
    }
    showDoneToast(
      importDoneCopy({
        installed: result.succeeded > 0 && preview < result.succeeded,
        count: result.entries.length,
        name: firstEntry ? familyNameOf(firstEntry) : undefined,
        preview,
        skipped: result.skipped,
      }),
      result.failedIds,
      { operationId: result.operationId },
    )
    if (result.errors.length) toast.error(result.errors.join('\n'))
    return result
  }

  async function importDropped(
    paths: string[],
    files: File[],
    target?: string | { projectId?: string; newProjectName?: string },
  ) {
    const projectId = typeof target === 'string' ? target : target?.projectId
    const newProjectName = typeof target === 'object' ? target?.newProjectName : undefined
    const partitioned = partitionDropPayload(paths, files)
    const planPaths = planPathsForImport(paths, partitioned.paths)
    if (planPaths.length === 0 && partitioned.files.length === 0) {
      toast.error(emptyImportError([], 0))
      setDragging(false)
      return
    }
    busyRef.current = true
    setBusy(true)
    setActionStatus('Planning import…')
    try {
      if (planPaths.length) {
        const plan = await api.planImport(planPaths)
        let imported: CatalogEntry[] = []
        let activePlan = plan
        const dropCollisions = plan.retailCollisions ?? []
        if (dropCollisions.length > 0) {
          setActionStatus(null)
          const decisions = await askDropRetailCollisions(dropCollisions)
          if (!decisions) return
          const replaceChoices: Record<string, RetailCollisionAction> = {}
          const skipped = new Set<string>()
          for (const [familyName, action] of Object.entries(decisions)) {
            if (action === 'keep') skipped.add(familyName)
            else replaceChoices[familyName] = 'replace'
          }
          if (Object.keys(replaceChoices).length) {
            const resolved = await api.retail.resolveDropCollisions(replaceChoices, {
              planId: plan.id,
              incoming: plan.items.map((item) => ({ familyName: item.familyName, path: item.path })),
            })
            setRetail(resolved.status)
            setEntries((await api.catalog()).entries)
          }
          const remainingPaths = plan.items
            .filter((item) => !skipped.has(item.familyName ?? ''))
            .map((item) => item.path)
          if (remainingPaths.length === 0) return
          activePlan = await api.planImport(remainingPaths)
        }
        if (planNeedsReview(activePlan)) {
          setActionStatus(null)
          const decision = await askImportPlan(activePlan)
          if (!decision) return
          setActionStatus('Adding fonts…')
          imported = (await applyImportPlan(activePlan, decision.choices, decision.familyName)).entries
        } else if (!projectId || activePlan.items.some((item) => item.defaultChoice !== 'skip')) {
          setActionStatus('Adding fonts…')
          imported = (await applyImportPlan(activePlan)).entries
        }
        if (newProjectName) {
          const ids = memberIdsForProjectImport(activePlan, imported)
          if (ids.length === 0) {
            toast.error(emptyImportError([], partitioned.skippedWeb))
            return
          }
          await createProjectWith(
            ids,
            imported.map((entry) => familyNameOf(entry)),
            newProjectName,
          )
        } else if (projectId) {
          const ids = memberIdsForProjectImport(activePlan, imported)
          if (ids.length === 0) {
            toast.error(emptyImportError([], partitioned.skippedWeb))
            return
          }
          await addImportedFontsToProject(projectId, ids)
        }
        return
      }
      const result = await api.importFiles(partitioned.files)
      if (result.entries.length === 0) {
        toast.error(emptyImportError(result.errors, 0))
        return
      }
      const preview = result.entries.filter((entry) => entry.previewOnly).length
      const names = [...new Set(result.entries.map(familyNameOf))]
      setQuery('')
      setWatchFolderFilter(null)
      setTab('library')
      setSelectedFamily(names[0] ?? null)
      setSelectedFamilyKeys(names)
      setInspectSelection(names.length === 1)
      setSelectedEntryId(result.entries[0]?.id ?? null)
      setScrollToFamily(names[0] ?? null)
      toast.success(
        importDoneCopy({
          installed: settings?.installAfterUpload !== false,
          count: result.entries.length,
          name: familyNameOf(result.entries[0]),
          preview,
        }),
      )
      setEntries((await api.catalog()).entries)
      if (newProjectName) {
        await createProjectWith(
          result.entries.map((entry) => entry.id),
          names,
          newProjectName,
        )
      } else if (projectId) {
        await addImportedFontsToProject(
          projectId,
          result.entries.map((entry) => entry.id),
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add fonts')
    } finally {
      busyRef.current = false
      setBusy(false)
      setActionStatus(null)
      setDragging(false)
    }
  }

  async function addImportedFontsToProject(projectId: string, ids: string[]) {
    await addFontsToProject(projectId, ids)
    setProjectFilter(projectId)
    setWatchFolderFilter(null)
    setTab('library')
  }

  async function revealCatalog(entry: CatalogEntry, which: 'source' | 'installed' = 'installed') {
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

  async function revealWatchFolder(folder: string) {
    try {
      const result = await api.reveal({ path: folder })
      toast.message(`Showing ${result.path}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not show folder')
    }
  }

  async function removeWatchFolder(folder: string) {
    try {
      const result = await api.updateSettings({
        watchFolders: watchFolders.filter((item) => item !== folder),
      })
      applySettings(result.settings)
      if (watchFolderFilter === folder) setWatchFolderFilter(null)
      toast.success(`Stopped watching ${watchFolderName(folder)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove watch folder')
    }
  }

  return (
    <LatinPreviewProvider text={latinPreviewText(settings?.latinPreview)}>
      <div
        className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row"
        onDragEnter={(event) => {
          if (fontDragRef.current || hasFontButlerEntries(event.dataTransfer)) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => {
          if (fontDragRef.current || hasFontButlerEntries(event.dataTransfer)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          void handleDrop(event.dataTransfer)
        }}
      >
        <FontFaceStyles
          entries={entries}
          systemFaces={previewSystemFaces}
        />
        <Sidebar
          query={query}
          onQueryChange={setQuery}
          tab={tab}
          onTabChange={(next) => {
            setTab(next)
            if (next !== 'library') setWatchFolderFilter(null)
            if (next === 'library') setProjectFilter(null)
          }}
          watchFolders={watchFolders}
          watchFolderFilter={watchFolderFilter}
          watchFolderCounts={watchFolderCounts}
          onSelectWatchFolder={selectLibrary}
          onRevealWatchFolder={(folder) => void revealWatchFolder(folder)}
          onRemoveWatchFolder={(folder) => void removeWatchFolder(folder)}
          folders={settings?.folders}
          projects={projects}
          projectFilter={projectFilter}
          onSelectProject={(id) => {
            setProjectFilter((current) => (current === id ? null : id))
            setTab('library')
            setWatchFolderFilter(null)
          }}
          onActivateProject={(id) =>
            void run(() => api.activateProject(id), { pending: 'Activating project…', done: 'Activated project' })
          }
          onDeactivateProject={(id) =>
            void run(() => api.deactivateProject(id), { pending: 'Releasing project…', done: 'Released project' })
          }
          onRenameProject={(id, name) => void renameProject(id, name)}
          onAddFontsToProject={(id, ids) => void addFontsToProject(id, ids)}
          onDropFilesOnProject={(id, dataTransfer) => void handleDrop(dataTransfer, id)}
          onRemoveProject={(id) => void removeProject(id)}
          onCreateProject={() => void createProjectFromSelection()}
          savedFilters={savedFilters}
          onSelectSavedFilter={applySavedFilter}
          onCreateSavedFilter={createSavedFilterFromView}
          onRenameSavedFilter={(id, name) =>
            void persistSavedFilters(renameSavedFilter(savedFilters, id, name), `Renamed to ${name}`)
          }
          onRemoveSavedFilter={(id) => {
            const name = savedFilters.find((item) => item.id === id)?.name
            void persistSavedFilters(deleteSavedFilter(savedFilters, id), `Removed ${name ?? 'saved filter'}`)
          }}
          libraryFilters={libraryFilters}
          libraryFilterCounts={libraryFilterCounts}
          onLibraryFiltersChange={(next) => {
            persistLibraryFilters(next)
          }}
          duplicatesCount={duplicates.length}
          onOpenDuplicates={() => setDuplicatesOpen(true)}
          counts={tabCounts}
          activityUnread={activityUnread}
          hasAppUpdate={Boolean(appUpdate?.updateAvailable)}
          hasFontUpdates={allUpdates.length > 0}
          searching={searching}
          retailPending={retail?.pending ?? 0}
          retailEnabled={Boolean(retail?.enabled)}
          retailBusy={retailBusy}
          retailCount={watchFolderCounts[RETAIL_LIBRARY_FILTER] ?? 0}
          onSyncRetail={() => void syncRetail()}
          onReinstallAllUpdates={() => void reinstallAllUpdates()}
          onOpenSettings={() => {
            setSettingsFocusAppUpdate(Boolean(appUpdate?.updateAvailable))
            setSettingsFocusWatchFolders(false)
            setSettingsOpen(true)
          }}
          onOpenWatchFoldersSettings={() => {
            setSettingsFocusAppUpdate(false)
            setSettingsFocusWatchFolders(true)
            setSettingsOpen(true)
          }}
        />

        <div className="relative flex min-h-0 min-w-0 flex-1">
          <div
            className={cn(
              'relative flex min-h-0 min-w-0 flex-1 flex-col',
              hideBrowseGrid && 'hidden',
            )}
          >
          <section
            className={cn('flex min-h-0 min-w-0 flex-1 flex-col', marqueeRect && 'select-none')}
            onPointerDown={handleListPointerDown}
          >
            {tab !== 'activity' && (
              <div
                data-keep-selection=""
                data-no-marquee=""
                className={cn(
                  'relative shrink-0 space-y-3 bg-background px-3 pt-3 pb-3',
                  insetTrafficLights && 'app-region-drag',
                )}
              >
                {!searching && allUpdates.length > 0 && tab !== 'updates' ? (
                  <Button
                    type="button"
                    size="sm"
                    className="app-region-no-drag absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full border-0 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
                    onClick={() => {
                      setTab('updates')
                      setWatchFolderFilter(null)
                    }}
                  >
                    <RefreshCw />
                    {allUpdates.length === 1
                      ? 'Font update available'
                      : `${allUpdates.length} font updates available`}
                  </Button>
                ) : tab === 'updates' && updateGroups.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    className="app-region-no-drag absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full border-0 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
                    onClick={() => void reinstallAllUpdates()}
                  >
                    <RefreshCw />
                    Reinstall all
                  </Button>
                ) : null}
                <ViewOptions
                    layout={viewLayout}
                    onLayoutChange={(next) => {
                      setViewLayout(next)
                      localStorage.setItem('font-butler-view-layout', next)
                      void persistPreferences({ defaultView: next })
                    }}
                    sortMode={sortMode}
                    onSortModeChange={(next) => {
                      setSortMode(next)
                      localStorage.setItem('font-butler-sort', next)
                      void persistPreferences({ defaultSort: next })
                    }}
                    showSources={showSources}
                    onShowSourcesChange={(next) => {
                      setShowSources(next)
                      localStorage.setItem('font-butler-show-sources', String(next))
                    }}
                    showSourcesToggle
                    showAdded={showAdded}
                    onShowAddedChange={(next) => {
                      setShowAdded(next)
                      localStorage.setItem('font-butler-show-added', String(next))
                    }}
                    hideDestinations={hideDestinations}
                    onHideDestinationsChange={(next) => {
                      setHideDestinations(next)
                      localStorage.setItem('font-butler-hide-destinations', String(next))
                    }}
                    previewSize={gridPreviewSize}
                    onPreviewSizeChange={(next) => {
                      setGridPreviewSize(next)
                      localStorage.setItem(GRID_PREVIEW_SIZE_KEY, String(next))
                    }}
                  />
                {tab === 'system' && !query.trim() && systemGroups.length > shownSystemGroups.length && (
                  <p className="text-sm text-muted-foreground">
                    Showing {shownSystemGroups.length} of {systemGroups.length} families. Search to jump to
                    the rest.
                  </p>
                )}
              </div>
            )}
            <ScrollArea className="min-h-0 flex-1">
              <div className={cn('flex min-h-full flex-col p-3', showBatchBar && 'pb-24')}>
                {!loading && tab === 'updates' && (retail?.pending ?? 0) > 0 && retail ? (
                  <div className="pt-3">
                    <RetailUpdateCard
                      status={retail}
                      busy={retailBusy}
                      onSync={() => void syncRetail()}
                      onOpenSettings={() => {
                        setSettingsFocusAppUpdate(false)
                        setSettingsFocusWatchFolders(true)
                        setSettingsOpen(true)
                      }}
                    />
                  </div>
                ) : null}
                {!loading && tab === 'updates' && appUpdate?.updateAvailable ? (
                  <div className="mb-3">
                    <AppUpdateCard status={appUpdate} compact />
                  </div>
                ) : null}
                {error && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
                )}
                {!loading && tab === 'activity' && (
                  <ActivityView
                    operations={visibleOperations}
                    query={query}
                    entries={entries}
                    highlightId={highlightOperation}
                    onUndo={(id) =>
                      void run(() => api.undo(id), { pending: 'Undoing…', done: 'Undid the last change' })
                    }
                    onMarkAllRead={() => void markAllActivityRead()}
                    onClearAll={() => void clearAllActivity()}
                  />
                )}
                {!loading && tab !== 'system' && tab !== 'activity' && visibleGroups.length === 0 && (
                  searching ? (
                    <p className="px-2 py-12 text-center text-sm text-muted-foreground">
                      {tab === 'updates' ? 'No updates match this search.' : 'No fonts match this search.'}
                    </p>
                  ) : tab === 'library' && libraryGroupsUnfiltered.length > 0 && libraryFilters.length > 0 ? (
                    <p className="px-2 py-12 text-center text-sm text-muted-foreground">
                      No fonts match these filters.
                    </p>
                  ) : tab === 'updates' && allUpdates.length > 0 ? (
                    <p className="px-2 py-12 text-center text-sm text-muted-foreground">
                      No updates match this search.
                    </p>
                  ) : (
                    <EmptyState
                      tab={tab}
                      watchFolderName={
                        tab === 'library' && watchFolderFilter
                          ? libraryFolderFilterLabel(watchFolderFilter, watchFolders)
                          : null
                      }
                      projectName={
                        tab === 'library' && projectFilter
                          ? projects.find((item) => item.id === projectFilter)?.name
                          : null
                      }
                      onPickFiles={(files) => void handleFiles(files)}
                    />
                  )
                )}
                {!loading && tab === 'system' && systemGroups.length === 0 && (
                  <p className="px-2 py-12 text-center text-sm text-muted-foreground">
                    {searching ? 'No fonts match this search.' : 'No fonts found in the system folders.'}
                  </p>
                )}
                {!loading && missingSourceCount > 0 && tab !== 'system' && tab !== 'updates' && tab !== 'activity' && (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2">
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
                          actionCopy(
                            'forget',
                            `${missingSourceCount} missing ${missingSourceCount === 1 ? 'font' : 'fonts'}`,
                          ),
                        )
                      }
                    >
                      Remove all missing sources
                    </Button>
                  </div>
                )}
                <div
                  className={cn('grid', viewLayout === 'grid' ? 'gap-3' : 'gap-2')}
                  style={
                    viewLayout === 'grid'
                      ? {
                          gridTemplateColumns: `repeat(auto-fill, minmax(${gridCardMinWidthRem(gridPreviewSize)}rem, 1fr))`,
                        }
                      : undefined
                  }
                >
                  {tab === 'system'
                    ? shownSystemGroups.map((group) => {
                        const inSelection = systemSelection.some((item) => item.key === group.key)
                        return (
                        <SystemCard
                          key={group.key}
                          layout={viewLayout}
                          previewSize={gridPreviewSize}
                          group={group}
                          showSourcePath={showSources}
                          selected={inSelection || selectedSystemGroup?.key === group.key}
                          busy={busy}
                          batch={systemSelection.length > 1 && inSelection ? systemPlan : null}
                          onSelect={(event) => handleSystemSelect(group, event)}
                          onInspect={() => inspectSystemGroup(group)}
                          onReveal={() => {
                            setSelectedSystem(group.familyName)
                            void revealSystem(group.faces[0].path)
                          }}
                          onUninstall={() =>
                            systemSelection.length > 1 && inSelection
                              ? void uninstallSelected()
                              : void run(async () => {
                                  for (const face of uniquePaths(group.faces)) {
                                    await api.uninstallSystem(face)
                                  }
                                  setSystemFaces((await api.system()).faces)
                                }, actionCopy('remove', group.familyName))
                          }
                          onDeactivate={() =>
                            systemSelection.length > 1 && inSelection
                              ? void deactivateSelected()
                              : void run(async () => {
                                  for (const face of uniquePaths(group.faces)) {
                                    await api.deactivateSystem(face)
                                  }
                                  setSystemFaces((await api.system()).faces)
                                }, actionCopy('deactivate', group.familyName))
                          }
                        />
                        )
                      })
                    : visibleGroups.map((group) => {
                        const inSelection = catalogSelection.some((item) => item.key === group.key)
                        const useBatch = catalogSelection.length > 1 && inSelection
                        return (
                        <LibraryCard
                          key={group.key}
                          layout={viewLayout}
                          previewSize={gridPreviewSize}
                          group={group}
                          showSourcePath={showSources}
                          showAddedAt={showAdded}
                          hideDestinations={hideDestinations}
                          selected={inSelection || selectedGroup?.key === group.key}
                          selectedEntryId={selectedEntryId}
                          batch={useBatch ? catalogPlan : null}
                          onSelect={(event) => handleCatalogSelect(group, event)}
                          onInspect={() => selectGroup(group)}
                          onSelectEntry={setSelectedEntryId}
                          onEnsureSelected={() => {
                            if (!inSelection) {
                              setSelectedFamily(group.familyName)
                              setSelectedFamilyKeys([group.familyName])
                              setSelectionAnchor(group.familyName)
                              setSelectedEntryId(group.entries[0]?.id ?? null)
                            }
                            setInspectSelection(false)
                          }}
                          busy={busy}
                          onInstall={() =>
                            useBatch ? void installSelected() : void installGroupGuarded(group)
                          }
                          onInstallAs={() => {
                            setBakeRenameFeatures(null)
                            setRenameEntry(selectedEntry ?? group.entries[0])
                          }}
                          onInstallToAdobe={() =>
                            useBatch
                              ? void installToAdobeFor(catalogSelection)
                              : void installToAdobeFor([group])
                          }
                          onInstallInstance={(entryId) => void installInstanceGuarded(entryId)}
                          onActivateInstance={(entryId) => void activateInstanceGuarded(entryId)}
                          onDeactivateInstance={(entryId) => void deactivateInstance(entryId)}
                          onUninstallInstance={(entryId) => void uninstallInstance(entryId)}
                          onInstallInstanceToAdobe={(entryId) => void installInstanceToAdobe(entryId)}
                          onUninstallInstanceFromAdobe={(entryId) => void uninstallInstanceFromAdobe(entryId)}
                          onSwapInstanceFormat={(entryId) => void swapInstanceFormat(entryId)}
                          adobeAvailable={adobeAvailable}
                          onReinstall={() =>
                            useBatch
                              ? void reinstallSelected()
                              : void run(() => reinstallGroup(group), actionCopy('reinstall', group.familyName))
                          }
                          onLocateSource={() => {
                            const target = group.entries.find(needsLocateSource) ?? group.entries[0]
                            if (!target) return
                            setRelinkMode(target.sourceAvailability === 'none' ? 'link' : 'locate')
                            setRelinkEntry(target)
                          }}
                          onUninstall={() =>
                            useBatch
                              ? void uninstallSelected()
                              : void run(() => uninstallGroup(group), actionCopy('remove', group.familyName), {
                                  undo: 'uninstall',
                                })
                          }
                          onUninstallFormat={(format) =>
                            uninstallFormatFrom(useBatch ? catalogSelection : [group], format)
                          }
                          onUninstallAndRemove={() => {
                            if (useBatch) {
                              void uninstallAndRemoveSelected()
                              return
                            }
                            void uninstallAndRemoveFor([group])
                          }}
                          onUninstallFromAdobe={() =>
                            useBatch
                              ? void uninstallFromAdobeFor(catalogSelection)
                              : void uninstallFromAdobeFor([group])
                          }
                          onDeactivate={() =>
                            useBatch
                              ? void deactivateSelected()
                              : void run(() => deactivateGroup(group), actionCopy('deactivate', group.familyName))
                          }
                          onActivate={() =>
                            useBatch ? void activateSelected() : void activateGroupGuarded(group)
                          }
                          onSwitch={
                            familyHasSwitch(group, entries)
                              ? () => {
                                  const switchable = switchableEntries(group, entries)
                                  const target =
                                    switchable.find((entry) => entry.id === selectedEntryId) ?? switchable[0]
                                  if (!target) return
                                  void run(
                                    () => api.switchTo(target.id),
                                    { pending: 'Switching…', done: 'Switched active copy' },
                                  )
                                }
                              : undefined
                          }
                          onFormatSwap={() => swapFormatFrom(group)}
                          onReveal={() => {
                            const entry = catalogRevealEntry(
                              group,
                              selectedEntry,
                              'installed',
                            )
                            if (entry) void revealCatalog(entry, 'installed')
                          }}
                          onRevealSource={() => {
                            const entry = catalogRevealEntry(group, selectedEntry, 'source')
                            if (entry) void revealCatalog(entry, 'source')
                          }}
                          onForget={() => {
                            if (useBatch) {
                              void forgetSelected()
                              return
                            }
                            void run(() => forgetGroup(group), actionCopy('forget', group.familyName))
                          }}
                          onDeleteFiles={() => {
                            if (useBatch) {
                              void deleteFilesSelected()
                              return
                            }
                            void deleteFilesFor([group])
                          }}
                          onTurnRetailSyncOff={
                            retailOptOutNames(group.entries).length
                              ? () =>
                                  void turnRetailSyncOff(
                                    retailOptOutNames(
                                      useBatch
                                        ? catalogSelection.flatMap((item) => item.entries)
                                        : group.entries,
                                    ),
                                  )
                              : undefined
                          }
                          onTurnInstanceRetailSyncOff={
                            retailOptOutNames(group.entries).length
                              ? (entryId) => {
                                  const entry = group.entries.find((item) => item.id === entryId)
                                  if (!entry) return
                                  void turnRetailSyncOff(retailOptOutNames([entry]))
                                }
                              : undefined
                          }
                          projects={projects}
                          projectFilter={projectFilter}
                          dragIds={useBatch ? catalogSelection.flatMap(entryIds) : entryIds(group)}
                          projectFamilyNames={
                            useBatch
                              ? catalogSelection.map((item) => item.familyName)
                              : [group.familyName]
                          }
                          onAddToProject={(id, ids) => void addFontsToProject(id, ids)}
                          onRemoveFromProject={(id, ids) => void removeFontsFromProject(id, ids)}
                          onCreateProjectFromCard={(ids, familyNames) => void createProjectWith(ids, familyNames)}
                          onFontDragStart={beginFontDrag}
                          onFontDragEnd={endFontDrag}
                        />
                        )
                      })}
                </div>
                <div className="min-h-8 flex-1" aria-hidden />
              </div>
            </ScrollArea>
          </section>
          <BatchActionBarContainer open={showBatchBar}>
            {tab === 'system' ? (
              <BatchActionBar count={systemPlan.count} summary={systemSummary}>
                <SystemBatchButtons
                  plan={systemPlan}
                  busy={busy}
                  onDeactivate={() => void deactivateSelected()}
                  onUninstall={() => void uninstallSelected()}
                />
              </BatchActionBar>
            ) : (
              <BatchActionBar count={catalogPlan.count} summary={catalogSummary}>
                <CatalogBatchButtons
                  plan={catalogPlan}
                  busy={busy}
                  onInstall={() => void installSelected()}
                  onActivate={() => void activateSelected()}
                  onDeactivate={() => void deactivateSelected()}
                  onUninstall={() => void uninstallSelected()}
                  onUninstallAndRemove={() => void uninstallAndRemoveSelected()}
                  onUninstallFromAdobe={() => void uninstallFromAdobeFor(catalogSelection)}
                  onReinstall={() => void reinstallSelected()}
                  onRepair={() => void repairSelected()}
                  onForget={() => void forgetSelected()}
                  onDeleteFiles={() => void deleteFilesSelected()}
                  formatSwap={
                    catalogSelection.length === 1
                      ? formatSwap(catalogSelection[0]!.entries)
                      : null
                  }
                  onFormatSwap={() => {
                    const group = catalogSelection[0]
                    if (group) swapFormatFrom(group)
                  }}
                  splitMenuPlacement="up"
                />
              </BatchActionBar>
            )}
          </BatchActionBarContainer>
          </div>
          {showInspector && (
          <div
            data-keep-selection=""
            className="z-20 flex min-h-0 min-w-0 flex-1 flex-col bg-background"
            role="region"
            aria-label="Font details"
          >
            <div
              className={cn(
                'grid shrink-0 grid-cols-[2.25rem_1fr_2.25rem] items-center px-5 pt-2',
                insetTrafficLights && 'app-region-drag',
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 px-0"
                    aria-label="Back to grid"
                    onClick={closeInspector}
                  >
                    <ArrowLeft />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Back to grid</TooltipContent>
              </Tooltip>
              <div className="flex justify-center">
                <InspectorTabList
                  tablistId={inspectorTablistId}
                  tabs={inspectorPaneTabs(tab !== 'system')}
                  value={inspectorPane}
                  onChange={setInspectorPane}
                />
              </div>
              <div />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
            <Inspector
              density={inspectorDensity}
              pane={inspectorPane}
              onPaneChange={setInspectorPane}
              tablistId={inspectorTablistId}
              group={tab === 'system' ? null : selectedGroup}
              entry={tab === 'system' ? null : selectedEntry}
              statusSummary={selectedGroup ? familyStatusSummary(selectedGroup) : null}
              selectedEntryId={selectedEntryId}
              onSelectEntry={setSelectedEntryId}
              instanceActions={
                selectedGroup
                  ? {
                      entries: selectedGroup.entries,
                      busy,
                      onInstall: (entryId) => void installInstanceGuarded(entryId),
                      onActivate: (entryId) => void activateInstanceGuarded(entryId),
                      onDeactivate: (entryId) => void deactivateInstance(entryId),
                      onUninstall: (entryId) => void uninstallInstance(entryId),
                      onInstallToAdobe: (entryId) => void installInstanceToAdobe(entryId),
                      onUninstallFromAdobe: (entryId) => void uninstallInstanceFromAdobe(entryId),
                      adobeAvailable,
                      onFormatSwap: (entryId) => void swapInstanceFormat(entryId),
                      onOpen: setSelectedEntryId,
                      onTurnRetailSyncOff: retailOptOutNames(selectedGroup.entries).length
                        ? (entryId) => {
                            const entry = selectedGroup.entries.find((item) => item.id === entryId)
                            if (!entry) return
                            void turnRetailSyncOff(retailOptOutNames([entry]))
                          }
                        : undefined,
                    }
                  : undefined
              }
              systemGroup={selectedSystemGroup}
              busy={busy}
              specimen={specimenFromSettings(settings?.specimen)}
              onSpecimenChange={(next) => void persistSpecimen(next)}
              projects={projects}
              compareEntry={
                catalogSelection.length === 2
                  ? catalogSelection.find((group) => group.familyName !== selectedFamily)?.entries[0] ?? null
                  : null
              }
              onBake={(mode, features) => {
                if (!selectedEntry) return
                if (mode === 'new-copy') {
                  setBakeRenameFeatures(features)
                  setRenameEntry(selectedEntry)
                  return
                }
                const family = familyNameOf(selectedEntry)
                const labels = features.join(', ')
                void run(
                  async () => {
                    const result = await api.bakeFeatures(selectedEntry.id, features, 'reinstall')
                    const warnings = bakeReportWarnings(result.report)
                    if (warnings.length) toast.warning(warnings.join('\n'))
                    return result
                  },
                  {
                    pending: `Baking ${labels} into ${family}…`,
                    done: `Baked ${labels} into ${family} and reinstalled`,
                  },
                )
              }}
              onInstall={() => selectedGroup && void installGroupGuarded(selectedGroup)}
              onInstallAs={() => {
                setBakeRenameFeatures(null)
                setRenameEntry(selectedEntry)
              }}
              onReinstall={() =>
                selectedGroup &&
                void run(() => reinstallGroup(selectedGroup), actionCopy('reinstall', selectedGroup.familyName))
              }
              onRepair={() => void repairSelected()}
              onUninstall={() =>
                selectedGroup &&
                void run(() => uninstallGroup(selectedGroup), actionCopy('remove', selectedGroup.familyName), {
                  undo: 'uninstall',
                })
              }
              onUninstallFormat={(format) => selectedGroup && uninstallFormatFrom([selectedGroup], format)}
              onUninstallAndRemove={() => {
                if (!selectedGroup) return
                void uninstallAndRemoveFor([selectedGroup])
              }}
              onUninstallFromAdobe={() => selectedGroup && void uninstallFromAdobeFor([selectedGroup])}
              onDeactivate={() =>
                selectedGroup &&
                void run(() => deactivateGroup(selectedGroup), actionCopy('deactivate', selectedGroup.familyName))
              }
              onActivate={() => selectedGroup && void activateGroupGuarded(selectedGroup)}
              onSwitch={
                selectedEntry && canSwitchTo(selectedEntry, entries)
                  ? () =>
                      void run(
                        () => api.switchTo(selectedEntry.id),
                        { pending: 'Switching…', done: 'Switched active copy' },
                      )
                  : undefined
              }
              onFormatSwap={() => selectedGroup && swapFormatFrom(selectedGroup)}
              onReveal={(which) => selectedEntry && void revealCatalog(selectedEntry, which)}
              onUninstallSystem={() =>
                selectedSystemGroup &&
                void run(async () => {
                  for (const face of uniquePaths(selectedSystemGroup.faces)) {
                    await api.uninstallSystem(face)
                  }
                  setSystemFaces((await api.system()).faces)
                }, actionCopy('remove', selectedSystemGroup.familyName))
              }
              onDeactivateSystem={() =>
                selectedSystemGroup &&
                void run(async () => {
                  for (const face of uniquePaths(selectedSystemGroup.faces)) {
                    await api.deactivateSystem(face)
                  }
                  setSystemFaces((await api.system()).faces)
                }, actionCopy('deactivate', selectedSystemGroup.familyName))
              }
              onRevealSystem={() =>
                selectedSystemGroup?.faces[0] && void revealSystem(selectedSystemGroup.faces[0].path)
              }
              onForget={() => {
                if (!selectedEntry) return
                if (selectedEntry.status !== 'source-missing' && selectedEntry.status !== 'uninstalled') {
                  return
                }
                void run(
                  () => forgetEntry(selectedEntry),
                  actionCopy('forget', familyNameOf(selectedEntry)),
                )
              }}
              onDeleteFiles={() => {
                if (!selectedGroup) return
                void deleteFilesFor([selectedGroup])
              }}
              onLocateSource={() => {
                if (!selectedEntry) return
                setRelinkMode('locate')
                setRelinkEntry(selectedEntry)
              }}
              onLinkSource={() => {
                if (!selectedEntry) return
                setRelinkMode('link')
                setRelinkEntry(selectedEntry)
              }}
              onInstallToAdobe={() =>
                selectedGroup && void installToAdobeFor([selectedGroup])
              }
              adobeAvailable={adobeAvailable}
              onResumeUpdates={() =>
                selectedEntry &&
                void run(() => api.resumeUpdates(selectedEntry.id), {
                  pending: 'Resuming updates…',
                  done: 'Resumed updates',
                })
              }
              onRestore={(fingerprint) =>
                selectedEntry &&
                void run(() => api.restoreRevision(selectedEntry.id, fingerprint), {
                  pending: 'Restoring previous version…',
                  done: 'Restored previous version',
                })
              }
              onPin={(fingerprint) => {
                if (!selectedEntry) return
                void (async () => {
                  try {
                    let project = projects.find((item) => item.id === projectFilter) ?? projects[0]
                    if (!project) {
                      project = (await api.createProject(familyNameOf(selectedEntry), [selectedEntry.id])).project
                    }
                    const result = await api.updateProject(project.id, {
                      pin: { assetId: selectedEntry.id, fingerprint },
                    })
                    setProjects((current) =>
                      current.map((item) => (item.id === result.project.id ? result.project : item)),
                    )
                    toast.success(`Pinned for ${result.project.name}`)
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Could not pin that revision')
                  }
                })()
              }}
              onOpenWithPreview={() => {
                setInspectSelection(true)
                setInspectorPane('tester')
              }}
              multiSelect={
                (tab === 'system' ? systemSelection.length : catalogSelection.length) > 1
                  ? tab === 'system'
                    ? {
                        names: systemSelection.map((group) => group.familyName),
                        summary: systemSummary,
                        systemPlan,
                        onInstall: () => void installSelected(),
                        onActivate: () => void activateSelected(),
                        onDeactivate: () => void deactivateSelected(),
                        onUninstall: () => void uninstallSelected(),
                        onUninstallAndRemove: () => void uninstallAndRemoveSelected(),
                        onReinstall: () => void reinstallSelected(),
                        onForget: () => void forgetSelected(),
                        onDeleteFiles: () => void deleteFilesSelected(),
                        onDeactivateSystem: () => void deactivateSelected(),
                        onUninstallSystem: () => void uninstallSelected(),
                      }
                    : {
                        names: catalogSelection.map((group) => group.familyName),
                        summary: catalogSummary,
                        catalogPlan,
                        onInstall: () => void installSelected(),
                        onActivate: () => void activateSelected(),
                        onDeactivate: () => void deactivateSelected(),
                        onUninstall: () => void uninstallSelected(),
                        onUninstallAndRemove: () => void uninstallAndRemoveSelected(),
                        onUninstallFromAdobe: () => void uninstallFromAdobeFor(catalogSelection),
                        onReinstall: () => void reinstallSelected(),
                        onRepair: () => void repairSelected(),
                        onForget: () => void forgetSelected(),
                        onDeleteFiles: () => void deleteFilesSelected(),
                        onDeactivateSystem: () => void deactivateSelected(),
                        onUninstallSystem: () => void uninstallSelected(),
                      }
                  : undefined
              }
            />
            </div>
          </div>
          )}
        </div>

        {dragging && (
          <div className="pointer-events-none fixed inset-3 z-40 flex items-center justify-center rounded-lg border border-dashed border-foreground/20 bg-background/80 md:left-[14.75rem]">
            <p className="text-base font-medium tracking-tight">
              {tab === 'library' && projectFilter
                ? `Drop fonts or folders to add them to ${
                    projects.find((item) => item.id === projectFilter)?.name ?? 'this project'
                  }`
                : 'Drop fonts or folders to add them'}
            </p>
          </div>
        )}
        <DropFolderDialog
          open={Boolean(folderDrop)}
          folders={folderDrop?.folders ?? []}
          onCancel={() => setFolderDrop(null)}
          onAddFonts={() => {
            const pending = folderDrop
            setFolderDrop(null)
            if (pending) void fontActionQueue.enqueue(() => importDropped(pending.paths, pending.files))
          }}
          onAddAsProject={() => {
            const pending = folderDrop
            setFolderDrop(null)
            if (!pending) return
            const paths = importPathsForProjectDrop(pending.paths, pending.folders)
            void fontActionQueue.enqueue(() =>
              importDropped(paths, pending.files, {
                newProjectName: droppedFolderProjectName(pending.folders),
              }),
            )
          }}
          onWatch={() => {
            const pending = folderDrop
            setFolderDrop(null)
            if (pending) void watchDroppedFolders(pending.folders, pending)
          }}
        />
        <FolderSetupDialog
          open={Boolean(folderSetupRoots)}
          roots={folderSetupRoots ?? undefined}
          onOpenChange={(next) => {
            if (!next) setFolderSetupRoots(null)
          }}
          onDone={(started) => {
            if (started[0]) selectLibrary(started[0].root)
            void api.settings().then((result) => applySettings(result.settings))
            void api.catalog().then((result) => setEntries(result.entries))
            toast.success(
              started.length === 1
                ? `Watching ${watchFolderName(started[0]!.root)}`
                : `Watching ${started.length} folders`,
            )
          }}
        />
        <ImportPlanDialog
          open={Boolean(importPlan)}
          plan={importPlan}
          onCancel={() => {
            importPlanResolve?.(null)
            setImportPlan(null)
            setImportPlanResolve(null)
          }}
          onConfirm={(choices, familyName) => {
            importPlanResolve?.({ choices, familyName })
            setImportPlan(null)
            setImportPlanResolve(null)
          }}
        />
        <DuplicatesDialog
          open={duplicatesOpen}
          warnings={duplicates}
          entries={entries}
          busy={busy}
          onClose={() => setDuplicatesOpen(false)}
          onResolve={(id, choice, familyName) => {
            void run(
              async () => {
                const result = await api.resolveDuplicate(id, choice, familyName)
                setDuplicates(result.duplicates)
                setEntries((await api.catalog()).entries)
              },
              {
                pending: 'Resolving duplicate…',
                done:
                  choice === 'skip'
                    ? 'Skipped duplicate'
                    : choice === 'replace'
                      ? 'Replaced active copy'
                      : choice === 'switch'
                        ? 'Switched active copy'
                        : choice === 'install-as'
                          ? `Installed as ${familyName ?? 'a different name'}`
                          : 'Added inactive copy',
              },
            )
          }}
        />
        <RelinkDialog
          open={Boolean(relinkEntry)}
          entry={relinkEntry}
          mode={relinkMode}
          onOpenChange={(next) => {
            if (!next) setRelinkEntry(null)
          }}
          onDone={(entry) => {
            setEntries((current) => current.map((item) => (item.id === entry.id ? entry : item)))
            void api.catalog().then((result) => setEntries(result.entries))
            toast.success(entry.updateHold === 'relink-review' ? 'Source linked · update available' : 'Source linked')
          }}
        />
        <FolderRelinkDialog
          open={Boolean(folderRelinkRoot)}
          oldRoot={folderRelinkRoot ?? ''}
          onOpenChange={(next) => {
            if (!next) setFolderRelinkRoot(null)
          }}
          onDone={() => {
            void api.catalog().then((result) => setEntries(result.entries))
            toast.success('Folder relinked')
          }}
        />
        <FormatDialog
          open={Boolean(formatPrompt)}
          formats={formatPrompt?.formats ?? []}
          confirmVerb={formatPrompt?.confirmVerb ?? 'Install'}
          onCancel={() => {
            formatPrompt?.resolve(null)
            setFormatPrompt(null)
          }}
          onConfirm={(format) => {
            formatPrompt?.resolve(format)
            setFormatPrompt(null)
          }}
        />
        <ReplaceFormatDialog
          open={Boolean(replacePrompt)}
          incomingFormat={replacePrompt?.incomingFormat ?? ''}
          existingFormat={replacePrompt?.existingFormat ?? ''}
          names={replacePrompt?.names ?? []}
          onCancel={() => {
            replacePrompt?.resolve(null)
            setReplacePrompt(null)
          }}
          onKeep={() => {
            replacePrompt?.resolve('keep')
            setReplacePrompt(null)
          }}
          onReplace={() => {
            replacePrompt?.resolve('replace')
            setReplacePrompt(null)
          }}
        />
        <RenameDialog
          entry={renameEntry}
          bakeFeatures={bakeRenameFeatures}
          open={Boolean(renameEntry)}
          onOpenChange={(open) => {
            if (!open) {
              setRenameEntry(null)
              setBakeRenameFeatures(null)
            }
          }}
          onDone={(entry) => {
            setSelectedFamily(familyNameOf(entry))
            setBakeRenameFeatures(null)
            void api.catalog().then((result) => setEntries(result.entries))
          }}
        />
        <OnboardingDialog
          open={onboardingOpen}
          settings={settings}
          onSettingsChange={applySettings}
          onRetailChange={setRetail}
          onComplete={() => setOnboardingOpen(false)}
        />
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={(open) => {
            setSettingsOpen(open)
            if (!open) {
              setSettingsFocusAppUpdate(false)
              setSettingsFocusWatchFolders(false)
            }
          }}
          settings={settings}
          onSettingsChange={applySettings}
          onDestinationsChange={applyAdobeAvailability}
          appUpdate={appUpdate}
          checkingAppUpdate={checkingAppUpdate}
          onCheckAppUpdate={(refresh) => void loadAppUpdate(refresh)}
          highlightAppUpdate={settingsFocusAppUpdate}
          highlightWatchFolders={settingsFocusWatchFolders}
          retail={retail}
          onRetailChange={setRetail}
          onRetailSync={() => void syncRetail()}
        />
        <RetailCollisionDialog
          open={syncCollisions.length > 0}
          mode="sync"
          collision={syncCollisions[0] ?? null}
          remaining={syncCollisions.length}
          busy={retailBusy}
          onDismiss={() => setSyncCollisions([])}
          onChoose={(action, applyToAll) => {
            const targets = applyToAll ? syncCollisions : syncCollisions.slice(0, 1)
            const choices: Record<string, RetailCollisionAction> = {}
            for (const item of targets) choices[item.familyName] = action
            void syncRetail(choices)
          }}
        />
        <RetailCollisionDialog
          open={Boolean(dropRetailPrompt?.remaining.length)}
          mode="drop"
          collision={dropRetailPrompt?.remaining[0] ?? null}
          remaining={dropRetailPrompt?.remaining.length ?? 0}
          onDismiss={() => {
            dropRetailPrompt?.resolve(null)
            setDropRetailPrompt(null)
          }}
          onChoose={(action, applyToAll) => {
            if (!dropRetailPrompt) return
            const assigned = applyToAll ? dropRetailPrompt.remaining : dropRetailPrompt.remaining.slice(0, 1)
            const choices = { ...dropRetailPrompt.choices }
            for (const item of assigned) choices[item.familyName] = action
            const leftover = applyToAll ? [] : dropRetailPrompt.remaining.slice(1)
            if (leftover.length === 0) {
              dropRetailPrompt.resolve(choices)
              setDropRetailPrompt(null)
              return
            }
            setDropRetailPrompt({ ...dropRetailPrompt, remaining: leftover, choices })
          }}
        />
        <MarqueeOverlay rect={marqueeRect} />
        <Toaster theme={settings?.theme ?? 'system'} />
      </div>
    </LatinPreviewProvider>
  )
}

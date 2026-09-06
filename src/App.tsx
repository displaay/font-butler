import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { toast } from 'sonner'
import { RefreshCw, X } from 'lucide-react'
import { ActivityView } from '@/components/ActivityView'
import {
  BatchActionBar,
  CatalogBatchButtons,
  SystemBatchButtons,
} from '@/components/BatchActions'
import { DropFolderDialog } from '@/components/DropFolderDialog'
import { DuplicatesDialog } from '@/components/DuplicatesDialog'
import { EmptyState } from '@/components/EmptyState'
import { FolderRelinkDialog } from '@/components/FolderRelinkDialog'
import { FolderSetupDialog } from '@/components/FolderSetupDialog'
import { FontFaceStyles } from '@/components/FontFaceStyles'
import { FormatDialog } from '@/components/FormatDialog'
import { ImportPlanDialog } from '@/components/ImportPlanDialog'
import { Inspector } from '@/components/Inspector'
import { LibraryCard } from '@/components/LibraryCard'
import { MarqueeOverlay } from '@/components/MarqueeOverlay'
import { OnboardingDialog } from '@/components/OnboardingDialog'
import { RelinkDialog } from '@/components/RelinkDialog'
import { RenameDialog } from '@/components/RenameDialog'
import { ReplaceFormatDialog } from '@/components/ReplaceFormatDialog'
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
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, isDuplicatesEvent, isNotice, isOperationsEvent, isProjectsEvent, isSettingsEvent, subscribeEvents } from '@/lib/api'
import { desktopPathForFile } from '@/lib/desktop'
import {
  collectDropPayload,
  commonDroppedFolder,
  importPathsForProjectDrop,
  partitionDropPayload,
  planPathsForImport,
} from '@/lib/drop'
import {
  conflictInstanceNames,
  countFormats,
  entryFormatOf,
  listFormatConflicts,
  type FormatCount,
} from '@/lib/formats'
import {
  activatableIds,
  adobeInstallableIds,
  deactivatableIds,
  installableIds,
  reinstallableIds,
  repairableIds,
  uninstallableIds,
} from '@/lib/eligibility'
import { canSwitchTo } from '@/lib/identity'
import { canCompareInstalledVsSource, isComparisonSourceStale } from '@/lib/comparison'
import {
  createSavedFilter,
  deleteSavedFilter,
  emptyLibraryCriteria,
  renameSavedFilter,
  savedFilterMatches,
} from '@/lib/savedFilters'
import { familyNameOf, catalogRevealEntry, countLibraryFilters, deletableSourceIds, entryHasTrackedSource, entryIds, familyStatusSummary, forgettableIds, groupCatalog, groupSystem, hasTrackedSource, isForgettableOnlyGroup, isUninstallableGroup, matchesLibraryFilter, matchesQuery, sortFamilyGroups, uniquePaths } from '@/lib/group'
import {
  LIBRARY_FILTERS_KEY,
  readLibraryFilters,
  readSortMode,
  shouldShowOnboarding,
} from '@/lib/preferences'
import { actionCopy, actionCopyFor, adobeInstallCopy, emptyImportError, importDoneCopy, remainingActionCopy } from '@/lib/notify'
import { planNeedsReview } from '@/lib/planner'
import { clearFontDragImage } from '@/lib/dragPreview'
import {
  defaultProjectName,
  hasFontButlerEntries,
  memberIdsForProjectImport,
  removeMemberIds,
  uniqueMemberIds,
} from '@/lib/projects'
import { batchResultCopy, type BatchOutcome } from '@/lib/results'
import { specimenFromSettings } from '@/lib/specimen'
import { needsLocateSource } from '@/lib/state'
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
  sameKeys,
  shortcutAction,
  type Rect,
} from '@/lib/selection'
import { applyTheme } from '@/lib/theme'
import { allUpdateGroups, updateGroupsForIds, visibleUpdateGroups } from '@/lib/updateInventory'
import type { AppSettings, CatalogEntry, ComparisonCapture, DuplicateWarning, FamilyGroup, ImportPlan, ImportPlanItem, LibraryFilter, Operation, PreviewPreferences, ProjectSet, SavedLibraryFilter, SortMode, SystemFace, SystemFamilyGroup, ViewLayout } from '@/lib/types'
import { cn } from '@/lib/utils'
import { isPathUnderFolder, isWatchFolderEntry, watchFolderName } from '@/lib/watchFolders'

const EMPTY_WATCH_FOLDERS: string[] = []

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
  const [comparisonCapture, setComparisonCapture] = useState<ComparisonCapture | null>(null)
  const [renameEntry, setRenameEntry] = useState<CatalogEntry | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const settingsRef = useRef<AppSettings | null>(null)
  const [watchFolderFilter, setWatchFolderFilter] = useState<string | null>(null)
  const [folderDrop, setFolderDrop] = useState<{
    folders: string[]
    paths: string[]
    files: File[]
  } | null>(null)
  const [formatPrompt, setFormatPrompt] = useState<{
    formats: FormatCount[]
    confirmVerb: 'Install' | 'Add'
    resolve: (format: string | null) => void
  } | null>(null)
  const [replacePrompt, setReplacePrompt] = useState<{
    incomingFormat: string
    existingFormat: string
    names: string[]
    resolve: (choice: 'replace' | 'keep' | null) => void
  } | null>(null)
  const [showSources, setShowSources] = useState(
    () => localStorage.getItem('font-butler-show-sources') === 'true',
  )
  const [viewLayout, setViewLayout] = useState<ViewLayout>(() =>
    localStorage.getItem('font-butler-view-layout') === 'grid' ? 'grid' : 'list',
  )
  const [sortMode, setSortMode] = useState<SortMode>(readSortMode)
  const [selectedFamilyKeys, setSelectedFamilyKeys] = useState<string[]>([])
  const [selectedSystemKeys, setSelectedSystemKeys] = useState<string[]>([])
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)
  const [inspectSelection, setInspectSelection] = useState(false)
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
          setProjects(projectResult.projects)
          setOperations(activityResult.operations)
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
              if (match.previewOnly) setInspectSelection(true)
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
      if (isOperationsEvent(event)) {
        setOperations(event.operations)
        return
      }
      if (event && typeof event === 'object' && (event as { type?: string }).type === 'catalog') {
        setEntries((event as { entries: CatalogEntry[] }).entries)
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
    const stopDesktop = window.fontButlerDesktop?.onOpenSettings(() => setSettingsOpen(true))
    const stopReinstall = window.fontButlerDesktop?.onReinstallFonts?.((payload) => {
      const ids = Array.isArray(payload?.ids)
        ? payload.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
      reinstallFromMenuBarRef.current(ids)
    })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      stopDesktop?.()
      stopReinstall?.()
    }
  }, [])

  const watchFolders = settings?.watchFolders ?? EMPTY_WATCH_FOLDERS
  const projectMemberIds = useMemo(() => {
    const project = projects.find((item) => item.id === projectFilter)
    return new Set(project?.members.map((member) => member.assetId) ?? [])
  }, [projects, projectFilter])
  const librarySourceEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (watchFolderFilter && !isWatchFolderEntry(entry, watchFolderFilter)) return false
        if (projectFilter && !projectMemberIds.has(entry.id)) return false
        return true
      }),
    [entries, watchFolderFilter, projectFilter, projectMemberIds],
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
      counts[folder] = groupCatalog(
        entries.filter((entry) => isWatchFolderEntry(entry, folder)),
      ).length
    }
    return counts
  }, [entries, watchFolders])
  const allUpdates = useMemo(() => allUpdateGroups(entries, sortMode), [entries, sortMode])
  const updateGroups = useMemo(() => visibleUpdateGroups(allUpdates, query), [allUpdates, query])
  const systemGroups = useMemo(
    () => groupSystem(systemFaces).filter((group) => matchesQuery(group.familyName, query)),
    [systemFaces, query],
  )
  const shownSystemGroups = useMemo(
    () => (query.trim() ? systemGroups : systemGroups.slice(0, 80)),
    [query, systemGroups],
  )
  const missingSourceCount = useMemo(
    () => entries.filter((entry) => entry.status === 'source-missing').length,
    [entries],
  )
  const tabCounts = useMemo(
    () => ({
      library: groupCatalog(entries).length,
      system: groupSystem(systemFaces).length,
      updates: groupCatalog(entries.filter((entry) => entry.status === 'outdated')).length,
      activity: operations.length,
    }),
    [entries, systemFaces, operations.length],
  )

  const visibleGroups = useMemo(
    () =>
      tab === 'system' || tab === 'activity' ? [] : tab === 'updates' ? updateGroups : libraryGroups,
    [tab, updateGroups, libraryGroups],
  )
  const hasCatalogList =
    tab === 'system'
      ? shownSystemGroups.length > 0
      : tab === 'activity'
        ? operations.length > 0
        : tab === 'library'
          ? libraryGroupsUnfiltered.length > 0
          : allUpdates.length > 0
  const selectedGroup =
    selectedFamily && selectedFamilyKeys.includes(selectedFamily)
      ? (visibleGroups.find((group) => group.familyName === selectedFamily) ?? null)
      : null
  const selectedEntry =
    selectedGroup?.entries.find((entry) => entry.id === selectedEntryId) ??
    selectedGroup?.entries[0] ??
    null
  const comparisonInstallBlocked = Boolean(
    canCompareInstalledVsSource(selectedEntry) &&
      (comparisonCapture?.id !== selectedEntry?.id ||
        isComparisonSourceStale(comparisonCapture, selectedEntry?.sourceFingerprint)),
  )
  const selectedSystemGroup =
    tab === 'system' && selectedSystem && selectedSystemKeys.includes(selectedSystem)
      ? (shownSystemGroups.find((group) => group.familyName === selectedSystem) ?? null)
      : null

  useEffect(() => {
    if (tab === 'updates' && allUpdates.length === 0) {
      setTab('library')
    }
  }, [tab, allUpdates.length])

  useEffect(() => {
    if (watchFolderFilter && !watchFolders.includes(watchFolderFilter)) {
      setWatchFolderFilter(null)
    }
  }, [watchFolderFilter, watchFolders])

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
  }

  function handleCatalogSelect(group: FamilyGroup, event: MouseEvent) {
    if (suppressClickRef.current) return
    if (event.detail > 1) return
    const current = selectedFamilyKeys
    const range = event.shiftKey
    const toggle = event.metaKey || event.ctrlKey
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
    setInspectSelection(false)
  }

  function inspectSystemGroup(group: SystemFamilyGroup) {
    setSelectedSystem(group.familyName)
    setSelectedSystemKeys([group.familyName])
    setSelectionAnchor(group.familyName)
    setInspectSelection(true)
  }

  function handleSystemSelect(group: SystemFamilyGroup, event: MouseEvent) {
    if (suppressClickRef.current) return
    if (event.detail > 1) return
    const current = selectedSystemKeys
    const range = event.shiftKey
    const toggle = event.metaKey || event.ctrlKey
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
    setInspectSelection(false)
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
  const catalogPlan = catalogBatchPlan(catalogSelection)
  const systemPlan = systemBatchPlan(systemSelection)
  const catalogSummary = catalogBatchSummary(catalogSelection)
  const systemSummary = systemBatchSummary(systemSelection)
  const selectionCount = tab === 'system' ? systemSelection.length : catalogSelection.length
  const showInspector = selectionCount === 1 && inspectSelection
  const showBatchBar = selectionCount > 1 || (selectionCount === 1 && !inspectSelection)

  function clearSelection() {
    setSelectedFamily(null)
    setSelectedFamilyKeys([])
    setSelectedEntryId(null)
    setSelectedSystem(null)
    setSelectedSystemKeys([])
    setSelectionAnchor(null)
    setInspectSelection(false)
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
    const onUp = (up: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('scroll', onScroll, true)
      const session = marqueeRef.current
      marqueeRef.current = null
      setMarqueeRect(null)
      if (!session?.active) {
        if (!clickPreservesSelection(up.target)) clearSelection()
        return
      }
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('scroll', onScroll, true)
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

  function askFormat(formats: FormatCount[], confirmVerb: 'Install' | 'Add'): Promise<string | null> {
    return new Promise((resolve) => {
      setFormatPrompt({ formats, confirmVerb, resolve })
    })
  }

  function askReplace(conflicts: ReturnType<typeof listFormatConflicts>): Promise<'replace' | 'keep' | null> {
    const incomingFormat = entryFormatOf(conflicts[0].incoming)
    const existingFormat = entryFormatOf(conflicts[0].existing)
    return new Promise((resolve) => {
      setReplacePrompt({
        incomingFormat,
        existingFormat,
        names: conflictInstanceNames(conflicts),
        resolve,
      })
    })
  }

  async function prepareInstall(
    ids: string[],
    catalog = entries,
    confirmVerb: 'Install' | 'Add' = 'Install',
  ): Promise<{ ids: string[]; replace: boolean } | null> {
    const incoming = ids
      .map((id) => catalog.find((entry) => entry.id === id))
      .filter((entry): entry is CatalogEntry => Boolean(entry))
    if (incoming.length === 0) return null
    const formats = countFormats(incoming.map((entry) => entryFormatOf(entry)))
    let chosen = incoming
    if (formats.length > 1) {
      const format = await askFormat(formats, confirmVerb)
      if (!format) return null
      chosen = incoming.filter((entry) => entryFormatOf(entry) === format)
    }
    if (chosen.length === 0) return null
    const conflicts = listFormatConflicts(chosen, catalog)
    if (conflicts.length === 0) {
      return { ids: chosen.map((entry) => entry.id), replace: false }
    }
    const choice = await askReplace(conflicts)
    if (choice === null) return null
    if (choice === 'keep') {
      const skip = new Set(conflicts.map((item) => item.incoming.id))
      const rest = chosen.filter((entry) => !skip.has(entry.id))
      if (rest.length === 0) return null
      return { ids: rest.map((entry) => entry.id), replace: false }
    }
    return { ids: chosen.map((entry) => entry.id), replace: true }
  }

  function comparisonFingerprintFor(ids: string[]): string | undefined {
    if (ids.length !== 1) return undefined
    if (comparisonCapture?.id !== ids[0]) return undefined
    return comparisonCapture.sourceFingerprint
  }

  function installPrepared(ids: string[], familyName?: string, replace?: boolean) {
    const expectedSourceFingerprint = comparisonFingerprintFor(ids)
    return ids.length > 1
      ? api.installMany(ids, familyName, { replace, expectedSourceFingerprint })
      : api.install(ids[0], familyName, { replace, expectedSourceFingerprint })
  }

  function activatePrepared(ids: string[], replace?: boolean) {
    const needsSwitch = ids.some((id) => {
      const entry = entries.find((item) => item.id === id)
      return entry ? canSwitchTo(entry, entries) : false
    })
    const options = { replace, switch: needsSwitch }
    return ids.length > 1 ? api.activateMany(ids, options) : api.activate(ids[0], options)
  }

  function uninstallGroup(group: FamilyGroup, options?: { deleteSource?: boolean }) {
    const ids = uninstallableIds(group)
    if (ids.length === 0) return Promise.resolve({ entries: [] })
    return ids.length > 1 ? api.uninstallMany(ids, options) : api.uninstall(ids[0], options)
  }

  function deactivateGroup(group: FamilyGroup) {
    const ids = deactivatableIds(group)
    if (ids.length === 0) return Promise.resolve({ entries: [] })
    return ids.length > 1 ? api.deactivateMany(ids) : api.deactivate(ids[0])
  }

  function reinstallGroup(group: FamilyGroup) {
    const ids = reinstallableIds(group)
    if (ids.length === 0) return Promise.resolve({ entries: [] })
    const expectedSourceFingerprint = comparisonFingerprintFor(ids)
    return ids.length > 1
      ? api.reinstallMany(ids, { expectedSourceFingerprint })
      : api.reinstall(ids[0], { expectedSourceFingerprint })
  }

  function forgetGroup(group: FamilyGroup, options?: { deleteFiles?: boolean }) {
    const ids = options?.deleteFiles ? deletableSourceIds(group) : forgettableIds(group)
    if (ids.length === 0) {
      return Promise.resolve({ removed: 0 })
    }
    return ids.length > 1 ? api.forgetMany(ids, options) : api.forget(ids[0], options)
  }

  function forgetEntry(entry: CatalogEntry, options?: { deleteFiles?: boolean }) {
    return api.forget(entry.id, options)
  }

  async function removeSelected() {
    if (tab === 'system') {
      const groups = selectedSystemList().filter((group) => group.writable)
      if (groups.length === 0) return
      await run(async () => {
        for (const group of groups) {
          for (const face of uniquePaths(group.faces)) {
            await api.uninstallSystem(face)
          }
        }
        setSystemFaces((await api.system()).faces)
      }, actionCopyFor('remove', groups))
      return
    }
    const groups = selectedCatalogGroups()
    const toUninstall = groups.filter(isUninstallableGroup)
    const toForget = groups.filter(isForgettableOnlyGroup)
    if (toUninstall.length === 0 && toForget.length === 0) return
    const copyGroups = [...toUninstall, ...toForget]
    const verb = toUninstall.length === 0 ? 'forget' : 'remove'
    await run(async () => {
      for (const group of toUninstall) {
        await uninstallGroup(group)
      }
      for (const group of toForget) {
        await forgetGroup(group)
      }
    }, actionCopyFor(verb, copyGroups))
  }

  async function installSelected() {
    const groups = selectedCatalogGroups().filter((group) => installableIds(group).length > 0)
    if (groups.length === 0) return
    const prepared = await prepareInstall(groups.flatMap(installableIds))
    if (!prepared) return
    const allowed = new Set(prepared.ids)
    await run(async () => {
      for (let index = 0; index < groups.length; index += 1) {
        const ids = installableIds(groups[index]).filter((id) => allowed.has(id))
        if (ids.length === 0) continue
        setActionStatus(
          remainingActionCopy(
            'install',
            groups.length - index,
            groups.length === 1 ? groups[0].familyName : undefined,
          ),
        )
        await installPrepared(ids, undefined, prepared.replace)
      }
    }, actionCopyFor('install', groups))
  }

  async function activateSelected() {
    const groups = selectedCatalogGroups().filter((group) => activatableIds(group).length > 0)
    if (groups.length === 0) return
    const prepared = await prepareInstall(groups.flatMap(activatableIds))
    if (!prepared) return
    const allowed = new Set(prepared.ids)
    await run(async () => {
      for (const group of groups) {
        const ids = activatableIds(group).filter((id) => allowed.has(id))
        if (ids.length === 0) continue
        await activatePrepared(ids, prepared.replace)
      }
    }, actionCopyFor('activate', groups))
  }

  async function installOrActivateSelected() {
    const groups = selectedCatalogGroups().filter(
      (group) => installableIds(group).length > 0 || activatableIds(group).length > 0,
    )
    if (groups.length === 0) return
    const verb = groups.every((group) => activatableIds(group).length > 0 && installableIds(group).length === 0)
      ? 'activate'
      : 'install'
    const prepared = await prepareInstall(groups.flatMap((group) => [...installableIds(group), ...activatableIds(group)]))
    if (!prepared) return
    const allowed = new Set(prepared.ids)
    await run(async () => {
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index]
        const toActivate = activatableIds(group).filter((id) => allowed.has(id))
        const toInstall = installableIds(group).filter((id) => allowed.has(id))
        if (toActivate.length === 0 && toInstall.length === 0) continue
        setActionStatus(
          remainingActionCopy(
            verb,
            groups.length - index,
            groups.length === 1 ? groups[0].familyName : undefined,
          ),
        )
        if (toActivate.length) await activatePrepared(toActivate, prepared.replace)
        if (toInstall.length) await installPrepared(toInstall, undefined, prepared.replace)
      }
    }, actionCopyFor(verb, groups))
  }

  async function installGroupGuarded(group: FamilyGroup, familyName?: string) {
    const prepared = await prepareInstall(installableIds(group).length ? installableIds(group) : entryIds(group))
    if (!prepared) return
    await run(
      () => installPrepared(prepared.ids, familyName, prepared.replace),
      actionCopy('install', group.familyName),
    )
  }

  async function installToAdobeFor(groups: FamilyGroup[]) {
    const ids = groups.flatMap(adobeInstallableIds)
    if (ids.length === 0) return
    await run(async () => {
      for (const id of ids) {
        await api.install(id, undefined, { destinationId: 'adobe-shared' })
      }
    }, adobeInstallCopy(ids.length))
  }

  async function activateGroupGuarded(group: FamilyGroup) {
    const prepared = await prepareInstall(activatableIds(group).length ? activatableIds(group) : entryIds(group))
    if (!prepared) return
    await run(
      () => activatePrepared(prepared.ids, prepared.replace),
      actionCopy('activate', group.familyName),
    )
  }

  async function reinstallSelected() {
    const groups = selectedCatalogGroups().filter((group) => reinstallableIds(group).length > 0)
    if (groups.length === 0) return
    await run(async () => {
      for (const group of groups) {
        await reinstallGroup(group)
      }
    }, actionCopyFor('reinstall', groups))
  }

  async function repairSelected() {
    const groups = selectedCatalogGroups()
    const ids = groups.flatMap(repairableIds)
    if (ids.length === 0) return
    await run(() => api.repair(ids, false), {
      pending: 'Repairing fonts…',
      done: 'Repaired installed versions',
    })
  }

  async function createProjectWith(ids: string[], familyNames: string[]) {
    try {
      const result = await api.createProject(defaultProjectName(familyNames), ids)
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

  async function reinstallAllUpdates() {
    const groups = allUpdates
    if (groups.length === 0) return
    await run(async () => {
      for (const group of groups) {
        await reinstallGroup(group)
      }
    }, actionCopyFor('reinstall', groups))
  }

  function reinstallFromMenuBar(ids: string[]) {
    if (busyRef.current) {
      toast.message('Wait for the current action to finish.')
      return
    }
    const groups = updateGroupsForIds(allUpdates, ids)
    if (groups.length === 0) {
      const leftover = ids.filter((id) => entries.some((entry) => entry.id === id && entry.status === 'outdated'))
      if (leftover.length === 0) {
        toast.message('No font updates to reinstall.')
        return
      }
      setTab('updates')
      setWatchFolderFilter(null)
      void run(() => (leftover.length > 1 ? api.reinstallMany(leftover) : api.reinstall(leftover[0])), {
        pending: 'Reinstalling fonts…',
        done: 'Reinstalled fonts',
      })
      return
    }
    setTab('updates')
    setWatchFolderFilter(null)
    void run(async () => {
      for (const group of groups) {
        await reinstallGroup(group)
      }
    }, actionCopyFor('reinstall', groups))
  }
  reinstallFromMenuBarRef.current = reinstallFromMenuBar

  async function forgetSelected() {
    const groups = selectedCatalogGroups().filter((group) => forgettableIds(group).length > 0)
    if (groups.length === 0) return
    await run(async () => {
      for (const group of groups) {
        await forgetGroup(group)
      }
    }, actionCopyFor('forget', groups))
  }

  async function deleteFilesFor(groups: FamilyGroup[]) {
    const targets = groups.filter((group) => deletableSourceIds(group).length > 0)
    if (targets.length === 0) return
    const fileCount = targets.reduce((sum, group) => sum + deletableSourceIds(group).length, 0)
    const confirmed = window.confirm(
      fileCount === 1
        ? `Delete the source file for ${targets[0].familyName}? It will be moved to Trash.`
        : `Delete ${fileCount} source files? They will be moved to Trash.`,
    )
    if (!confirmed) return
    await run(async () => {
      for (const group of targets) {
        await forgetGroup(group, { deleteFiles: true })
      }
    }, actionCopyFor('deleteFiles', targets))
  }

  async function deleteFilesSelected() {
    await deleteFilesFor(selectedCatalogGroups())
  }

  async function uninstallAndRemoveFor(groups: FamilyGroup[]) {
    const targets = groups.filter(
      (group) => isUninstallableGroup(group) && hasTrackedSource(group),
    )
    if (targets.length === 0) return
    const fileCount = targets.reduce(
      (sum, group) => sum + group.entries.filter(entryHasTrackedSource).length,
      0,
    )
    const confirmed = window.confirm(
      fileCount === 1
        ? `Uninstall ${targets[0].familyName} and move its source file to Trash?`
        : `Uninstall ${targets.length} fonts and move ${fileCount} source files to Trash?`,
    )
    if (!confirmed) return
    await run(async () => {
      for (const group of targets) {
        await uninstallGroup(group, { deleteSource: true })
      }
    }, actionCopyFor('uninstallAndRemove', targets))
  }

  async function uninstallAndRemoveSelected() {
    await uninstallAndRemoveFor(selectedCatalogGroups())
  }

  async function uninstallSelected() {
    if (tab === 'system') {
      await removeSelected()
      return
    }
    const groups = selectedCatalogGroups().filter(
      (group) =>
        group.status === 'installed' ||
        group.status === 'outdated' ||
        group.status === 'deactivated',
    )
    if (groups.length === 0) return
    await run(async () => {
      for (const group of groups) {
        await uninstallGroup(group)
      }
    }, actionCopyFor('remove', groups))
  }

  async function deactivateSelected() {
    if (tab === 'system') {
      const groups = selectedSystemList().filter((group) => group.writable)
      if (groups.length === 0) return
      await run(async () => {
        for (const group of groups) {
          for (const face of uniquePaths(group.faces)) {
            await api.deactivateSystem(face)
          }
        }
        setSystemFaces((await api.system()).faces)
      }, actionCopyFor('deactivate', groups))
      return
    }
    const groups = selectedCatalogGroups().filter((group) => deactivatableIds(group).length > 0)
    if (groups.length === 0) return
    await run(async () => {
      for (const group of groups) {
        await deactivateGroup(group)
      }
    }, actionCopyFor('deactivate', groups))
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (busy || renameEntry) return
      if (document.querySelector('[role="dialog"]')) return
      const action = shortcutAction(event)
      if (!action) return
      event.preventDefault()
      if (action === 'remove') void removeSelected()
      if (action === 'install') void installOrActivateSelected()
      if (action === 'deactivate') void deactivateSelected()
      if (action === 'selectAll') selectAllVisible()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function showActivityToast(message: string, failedIds: string[] = [], operationId?: string) {
    toast.success(message, {
      action: {
        label: failedIds.length ? 'Retry failed' : 'Activity',
        onClick: () => {
          if (failedIds.length) {
            void retryFailed(failedIds)
            return
          }
          setHighlightOperation(operationId ?? null)
          setTab('activity')
        },
      },
    })
  }

  async function retryFailed(ids: string[]) {
    const current = entries.filter((entry) => ids.includes(entry.id))
    const toUpdate = current.filter((entry) => entry.status === 'outdated' && !entry.previewOnly)
    const toInstall = current.filter((entry) => entry.status === 'uninstalled' && !entry.previewOnly)
    if (toUpdate.length === 0 && toInstall.length === 0) {
      toast.message('Those items are no longer eligible to retry.')
      return
    }
    await run(async () => {
      if (toUpdate.length) {
        await (toUpdate.length > 1 ? api.reinstallMany(toUpdate.map((entry) => entry.id)) : api.reinstall(toUpdate[0]!.id))
      }
      if (toInstall.length) {
        await installPrepared(toInstall.map((entry) => entry.id))
      }
    }, { pending: 'Retrying failed items…', done: 'Retried failed items' })
  }

  async function run(
    action: () => Promise<unknown>,
    copy: { pending: string; done: string },
  ) {
    busyRef.current = true
    setBusy(true)
    setActionStatus(copy.pending)
    try {
      const result = await action()
      setActionStatus(null)
      const outcome = result && typeof result === 'object' ? (result as BatchOutcome) : undefined
      const { message, failedIds } = batchResultCopy(copy.done, outcome)
      showActivityToast(message, failedIds, (result as { operationId?: string } | undefined)?.operationId)
      const catalog = await api.catalog()
      setEntries(catalog.entries)
      const activity = await api.activity().catch(() => ({ operations }))
      setOperations(activity.operations)
    } catch (err) {
      setActionStatus(null)
      toast.error(err instanceof Error ? err.message : 'Something went wrong', {
        action: {
          label: 'Activity',
          onClick: () => setTab('activity'),
        },
      })
      try {
        const catalog = await api.catalog()
        setEntries(catalog.entries)
      } catch {
        // Keep the last known catalog if the refresh fails.
      }
    } finally {
      busyRef.current = false
      setBusy(false)
      setActionStatus(null)
    }
  }

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
    showActivityToast(
      importDoneCopy({
        installed: result.succeeded > 0 && preview < result.succeeded,
        count: result.entries.length,
        name: familyNameOf(result.entries[0]),
        preview,
      }),
      result.failedIds,
      result.operationId,
    )
    if (result.errors.length) toast.error(result.errors.join('\n'))
    return result
  }

  async function importDropped(paths: string[], files: File[], projectId?: string) {
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
        if (planNeedsReview(plan)) {
          setActionStatus(null)
          const decision = await askImportPlan(plan)
          if (!decision) return
          setActionStatus('Adding fonts…')
          imported = (await applyImportPlan(plan, decision.choices, decision.familyName)).entries
        } else if (!projectId || plan.items.some((item) => item.defaultChoice !== 'skip')) {
          setActionStatus('Adding fonts…')
          imported = (await applyImportPlan(plan)).entries
        }
        if (projectId) {
          const ids = memberIdsForProjectImport(plan, imported)
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
      if (projectId) {
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
          systemFaces={tab === 'system' ? shownSystemGroups.flatMap((group) => group.faces) : []}
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
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <section
            className={cn('flex min-h-0 min-w-0 flex-1 flex-col', marqueeRect && 'select-none')}
            onPointerDown={handleListPointerDown}
          >
            {!loading && hasCatalogList && (
              <div className="relative shrink-0 space-y-3 bg-background px-4 pt-4 pb-3">
                {tabCounts.updates > 0 && tab !== 'updates' ? (
                  <Button
                    type="button"
                    size="sm"
                    className="app-region-no-drag absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full border-0 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
                    onClick={() => {
                      setTab('updates')
                      setWatchFolderFilter(null)
                    }}
                  >
                    <RefreshCw />
                    {tabCounts.updates === 1
                      ? 'Font update available'
                      : `${tabCounts.updates} font updates available`}
                  </Button>
                ) : tab === 'updates' && updateGroups.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    className="app-region-no-drag absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full border-0 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
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
              <div className={cn('flex min-h-full flex-col p-4', showBatchBar && 'pb-24')}>
                {loading && (
                  <p className="px-2 py-12 text-center text-sm text-muted-foreground">
                    Reading fonts…
                  </p>
                )}
                {error && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
                )}
                {!loading && tab === 'activity' && (
                  <ActivityView
                    operations={operations}
                    highlightId={highlightOperation}
                    onUndo={(id) =>
                      void run(() => api.undo(id), { pending: 'Undoing…', done: 'Undid the last change' })
                    }
                  />
                )}
                {!loading && tab !== 'system' && tab !== 'activity' && visibleGroups.length === 0 && (
                  tab === 'library' && libraryGroupsUnfiltered.length > 0 && libraryFilters.length > 0 ? (
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
                          ? watchFolderName(watchFolderFilter)
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
                    No fonts found in the system folders.
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
                  className={cn(viewLayout === 'grid' ? 'grid' : 'grid gap-2')}
                  style={
                    viewLayout === 'grid'
                      ? {
                          gridTemplateColumns: `repeat(auto-fill, minmax(${gridCardMinWidthRem(gridPreviewSize)}rem, 1fr))`,
                          gap: `${Math.max(0.5, gridPreviewSize * 0.18)}rem`,
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
                          onEnsureSelected={() => {
                            if (!inSelection) {
                              setSelectedSystem(group.familyName)
                              setSelectedSystemKeys([group.familyName])
                              setSelectionAnchor(group.familyName)
                            }
                            setInspectSelection(false)
                          }}
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
                          onInstallAs={() => setRenameEntry(selectedEntry ?? group.entries[0])}
                          onInstallToAdobe={() =>
                            useBatch
                              ? void installToAdobeFor(catalogSelection)
                              : void installToAdobeFor([group])
                          }
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
                              : void run(() => uninstallGroup(group), actionCopy('remove', group.familyName))
                          }
                          onUninstallAndRemove={() => {
                            if (useBatch) {
                              void uninstallAndRemoveSelected()
                              return
                            }
                            void uninstallAndRemoveFor([group])
                          }}
                          onDeactivate={() =>
                            useBatch
                              ? void deactivateSelected()
                              : void run(() => deactivateGroup(group), actionCopy('deactivate', group.familyName))
                          }
                          onActivate={() =>
                            useBatch ? void activateSelected() : void activateGroupGuarded(group)
                          }
                          onSwitch={
                            group.entries.some((entry) => canSwitchTo(entry, entries))
                              ? () => {
                                  const target =
                                    group.entries.find(
                                      (entry) => entry.id === selectedEntryId && canSwitchTo(entry, entries),
                                    ) ?? group.entries.find((entry) => canSwitchTo(entry, entries))
                                  if (!target) return
                                  void run(
                                    () => api.switchTo(target.id),
                                    { pending: 'Switching…', done: 'Switched active copy' },
                                  )
                                }
                              : undefined
                          }
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
          {showBatchBar && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-4">
              <div className="pointer-events-auto w-full max-w-3xl">
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
                      onReinstall={() => void reinstallSelected()}
                      onRepair={() => void repairSelected()}
                      onForget={() => void forgetSelected()}
                      onDeleteFiles={() => void deleteFilesSelected()}
                    />
                  </BatchActionBar>
                )}
              </div>
            </div>
          )}
          {showInspector && (
          <div
            data-keep-selection=""
            className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l bg-background shadow-xl md:w-96"
          >
            <div className="flex shrink-0 justify-end px-2 pt-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 px-0"
                aria-label="Close details"
                onClick={clearSelection}
              >
                <X />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
            <Inspector
              group={tab === 'system' ? null : selectedGroup}
              entry={tab === 'system' ? null : selectedEntry}
              statusSummary={selectedGroup ? familyStatusSummary(selectedGroup) : null}
              selectedEntryId={selectedEntryId}
              onSelectEntry={setSelectedEntryId}
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
              comparisonInstallBlocked={comparisonInstallBlocked}
              onComparisonCapture={setComparisonCapture}
              onInstall={() => selectedGroup && void installGroupGuarded(selectedGroup)}
              onInstallAs={() => setRenameEntry(selectedEntry)}
              onReinstall={() =>
                selectedGroup &&
                void run(() => reinstallGroup(selectedGroup), actionCopy('reinstall', selectedGroup.familyName))
              }
              onRepair={() => void repairSelected()}
              onUninstall={() =>
                selectedGroup &&
                void run(() => uninstallGroup(selectedGroup), actionCopy('remove', selectedGroup.familyName))
              }
              onUninstallAndRemove={() => {
                if (!selectedGroup) return
                void uninstallAndRemoveFor([selectedGroup])
              }}
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
                selectedEntry &&
                void run(
                  () => api.install(selectedEntry.id, undefined, { destinationId: 'adobe-shared' }),
                  adobeInstallCopy(1),
                )
              }
              onRemoveAdobeCopy={() =>
                selectedEntry &&
                void run(() => api.removeDestinationCopy(selectedEntry.id, 'adobe-shared'), {
                  pending: 'Removing Adobe testing copy…',
                  done: 'Removed Adobe testing copy',
                })
              }
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
              onOpenWithPreview={() => setInspectSelection(true)}
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
            if (pending) void importDropped(pending.paths, pending.files)
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
          open={Boolean(renameEntry)}
          onOpenChange={(open) => {
            if (!open) setRenameEntry(null)
          }}
          onDone={(entry) => {
            setSelectedFamily(familyNameOf(entry))
            void api.catalog().then((result) => setEntries(result.entries))
          }}
        />
        <OnboardingDialog
          open={onboardingOpen}
          settings={settings}
          onSettingsChange={applySettings}
          onComplete={() => setOnboardingOpen(false)}
        />
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onSettingsChange={applySettings}
        />
        <MarqueeOverlay rect={marqueeRect} />
        <Toaster theme={settings?.theme ?? 'system'} />
      </div>
  )
}

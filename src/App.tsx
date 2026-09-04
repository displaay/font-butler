import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { toast } from 'sonner'
import { ChevronDown, FolderOpen, X } from 'lucide-react'
import { AaPreview, CyclingAaPreview } from '@/components/AaPreview'
import { StatusBadge, VfBadge } from '@/components/Badges'
import {
  BatchActionBar,
  CatalogBatchButtons,
  CatalogMenuItems,
  SystemBatchButtons,
  SystemMenuItems,
} from '@/components/BatchActions'
import { CatalogCardActions, SystemCardActions } from '@/components/FontCardActions'
import { FontFaceStyles, catalogFontFamily, systemFontFamily } from '@/components/FontFaceStyles'
import { InstanceList } from '@/components/InstanceList'
import { Inspector } from '@/components/Inspector'
import { DropFolderDialog } from '@/components/DropFolderDialog'
import { RenameDialog } from '@/components/RenameDialog'
import { SettingsDialog } from '@/components/SettingsDialog'
import { Sidebar, type Tab } from '@/components/Sidebar'
import {
  GRID_PREVIEW_SIZE_KEY,
  ViewOptions,
  readGridPreviewSize,
  type ViewLayout,
} from '@/components/ViewOptions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { NotifyProvider, useSetActionStatus } from '@/components/NotifyProvider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, isNotice, isSettingsEvent, subscribeEvents } from '@/lib/api'
import { collectDropPayload, isDroppedFontName, isWebOnlyDrop, partitionDropPayload } from '@/lib/drop'
import { WOFF_INSTALL_ERROR } from '@/lib/formats'
import { familyNameOf, deletableSourceIds, entryIds, familyStatusSummary, forgettableIds, groupCatalog, groupSystem, hasSourceMissing, isForgettableOnlyGroup, isLibraryEntry, isUninstallableGroup, matchesQuery, sortFamilyGroups } from '@/lib/group'
import { actionCopy, actionCopyFor, emptyImportError, importDoneCopy, remainingActionCopy } from '@/lib/notify'
import { catalogInstanceRows, systemInstanceRows } from '@/lib/instances'
import {
  catalogBatchPlan,
  catalogBatchSummary,
  systemBatchPlan,
  systemBatchSummary,
  type CatalogBatchPlan,
  type SystemBatchPlan,
} from '@/lib/batch'
import {
  canStartMarquee,
  clientRect,
  keysInMarquee,
  mergeMarqueeSelection,
  nextSelection,
  shortcutAction,
  type Rect,
} from '@/lib/selection'
import { applyTheme } from '@/lib/theme'
import type { AppSettings, CatalogEntry, FamilyGroup, SortMode, SystemFace, SystemFamilyGroup } from '@/lib/types'
import { cn } from '@/lib/utils'
import { isPathUnderFolder, mergeWatchFolders, watchFolderName } from '@/lib/watchFolders'

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
  const [renameEntry, setRenameEntry] = useState<CatalogEntry | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const settingsRef = useRef<AppSettings | null>(null)
  const [watchFolderFilter, setWatchFolderFilter] = useState<string | null>(null)
  const [folderDrop, setFolderDrop] = useState<{
    folders: string[]
    paths: string[]
    files: File[]
  } | null>(null)
  const [showSources, setShowSources] = useState(
    () => localStorage.getItem('font-butler-show-sources') === 'true',
  )
  const [viewLayout, setViewLayout] = useState<ViewLayout>(() =>
    localStorage.getItem('font-butler-view-layout') === 'grid' ? 'grid' : 'list',
  )
  const [sortMode, setSortMode] = useState<SortMode>(() =>
    localStorage.getItem('font-butler-sort') === 'installed' ? 'installed' : 'name',
  )
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
  const applyMarqueeKeysRef = useRef<(keys: string[]) => void>(() => {})
  const [scrollToFamily, setScrollToFamily] = useState<string | null>(null)
  const [hideDeactivated, setHideDeactivated] = useState(
    () => localStorage.getItem('font-butler-hide-deactivated') === 'true',
  )
  const [gridPreviewSize, setGridPreviewSize] = useState(readGridPreviewSize)

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
        const [catalog, settingsResult] = await Promise.all([api.catalog(), api.settings()])
        if (!cancelled) {
          applySettings(settingsResult.settings)
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
          toast[event.notice.kind === 'error' ? 'error' : 'success'](event.notice.message)
        }
        if (event.notice.entryId) {
          setEntries((current) => {
            const match = current.find((entry) => entry.id === event.notice.entryId)
            if (match) setSelectedFamily(familyNameOf(match))
            return current
          })
        }
        return
      }
      if (isSettingsEvent(event)) {
        applySettings(event.settings)
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
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      stopDesktop?.()
    }
  }, [])

  const watchFolders = settings?.watchFolders ?? EMPTY_WATCH_FOLDERS
  const librarySourceEntries = useMemo(
    () =>
      entries
        .filter(isLibraryEntry)
        .filter((entry) => !watchFolderFilter || isPathUnderFolder(entry.sourcePath, watchFolderFilter)),
    [entries, watchFolderFilter],
  )
  const libraryGroups = useMemo(
    () =>
      sortFamilyGroups(
        groupCatalog(
          librarySourceEntries.filter((entry) => !hideDeactivated || entry.status !== 'deactivated'),
        ).filter((group) =>
          matchesQuery(`${group.familyName} ${group.faces.map((face) => face.styleName).join(' ')}`, query),
        ),
        sortMode,
      ),
    [librarySourceEntries, query, sortMode, hideDeactivated],
  )
  const libraryGroupsUnfiltered = useMemo(
    () => groupCatalog(librarySourceEntries),
    [librarySourceEntries],
  )
  const watchFolderCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const folder of watchFolders) {
      counts[folder] = groupCatalog(
        entries.filter(isLibraryEntry).filter((entry) => isPathUnderFolder(entry.sourcePath, folder)),
      ).length
    }
    return counts
  }, [entries, watchFolders])
  const updateGroups = useMemo(
    () =>
      sortFamilyGroups(
        groupCatalog(entries.filter((entry) => entry.status === 'outdated')).filter((group) =>
          matchesQuery(group.familyName, query),
        ),
        sortMode,
      ),
    [entries, query, sortMode],
  )
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
      library: groupCatalog(entries.filter(isLibraryEntry)).length,
      system: groupSystem(systemFaces).length,
      updates: groupCatalog(entries.filter((entry) => entry.status === 'outdated')).length,
    }),
    [entries, systemFaces],
  )

  const visibleGroups = useMemo(
    () =>
      tab === 'system' ? [] : tab === 'updates' ? updateGroups : libraryGroups,
    [tab, updateGroups, libraryGroups],
  )
  const hasCatalogList =
    tab === 'system'
      ? shownSystemGroups.length > 0
      : tab === 'library'
        ? libraryGroupsUnfiltered.length > 0
        : visibleGroups.length > 0
  const selectedGroup =
    visibleGroups.find((group) => group.familyName === selectedFamily) ?? null
  const selectedEntry =
    selectedGroup?.entries.find((entry) => entry.id === selectedEntryId) ??
    selectedGroup?.entries[0] ??
    null
  const selectedSystemGroup =
    tab === 'system'
      ? (shownSystemGroups.find((group) => group.familyName === selectedSystem) ?? null)
      : null

  useEffect(() => {
    if (tab === 'updates' && updateGroups.length === 0) {
      setTab('library')
    }
  }, [tab, updateGroups.length])

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
    const current = selectedFamilyKeys.length
      ? selectedFamilyKeys
      : selectedFamily
        ? [selectedFamily]
        : []
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
    setSelectedFamily(group.familyName)
    setSelectedEntryId(group.entries[0]?.id ?? null)
    if (!range) setSelectionAnchor(group.familyName)
    setInspectSelection(keys.length === 1 && !toggle && !range)
  }

  function handleSystemSelect(group: SystemFamilyGroup, event: MouseEvent) {
    if (suppressClickRef.current) return
    const current = selectedSystemKeys.length
      ? selectedSystemKeys
      : selectedSystem
        ? [selectedSystem]
        : []
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
    setSelectedSystem(group.familyName)
    if (!range) setSelectionAnchor(group.familyName)
    setInspectSelection(keys.length === 1 && !toggle && !range)
  }

  function selectedCatalogGroups(): FamilyGroup[] {
    const keys = new Set(
      selectedFamilyKeys.length ? selectedFamilyKeys : selectedFamily ? [selectedFamily] : [],
    )
    return visibleGroups.filter((group) => keys.has(group.familyName))
  }

  function selectedSystemList(): SystemFamilyGroup[] {
    const keys = new Set(
      selectedSystemKeys.length ? selectedSystemKeys : selectedSystem ? [selectedSystem] : [],
    )
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

    const currentKeys =
      tab === 'system'
        ? selectedSystemKeys.length
          ? selectedSystemKeys
          : selectedSystem
            ? [selectedSystem]
            : []
        : selectedFamilyKeys.length
          ? selectedFamilyKeys
          : selectedFamily
            ? [selectedFamily]
            : []
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

  function installGroup(group: FamilyGroup, familyName?: string) {
    const ids = entryIds(group)
    return ids.length > 1 ? api.installMany(ids, familyName) : api.install(ids[0], familyName)
  }

  function uninstallGroup(group: FamilyGroup) {
    const ids = entryIds(group)
    return ids.length > 1 ? api.uninstallMany(ids) : api.uninstall(ids[0])
  }

  function deactivateGroup(group: FamilyGroup) {
    const ids = entryIds(group)
    return ids.length > 1 ? api.deactivateMany(ids) : api.deactivate(ids[0])
  }

  function activateGroup(group: FamilyGroup) {
    const ids = entryIds(group)
    return ids.length > 1 ? api.activateMany(ids) : api.activate(ids[0])
  }

  function reinstallGroup(group: FamilyGroup) {
    const ids = entryIds(group)
    return ids.length > 1 ? api.reinstallMany(ids) : api.reinstall(ids[0])
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
    const groups = selectedCatalogGroups().filter((group) => group.status === 'uninstalled')
    if (groups.length === 0) return
    await run(async () => {
      for (let index = 0; index < groups.length; index += 1) {
        setActionStatus(
          remainingActionCopy(
            'install',
            groups.length - index,
            groups.length === 1 ? groups[0].familyName : undefined,
          ),
        )
        await installGroup(groups[index])
      }
    }, actionCopyFor('install', groups))
  }

  async function activateSelected() {
    const groups = selectedCatalogGroups().filter((group) => group.status === 'deactivated')
    if (groups.length === 0) return
    await run(async () => {
      for (const group of groups) {
        await activateGroup(group)
      }
    }, actionCopyFor('activate', groups))
  }

  async function installOrActivateSelected() {
    const groups = selectedCatalogGroups().filter(
      (group) => group.status === 'uninstalled' || group.status === 'deactivated',
    )
    if (groups.length === 0) return
    const verb = groups.every((group) => group.status === 'deactivated') ? 'activate' : 'install'
    await run(async () => {
      for (let index = 0; index < groups.length; index += 1) {
        setActionStatus(
          remainingActionCopy(
            verb,
            groups.length - index,
            groups.length === 1 ? groups[0].familyName : undefined,
          ),
        )
        if (groups[index].status === 'deactivated') await activateGroup(groups[index])
        else await installGroup(groups[index])
      }
    }, actionCopyFor(verb, groups))
  }

  async function reinstallSelected() {
    const groups = selectedCatalogGroups().filter((group) => group.status === 'outdated')
    if (groups.length === 0) return
    await run(async () => {
      for (const group of groups) {
        await reinstallGroup(group)
      }
    }, actionCopyFor('reinstall', groups))
  }

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
    const groups = selectedCatalogGroups().filter(
      (group) => group.status === 'installed' || group.status === 'outdated',
    )
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

  async function run(action: () => Promise<unknown>, copy: { pending: string; done: string }) {
    busyRef.current = true
    setBusy(true)
    setActionStatus(copy.pending)
    try {
      await action()
      setActionStatus(null)
      toast.success(copy.done)
      const catalog = await api.catalog()
      setEntries(catalog.entries)
    } catch (err) {
      setActionStatus(null)
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      busyRef.current = false
      setBusy(false)
      setActionStatus(null)
    }
  }

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    const paths = files
      .map((file) => (file as File & { path?: string }).path)
      .filter((value): value is string => Boolean(value))
    await importDropped(paths, files)
  }

  async function handleDrop(dataTransfer: DataTransfer) {
    try {
      const payload = await collectDropPayload(dataTransfer)
      setDragging(false)
      if (payload.folders.length > 0) {
        if (isWebOnlyDrop(partitionDropPayload(payload.paths, payload.files))) {
          toast.error(WOFF_INSTALL_ERROR)
          return
        }
        setFolderDrop(payload)
        return
      }
      await importDropped(payload.paths, payload.files)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add fonts')
      setDragging(false)
    }
  }

  function selectLibrary(folder: string | null) {
    setTab('library')
    setWatchFolderFilter(folder)
  }

  async function watchDroppedFolders(folders: string[], leftover: { paths: string[]; files: File[] }) {
    const next = mergeWatchFolders(watchFolders, folders)
    busyRef.current = true
    setBusy(true)
    setActionStatus(folders.length === 1 ? 'Adding watch folder…' : 'Adding watch folders…')
    try {
      const result = await api.updateSettings({ watchFolders: next })
      applySettings(result.settings)
      selectLibrary(folders[0] ?? null)
      setQuery('')
      toast.success(
        folders.length === 1
          ? `Watching ${watchFolderName(folders[0])}`
          : `Watching ${folders.length} folders`,
      )
      const loosePaths = leftover.paths.filter(
        (filePath) => !folders.some((folder) => isPathUnderFolder(filePath, folder)),
      )
      if (loosePaths.length || leftover.files.length) {
        await importDropped(loosePaths, leftover.files)
        selectLibrary(folders[0] ?? null)
        return
      }
      setEntries((await api.catalog()).entries)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add watch folder')
    } finally {
      busyRef.current = false
      setBusy(false)
      setActionStatus(null)
      setDragging(false)
    }
  }

  async function importDropped(paths: string[], files: File[]) {
    const partitioned = partitionDropPayload(paths, files)
    if (isWebOnlyDrop(partitioned)) {
      toast.error(WOFF_INSTALL_ERROR)
      setDragging(false)
      return
    }
    busyRef.current = true
    setBusy(true)
    setActionStatus('Adding fonts…')
    try {
      const result =
        partitioned.paths.length
          ? await api.importPaths(partitioned.paths)
          : await api.importFiles(partitioned.files)
      const ignored = partitioned.skippedWeb + (result.ignored ?? 0)
      const visibleErrors = result.errors.filter((message) => message !== WOFF_INSTALL_ERROR)
      if (result.entries.length === 0) {
        toast.error(emptyImportError(visibleErrors, ignored))
        return
      }
      if (visibleErrors.length) toast.error(visibleErrors.join('\n'))
      const shouldInstall = settings?.installAfterUpload !== false
      const pendingIds = result.entries
        .filter((entry) => entry.status !== 'installed' && entry.status !== 'source-missing')
        .map((entry) => entry.id)
      let installed = false
      if (shouldInstall && pendingIds.length > 0) {
        try {
          for (let index = 0; index < pendingIds.length; index += 1) {
            const remaining = pendingIds.length - index
            const current = result.entries.find((entry) => entry.id === pendingIds[index])
            setActionStatus(
              remainingActionCopy(
                'install',
                remaining,
                pendingIds.length === 1 && current ? familyNameOf(current) : undefined,
              ),
            )
            await api.install(pendingIds[index])
          }
          installed = true
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Could not install fonts')
          setEntries((await api.catalog()).entries)
          return
        }
      }
      const names = [...new Set(result.entries.map(familyNameOf))]
      setQuery('')
      setWatchFolderFilter(null)
      setTab('library')
      setSelectedFamily(names[0] ?? null)
      setSelectedFamilyKeys(names)
      setSelectionAnchor(names[0] ?? null)
      setInspectSelection(names.length === 1)
      setSelectedEntryId(result.entries[0]?.id ?? null)
      setScrollToFamily(names[0] ?? null)
      toast.success(
        importDoneCopy({
          installed,
          count: result.entries.length,
          name: familyNameOf(result.entries[0]),
          ignored,
        }),
      )
      setEntries((await api.catalog()).entries)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add fonts')
    } finally {
      busyRef.current = false
      setBusy(false)
      setActionStatus(null)
      setDragging(false)
    }
  }

  async function revealCatalog(entry: CatalogEntry, which: 'source' | 'installed' = 'source') {
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

  return (
      <div
        className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row"
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => {
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
          }}
          watchFolders={watchFolders}
          watchFolderFilter={watchFolderFilter}
          watchFolderCounts={watchFolderCounts}
          onSelectWatchFolder={selectLibrary}
          counts={tabCounts}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <section
            className={cn('flex min-h-0 min-w-0 flex-1 flex-col', marqueeRect && 'select-none')}
            onPointerDown={handleListPointerDown}
          >
            {!loading && hasCatalogList && (
              <div data-keep-selection="" className="shrink-0 space-y-3 bg-background px-4 pt-4 pb-3">
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
                    hideDeactivated={hideDeactivated}
                    onHideDeactivatedChange={(next) => {
                      setHideDeactivated(next)
                      localStorage.setItem('font-butler-hide-deactivated', String(next))
                    }}
                    showHideDeactivated={tab === 'library'}
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
              <div className={cn('p-4', showBatchBar && 'pb-24')}>
                {loading && (
                  <p className="px-2 py-12 text-center text-sm text-muted-foreground">
                    Reading fonts…
                  </p>
                )}
                {error && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
                )}
                {!loading && tab !== 'system' && visibleGroups.length === 0 && (
                  <EmptyState
                    tab={tab}
                    watchFolderName={
                      tab === 'library' && watchFolderFilter
                        ? watchFolderName(watchFolderFilter)
                        : null
                    }
                    onPickFiles={(files) => void handleFiles(files)}
                  />
                )}
                {!loading && tab === 'system' && systemGroups.length === 0 && (
                  <p className="px-2 py-12 text-center text-sm text-muted-foreground">
                    No fonts found in the system folders.
                  </p>
                )}
                {!loading && missingSourceCount > 0 && tab !== 'system' && tab !== 'updates' && (
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
                  className={cn(
                    viewLayout === 'grid'
                      ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4'
                      : 'grid gap-2',
                  )}
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
                          onEnsureSelected={() => {
                            if (!inSelection) {
                              setSelectedSystem(group.familyName)
                              setSelectedSystemKeys([group.familyName])
                              setSelectionAnchor(group.familyName)
                              setInspectSelection(true)
                            }
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
                          onSelectEntry={setSelectedEntryId}
                          onEnsureSelected={() => {
                            if (!inSelection) selectGroup(group)
                          }}
                          busy={busy}
                          onInstall={() =>
                            useBatch
                              ? void installSelected()
                              : void run(() => installGroup(group), actionCopy('install', group.familyName))
                          }
                          onInstallAs={() => setRenameEntry(selectedEntry ?? group.entries[0])}
                          onReinstall={() =>
                            useBatch
                              ? void reinstallSelected()
                              : void run(() => reinstallGroup(group), actionCopy('reinstall', group.familyName))
                          }
                          onUninstall={() =>
                            useBatch
                              ? void uninstallSelected()
                              : void run(() => uninstallGroup(group), actionCopy('remove', group.familyName))
                          }
                          onDeactivate={() =>
                            useBatch
                              ? void deactivateSelected()
                              : void run(() => deactivateGroup(group), actionCopy('deactivate', group.familyName))
                          }
                          onActivate={() =>
                            useBatch
                              ? void activateSelected()
                              : void run(() => activateGroup(group), actionCopy('activate', group.familyName))
                          }
                          onReveal={() => {
                            selectGroup(group)
                            void revealCatalog(selectedEntry ?? group.entries[0])
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
                        />
                        )
                      })}
                </div>
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
                      onReinstall={() => void reinstallSelected()}
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
            className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l bg-background shadow-xl md:w-80"
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
              onInstall={() =>
                selectedGroup &&
                void run(() => installGroup(selectedGroup), actionCopy('install', selectedGroup.familyName))
              }
              onInstallAs={() => setRenameEntry(selectedEntry)}
              onReinstall={() =>
                selectedGroup &&
                void run(() => reinstallGroup(selectedGroup), actionCopy('reinstall', selectedGroup.familyName))
              }
              onUninstall={() =>
                selectedGroup &&
                void run(() => uninstallGroup(selectedGroup), actionCopy('remove', selectedGroup.familyName))
              }
              onDeactivate={() =>
                selectedGroup &&
                void run(() => deactivateGroup(selectedGroup), actionCopy('deactivate', selectedGroup.familyName))
              }
              onActivate={() =>
                selectedGroup &&
                void run(() => activateGroup(selectedGroup), actionCopy('activate', selectedGroup.familyName))
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
                        onReinstall: () => void reinstallSelected(),
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
          <div className="pointer-events-none fixed inset-3 z-40 flex items-center justify-center rounded-lg border border-dashed border-foreground/20 bg-background/80">
            <p className="text-base font-medium tracking-tight">Drop fonts or folders to add them</p>
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

function uniquePaths(faces: SystemFace[]): string[] {
  return [...new Set(faces.map((face) => face.path))]
}

function sameKeys(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index])
}

function collectFamilyCardRects(): Array<{ key: string; rect: Rect }> {
  return Array.from(document.querySelectorAll('[data-family-key]')).flatMap((node) => {
    const key = node.getAttribute('data-family-key')
    if (!key) return []
    const box = node.getBoundingClientRect()
    return [
      {
        key,
        rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      },
    ]
  })
}

function MarqueeOverlay({ rect }: { rect: Rect | null }) {
  if (!rect) return null
  return (
    <div
      className="pointer-events-none fixed z-50 border border-foreground/30 bg-foreground/10"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
      }}
    />
  )
}

function clickPreservesSelection(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      '[data-family-key], [data-keep-selection], [data-radix-scroll-area-scrollbar]',
    ) != null
  )
}

function LibraryCard({
  group,
  layout,
  previewSize,
  showSourcePath,
  selected,
  selectedEntryId,
  busy,
  batch,
  onSelect,
  onSelectEntry,
  onEnsureSelected,
  onInstall,
  onInstallAs,
  onReinstall,
  onUninstall,
  onDeactivate,
  onActivate,
  onReveal,
  onForget,
  onDeleteFiles,
}: {
  group: FamilyGroup
  layout: ViewLayout
  previewSize: number
  showSourcePath?: boolean
  selected: boolean
  selectedEntryId: string | null
  busy: boolean
  batch: CatalogBatchPlan | null
  onSelect: (event: MouseEvent) => void
  onSelectEntry: (entryId: string) => void
  onEnsureSelected: () => void
  onInstall: () => void
  onInstallAs: () => void
  onReinstall: () => void
  onUninstall: () => void
  onDeactivate: () => void
  onActivate: () => void
  onReveal: () => void
  onForget: () => void
  onDeleteFiles: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)
  const preview = group.entries.find((entry) => entry.id === group.previewEntryId) ?? group.entries[0]
  const missingSource = hasSourceMissing(group)
  const instances = useMemo(() => catalogInstanceRows(group), [group])
  const showInstances = instances.length > 0 && layout === 'list'
  const previewFamily = catalogFontFamily(group.previewEntryId)
  const previewWeight = preview.faces[0]?.weight
  const previewItalic = preview.faces[0]?.italic
  const previewFaces = useMemo(
    () =>
      instances.map((row) => ({
        family: row.catalogEntryId ? catalogFontFamily(row.catalogEntryId) : previewFamily,
        weight: row.weight,
        italic: row.italic,
        label: row.label,
      })),
    [instances, previewFamily],
  )
  const plan = batch ?? catalogBatchPlan([group])

  const muted = group.status === 'deactivated'

  const metadata = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate font-medium">{group.familyName}</span>
        <VfBadge show={group.isVariable} />
        <StatusBadge status={group.status} />
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {group.instanceCount} {group.instanceCount === 1 ? 'instance' : 'instances'}
        {group.entries.length > 1 ? ` · ${group.entries.length} files` : ''}
      </div>
      {showSourcePath && (
        <div className="mt-1 space-y-0.5">
          {group.entries.map((item) => (
            <div
              key={item.id}
              className="truncate font-mono text-[11px] text-muted-foreground/90"
              title={item.sourcePath}
            >
              {item.sourcePath}
            </div>
          ))}
        </div>
      )}
    </>
  )

  return (
    <ContextMenu onOpenChange={(open) => { if (open) onEnsureSelected() }}>
      <ContextMenuTrigger asChild>
        <div
          data-family-key={group.familyName}
          className={cn(
            'group relative overflow-hidden rounded-lg border transition-colors',
            selected ? 'border-border bg-muted/60' : 'border-border/80 hover:bg-muted/40',
            muted && 'opacity-50',
          )}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          {layout === 'grid' ? (
            <button
              type="button"
              onClick={onSelect}
              className="flex w-full flex-col text-left"
            >
              <CyclingAaPreview
                faces={previewFaces}
                rest={
                  previewFaces.find((face) => face.family === previewFamily && !face.italic) ??
                  previewFaces.find((face) => face.family === previewFamily) ?? {
                    family: previewFamily,
                    weight: previewWeight,
                    italic: previewItalic,
                    label: preview.faces[0]?.styleName ?? 'Regular',
                  }
                }
                active={hovered && !selected}
                size={previewSize}
              />
              <div className="p-3">{metadata}</div>
            </button>
          ) : (
            <>
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={onSelect}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                >
                  <AaPreview
                    family={previewFamily}
                    weight={previewWeight}
                    italic={previewItalic}
                  />
                  <div className="min-w-0 flex-1">{metadata}</div>
                </button>
                {showInstances && (
                  <button
                    type="button"
                    data-no-marquee=""
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide instances' : 'Show instances'}
                    onClick={(event) => {
                      event.stopPropagation()
                      setExpanded((value) => !value)
                    }}
                    className="flex w-10 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  >
                    <ChevronDown
                      className={cn('size-4 transition-transform', expanded && 'rotate-180')}
                    />
                  </button>
                )}
              </div>
              {expanded && showInstances && (
                <InstanceList
                  rows={instances}
                  selectedEntryId={selectedEntryId}
                  onSelectEntry={onSelectEntry}
                />
              )}
            </>
          )}
          {!batch && (
            <CatalogCardActions
              status={group.status}
              missingSource={missingSource}
              busy={busy}
              visible={selected}
              offset={layout === 'list' && showInstances}
              onInstall={onInstall}
              onDeactivate={onDeactivate}
              onUninstall={onUninstall}
              onActivate={onActivate}
              onForget={onForget}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onReveal}>
          <FolderOpen /> Show in Finder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <CatalogMenuItems
          plan={plan}
          busy={busy}
          showInstallAs={!batch}
          onInstall={onInstall}
          onInstallAs={onInstallAs}
          onReinstall={onReinstall}
          onDeactivate={onDeactivate}
          onUninstall={onUninstall}
          onActivate={onActivate}
          onForget={onForget}
          onDeleteFiles={onDeleteFiles}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function SystemCard({
  group,
  layout,
  previewSize,
  showSourcePath,
  selected,
  busy,
  batch,
  onSelect,
  onEnsureSelected,
  onReveal,
  onUninstall,
  onDeactivate,
}: {
  group: SystemFamilyGroup
  layout: ViewLayout
  previewSize: number
  showSourcePath?: boolean
  selected: boolean
  busy: boolean
  batch: SystemBatchPlan | null
  onSelect: (event: MouseEvent) => void
  onEnsureSelected: () => void
  onReveal: () => void
  onUninstall: () => void
  onDeactivate: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)
  const face = group.faces[0]
  const instances = useMemo(() => systemInstanceRows(group), [group])
  const showInstances = instances.length > 0 && layout === 'list'
  const previewFamily = systemFontFamily(face.path)
  const previewFaces = useMemo(
    () =>
      instances.map((row) => ({
        family: row.systemPath ? systemFontFamily(row.systemPath) : previewFamily,
        weight: row.weight,
        italic: row.italic,
        label: row.label,
      })),
    [instances, previewFamily],
  )
  const plan = batch ?? systemBatchPlan([group])

  const metadata = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate font-medium">{group.familyName}</span>
        <VfBadge show={group.isVariable} />
        {group.protected && <Badge>System</Badge>}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {group.instanceCount} {group.instanceCount === 1 ? 'instance' : 'instances'}
      </div>
      {showSourcePath && (
        <div
          className="mt-1 truncate font-mono text-[11px] text-muted-foreground/90"
          title={face.path}
        >
          {face.path}
        </div>
      )}
    </>
  )

  return (
    <ContextMenu onOpenChange={(open) => { if (open) onEnsureSelected() }}>
      <ContextMenuTrigger asChild>
        <div
          data-family-key={group.familyName}
          className={cn(
            'group relative overflow-hidden rounded-lg border transition-colors',
            selected ? 'border-border bg-muted/60' : 'border-border/80 hover:bg-muted/40',
          )}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          {layout === 'grid' ? (
            <button
              type="button"
              onClick={onSelect}
              className="flex w-full flex-col text-left"
            >
              <CyclingAaPreview
                faces={previewFaces}
                rest={{
                  family: previewFamily,
                  weight: face.weight,
                  italic: face.italic,
                  label: face.styleName,
                }}
                active={hovered && !selected}
                size={previewSize}
              />
              <div className="p-3">{metadata}</div>
            </button>
          ) : (
            <>
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={onSelect}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                >
                  <AaPreview
                    family={previewFamily}
                    weight={face.weight}
                    italic={face.italic}
                  />
                  <div className="min-w-0 flex-1">{metadata}</div>
                </button>
                {showInstances && (
                  <button
                    type="button"
                    data-no-marquee=""
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide instances' : 'Show instances'}
                    onClick={(event) => {
                      event.stopPropagation()
                      setExpanded((value) => !value)
                    }}
                    className="flex w-10 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  >
                    <ChevronDown
                      className={cn('size-4 transition-transform', expanded && 'rotate-180')}
                    />
                  </button>
                )}
              </div>
              {expanded && showInstances && <InstanceList rows={instances} />}
            </>
          )}
          {!batch && (
            <SystemCardActions
              writable={group.writable}
              busy={busy}
              visible={selected}
              offset={layout === 'list' && showInstances}
              onDeactivate={onDeactivate}
              onUninstall={onUninstall}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onReveal}>
          <FolderOpen /> Show in Finder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <SystemMenuItems
          plan={plan}
          busy={busy}
          onDeactivate={onDeactivate}
          onUninstall={onUninstall}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function EmptyState({
  tab,
  watchFolderName,
  onPickFiles,
}: {
  tab: Tab
  watchFolderName?: string | null
  onPickFiles: (files: FileList | File[]) => void
}) {
  const folderInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
      <label className="flex cursor-pointer flex-col items-center">
        <p className="text-base font-medium tracking-tight">
          {watchFolderName
            ? `No fonts in ${watchFolderName}`
            : tab === 'updates'
              ? 'No source updates'
              : 'Drop font files or folders here'}
        </p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {watchFolderName
            ? 'Drop fonts into this folder in Finder, or drop them here to add them.'
            : tab === 'library'
              ? 'Drop a folder to add every TrueType and OpenType file inside it, including collections and subfolders. You can also watch a folder so new fonts are imported automatically. Uninstalled fonts stay here so you can put them back in one click.'
              : 'Fonts you uninstall stay in the library so you can put them back in one click.'}
        </p>
        <input
          type="file"
          accept=".ttf,.otf,.ttc,.otc"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) onPickFiles(event.target.files)
          }}
        />
      </label>
      {tab === 'library' && (
        <>
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            {...{ webkitdirectory: '', directory: '' }}
            onChange={(event) => {
              const list = event.target.files
              if (!list) return
              const fonts = Array.from(list).filter((file) => isDroppedFontName(file.name))
              if (fonts.length === 0) {
                toast.error('No font files in that folder.')
                return
              }
              onPickFiles(fonts)
              event.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => folderInputRef.current?.click()}
          >
            <FolderOpen /> Choose folder
          </Button>
        </>
      )}
    </div>
  )
}

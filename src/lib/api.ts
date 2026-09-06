import type {
  AdobeFontCacheInfo,
  AppSettings,
  CatalogEntry,
  DuplicateWarning,
  DestinationCapability,
  DestinationId,
  DefaultDestinationId,
  DestinationInvestigationRow,
  FolderPolicyPreset,
  FolderRelinkPreview,
  ImportPlan,
  Notice,
  OfficeFontCacheInfo,
  Operation,
  ProjectSet,
  RelinkPreview,
  SortMode,
  SystemFace,
  ThemeMode,
  ViewLayout,
  WatchFolder,
  ComparisonCapture,
} from './types'

let apiToken: string | null = null
let bootstrapSettings: AppSettings | null = null

async function ensureToken(): Promise<string> {
  if (apiToken) {
    return apiToken
  }
  const fromDesktop = window.fontButlerDesktop?.getApiToken
  if (fromDesktop) {
    try {
      const desktopToken = await fromDesktop()
      if (desktopToken) {
        apiToken = desktopToken
        return apiToken
      }
    } catch {
      // Fall back to HTTP bootstrap when the preload bridge is unavailable.
    }
  }
  const response = await fetch('/api/bootstrap')
  const data = (await response.json()) as { token?: string; settings?: AppSettings }
  if (!response.ok || !data.token) {
    throw new Error('Could not connect to Font Buttler API.')
  }
  apiToken = data.token
  if (data.settings) {
    bootstrapSettings = data.settings
  }
  return apiToken
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const headers = new Headers(extra)
  if (apiToken) {
    headers.set('Authorization', `Bearer ${apiToken}`)
  }
  return headers
}

async function json<T>(input: Promise<Response>): Promise<T> {
  await ensureToken()
  const response = await input
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || response.statusText)
  }
  return data
}

async function post(url: string, body: unknown): Promise<Response> {
  await ensureToken()
  return fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
}

export const api = {
  bootstrap: async () => {
    await ensureToken()
    return { settings: bootstrapSettings }
  },
  catalog: () => json<{ entries: CatalogEntry[] }>(fetch('/api/catalog')),
  system: () => json<{ faces: SystemFace[] }>(fetch('/api/system')),
  inspectDrop: (paths: string[]) =>
    json<{
      folders: string[]
      files: string[]
      formats: { format: string; count: number }[]
      skippedWeb: number
    }>(post('/api/drop-inspect', { paths })),
  importPaths: (paths: string[]) =>
    json<{ entries: CatalogEntry[]; errors: string[]; ignored: number }>(post('/api/import', { paths })),
  importFiles: async (files: File[]) => {
    await ensureToken()
    const body = new FormData()
    for (const file of files) body.append('files', file)
    return json<{ entries: CatalogEntry[]; errors: string[]; ignored: number }>(
      fetch('/api/import-files', { method: 'POST', headers: authHeaders(), body }),
    )
  },
  open: (path: string) => json<{ entry: CatalogEntry }>(post('/api/open', { path })),
  install: (
    id: string,
    familyName?: string,
    options?: { replace?: boolean; destinationId?: DestinationId; expectedSourceFingerprint?: string },
  ) =>
    json<{ entry: CatalogEntry }>(
      post('/api/install', {
        id,
        familyName,
        replace: options?.replace,
        destinationId: options?.destinationId,
        expectedSourceFingerprint: options?.expectedSourceFingerprint,
      }),
    ),
  installMany: (
    ids: string[],
    familyName?: string,
    options?: { replace?: boolean; destinationId?: DestinationId; expectedSourceFingerprint?: string },
  ) =>
    json<{ entries: CatalogEntry[] }>(
      post('/api/install', {
        ids,
        familyName,
        replace: options?.replace,
        destinationId: options?.destinationId,
        expectedSourceFingerprint: options?.expectedSourceFingerprint,
      }),
    ),
  removeDestinationCopy: (id: string, destinationId: DestinationId) =>
    json<{ entry: CatalogEntry }>(post('/api/install/destination-remove', { id, destinationId })),
  destinations: () =>
    json<{ destinations: DestinationCapability[]; investigation: DestinationInvestigationRow[] }>(
      fetch('/api/destinations'),
    ),
  uninstall: (id: string, options?: { deleteSource?: boolean }) =>
    json<{ entry: CatalogEntry }>(post('/api/uninstall', { id, deleteSource: options?.deleteSource })),
  uninstallMany: (ids: string[], options?: { deleteSource?: boolean }) =>
    json<{ entries: CatalogEntry[] }>(
      post('/api/uninstall', { ids, deleteSource: options?.deleteSource }),
    ),
  deactivate: (id: string) => json<{ entry: CatalogEntry }>(post('/api/deactivate', { id })),
  deactivateMany: (ids: string[]) =>
    json<{ entries: CatalogEntry[] }>(post('/api/deactivate', { ids })),
  activate: (id: string, options?: { replace?: boolean; switch?: boolean }) =>
    json<{ entry: CatalogEntry }>(post('/api/activate', { id, replace: options?.replace, switch: options?.switch })),
  activateMany: (ids: string[], options?: { replace?: boolean; switch?: boolean }) =>
    json<{ entries: CatalogEntry[] }>(post('/api/activate', { ids, replace: options?.replace, switch: options?.switch })),
  reinstall: (id: string, options?: { expectedSourceFingerprint?: string }) =>
    json<{ entry: CatalogEntry }>(
      post('/api/reinstall', { id, expectedSourceFingerprint: options?.expectedSourceFingerprint }),
    ),
  reinstallMany: (ids: string[], options?: { expectedSourceFingerprint?: string }) =>
    json<{ entries: CatalogEntry[] }>(
      post('/api/reinstall', { ids, expectedSourceFingerprint: options?.expectedSourceFingerprint }),
    ),
  forget: (id: string, options?: { deleteFiles?: boolean }) =>
    json<{ removed: number }>(post('/api/forget', { id, deleteFiles: options?.deleteFiles })),
  forgetMany: (ids: string[], options?: { deleteFiles?: boolean }) =>
    json<{ removed: number }>(
      post('/api/forget', { ids, deleteFiles: options?.deleteFiles }),
    ),
  forgetMissingSources: () => json<{ removed: number }>(post('/api/forget', { allMissing: true })),
  uninstallSystem: (path: string) => json<{ ok: boolean }>(post('/api/system/uninstall', { path })),
  deactivateSystem: (path: string) =>
    json<{ ok: boolean }>(post('/api/system/deactivate', { path })),
  clearFontCache: () => json<{ mac: boolean; cleared: boolean }>(post('/api/caches/font', {})),
  clearOfficeCache: () =>
    json<{ mac: boolean; cleared: boolean }>(post('/api/caches/office', {})),
  clearAdobeCache: () =>
    json<{ mac: boolean; cleared: boolean }>(post('/api/caches/adobe', {})),
  reveal: (payload: { id?: string; path?: string; which?: 'source' | 'installed' }) =>
    json<{ path: string }>(post('/api/reveal', payload)),
  settings: () =>
    json<{
      settings: AppSettings
      officeFontCache: OfficeFontCacheInfo
      adobeFontCache: AdobeFontCacheInfo
      destinations?: { destinations: DestinationCapability[]; investigation: DestinationInvestigationRow[] }
    }>(fetch('/api/settings')),
  updateSettings: (patch: {
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
    folders?: WatchFolder[]
    specimen?: AppSettings['specimen']
    defaultDestination?: DefaultDestinationId
    savedFilters?: AppSettings['savedFilters']
  }) =>
    json<{
      settings: AppSettings
      officeFontCache: OfficeFontCacheInfo
      adobeFontCache: AdobeFontCacheInfo
      destinations?: { destinations: DestinationCapability[]; investigation: DestinationInvestigationRow[] }
    }>(post('/api/settings', patch)),
  renamePreview: (id: string, familyName: string) =>
    json<{ fullName: string; postscriptName: string }>(
      fetch(
        `/api/rename-preview?id=${encodeURIComponent(id)}&familyName=${encodeURIComponent(familyName)}`,
      ),
    ),
  inspectRelink: (id: string, path: string) =>
    json<RelinkPreview>(post('/api/relink/inspect', { id, path })),
  applyRelink: (id: string, path: string) =>
    json<{ entry: CatalogEntry }>(post('/api/relink', { id, path })),
  inspectFolderRelink: (oldRoot: string, newRoot: string, search = true) =>
    json<FolderRelinkPreview>(post('/api/relink/folder/inspect', { oldRoot, newRoot, search })),
  applyFolderRelink: (oldRoot: string, newRoot: string, selections?: Record<string, string | undefined>) =>
    json<{ entries: CatalogEntry[] }>(post('/api/relink/folder', { oldRoot, newRoot, selections })),
  configureFolder: (input: {
    root: string
    policy?: FolderPolicyPreset
    exclusions?: string[]
    id?: string
    destinationId?: DefaultDestinationId
  }) =>
    json<{ folder: WatchFolder; discovery: ImportPlan }>(post('/api/folders/configure', input)),
  startWatching: (id: string) => json<{ folder: WatchFolder }>(post('/api/folders/start', { id })),
  pauseFolder: (id: string) => json<{ folder: WatchFolder }>(post('/api/folders/pause', { id })),
  resumeFolder: (id: string) => json<{ folder: WatchFolder }>(post('/api/folders/resume', { id })),
  planImport: (paths: string[]) => json<ImportPlan>(post('/api/import/plan', { paths })),
  applyPlan: (
    planId: string,
    choices?: Record<string, ImportPlan['items'][number]['defaultChoice']>,
    extra?: { idempotencyKey?: string; familyName?: string },
  ) =>
    json<{
      operationId: string
      succeeded: number
      failed: number
      skipped: number
      errors: string[]
      entries: CatalogEntry[]
      failedIds: string[]
    }>(post('/api/import/apply', { planId, choices, ...extra })),
  duplicates: () => json<{ duplicates: DuplicateWarning[] }>(fetch('/api/duplicates')),
  resolveDuplicate: (
    id: string,
    choice: 'replace' | 'add-inactive' | 'skip' | 'switch' | 'install-as',
    familyName?: string,
  ) =>
    json<{ entries: CatalogEntry[]; duplicates: DuplicateWarning[] }>(
      post('/api/duplicates/resolve', { id, choice, familyName }),
    ),
  switchTo: (id: string) => json<{ entry: CatalogEntry }>(post('/api/switch', { id })),
  activity: () => json<{ operations: Operation[] }>(fetch('/api/activity')),
  undo: (id: string) => json<{ operationId: string }>(post('/api/activity/undo', { id })),
  revisions: (id: string) =>
    json<{ revisions: Array<{ fingerprint: string; current: boolean; previous: boolean }> }>(
      fetch(`/api/revisions/${encodeURIComponent(id)}`),
    ),
  restoreRevision: (id: string, fingerprint?: string) =>
    json<{ entry: CatalogEntry }>(post('/api/revisions/restore', { id, fingerprint })),
  resumeUpdates: (id: string) => json<{ entry: CatalogEntry }>(post('/api/updates/resume', { id })),
  repair: (ids: string[] = [], caches = false) =>
    json<{
      fonts: Array<{ target: string; outcome: string; reason?: string }>
      caches: Array<{ target: string; outcome: string; reason?: string }>
    }>(post('/api/repair', { ids, caches })),
  projects: () => json<{ projects: ProjectSet[] }>(fetch('/api/projects')),
  createProject: (name: string, memberIds?: string[]) =>
    json<{ project: ProjectSet }>(post('/api/projects', { name, memberIds })),
  updateProject: (
    id: string,
    patch: { name?: string; memberIds?: string[]; pin?: { assetId: string; fingerprint?: string } },
  ) => json<{ project: ProjectSet }>(post('/api/projects/update', { id, ...patch })),
  deleteProject: (id: string) => json<{ ok: boolean }>(post('/api/projects/delete', { id })),
  activateProject: (id: string) =>
    json<{ succeeded: number; failed: number; failedIds: string[] }>(post('/api/projects/activate', { id })),
  deactivateProject: (id: string) => json<{ ok: boolean }>(post('/api/projects/deactivate', { id })),
  previewMeta: (id: string, which: 'source' | 'installed' | 'revision' = 'installed', revision?: string) =>
    json<{
      faces: CatalogEntry['faces']
      format: string
      axes?: Array<{ tag: string; name: string; min: number; default: number; max: number }>
      namedInstances?: Array<{ name: string; coordinates: Record<string, number> }>
      features?: string[]
      characterSet?: number[]
      fingerprint?: string
    }>(
      fetch(
        `/api/preview-meta/${encodeURIComponent(id)}?which=${which}${revision ? `&revision=${encodeURIComponent(revision)}` : ''}`,
      ),
    ),
  captureComparison: (id: string) => json<ComparisonCapture>(post('/api/comparison/capture', { id })),
}

export function subscribeEvents(onEvent: (event: unknown) => void): () => void {
  const source = new EventSource('/api/events')
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data))
    } catch {
      // ignore malformed SSE
    }
  }
  return () => source.close()
}

export function isNotice(value: unknown): value is { type: 'notice'; notice: Notice } {
  return Boolean(value && typeof value === 'object' && (value as { type?: string }).type === 'notice')
}

export function isSettingsEvent(
  value: unknown,
): value is { type: 'settings'; settings: AppSettings } {
  return Boolean(
    value && typeof value === 'object' && (value as { type?: string }).type === 'settings',
  )
}

export function isProjectsEvent(
  value: unknown,
): value is { type: 'projects'; projects: ProjectSet[] } {
  return Boolean(
    value && typeof value === 'object' && (value as { type?: string }).type === 'projects',
  )
}

export function isOperationsEvent(
  value: unknown,
): value is { type: 'operations'; operations: Operation[] } {
  return Boolean(
    value && typeof value === 'object' && (value as { type?: string }).type === 'operations',
  )
}

export function isDuplicatesEvent(
  value: unknown,
): value is { type: 'duplicates'; duplicates: DuplicateWarning[] } {
  return Boolean(
    value && typeof value === 'object' && (value as { type?: string }).type === 'duplicates',
  )
}

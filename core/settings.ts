import fs from 'node:fs'
import type { AppPaths } from './paths.ts'
import {
  DEFAULT_ACTIVITY_MAX_OPERATIONS,
  DEFAULT_ACTIVITY_RETENTION_DAYS,
  DEFAULT_REVISION_BUDGET_BYTES,
  migrateFolders,
  syncWatchFolderPaths,
} from './folders.ts'
import { parseDefaultDestination } from './destinations.ts'
import { normalizeSavedFilters } from './saved-filters.ts'
import type {
  AppSettings,
  PreviewPreferences,
  RetailSyncSettings,
  SortMode,
  ThemeMode,
  ViewLayout,
} from './types.ts'

/** Production worker (`wrangler.toml` production route). Dev is opt-in via the settings field. */
export const DEFAULT_RETAIL_WORKER_BASE_URL = 'https://w.displaay.net'

export function defaultRetailSync(): RetailSyncSettings {
  return { enabled: false, workerBaseUrl: DEFAULT_RETAIL_WORKER_BASE_URL, folderId: null }
}

function readRetailSync(value: unknown): RetailSyncSettings {
  const defaults = defaultRetailSync()
  if (!value || typeof value !== 'object') return defaults
  const row = value as Partial<RetailSyncSettings>
  const workerBaseUrl =
    typeof row.workerBaseUrl === 'string' && row.workerBaseUrl.trim()
      ? row.workerBaseUrl.trim()
      : defaults.workerBaseUrl
  return {
    enabled: row.enabled === true,
    workerBaseUrl,
    folderId: typeof row.folderId === 'string' && row.folderId ? row.folderId : null,
  }
}

const emptySettings = (): AppSettings => ({
  version: 1,
  watchFolders: [],
  folders: [],
  defaultView: 'list',
  defaultSort: 'name',
  installAfterUpload: true,
  installWatchFolderFonts: true,
  theme: 'system',
  menuBarIcon: true,
  openAtLogin: false,
  clearOfficeFontCache: true,
  clearAdobeFontCache: true,
  autoReinstallOnUpdate: false,
  skipCacheClearOnReinstall: false,
  nativeNotifications: false,
  onboardingCompleted: false,
  revisionBudgetBytes: DEFAULT_REVISION_BUDGET_BYTES,
  activityRetentionDays: DEFAULT_ACTIVITY_RETENTION_DAYS,
  activityMaxOperations: DEFAULT_ACTIVITY_MAX_OPERATIONS,
  defaultDestination: 'macos',
  savedFilters: [],
  retailSync: defaultRetailSync(),
})

function isViewLayout(value: unknown): value is ViewLayout {
  return value === 'list' || value === 'grid'
}

function isSortMode(value: unknown): value is SortMode {
  return value === 'name' || value === 'added'
}

function readSortMode(value: unknown): SortMode | undefined {
  if (isSortMode(value)) {
    return value
  }
  if (value === 'installed') {
    return 'added'
  }
  return undefined
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function readWatchFolders(parsed: {
  watchFolders?: unknown
  watchFolder?: unknown
}): string[] {
  if (Array.isArray(parsed.watchFolders)) {
    const folders = parsed.watchFolders
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .map((item) => item.trim())
    return [...new Set(folders)]
  }
  if (typeof parsed.watchFolder === 'string' && parsed.watchFolder.trim()) {
    return [parsed.watchFolder.trim()]
  }
  return []
}

function readSpecimen(value: unknown): PreviewPreferences | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Partial<PreviewPreferences>
  if (typeof row.text !== 'string') return undefined
  return {
    text: row.text,
    size: typeof row.size === 'number' ? row.size : 48,
    lineHeight: typeof row.lineHeight === 'number' ? row.lineHeight : 1.2,
    preset:
      row.preset === 'headline' ||
      row.preset === 'paragraph' ||
      row.preset === 'numerals' ||
      row.preset === 'custom'
        ? row.preset
        : 'custom',
  }
}

export function loadSettings(paths: AppPaths): AppSettings {
  if (!fs.existsSync(paths.settingsPath)) {
    return emptySettings()
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.settingsPath, 'utf8')) as Partial<AppSettings> & {
      watchFolder?: unknown
    }
    if (!parsed || parsed.version !== 1) {
      return emptySettings()
    }
    const defaults = emptySettings()
    const watchFolders = readWatchFolders(parsed)
    const installWatchFolderFonts =
      typeof parsed.installWatchFolderFonts === 'boolean'
        ? parsed.installWatchFolderFonts
        : defaults.installWatchFolderFonts
    const autoReinstallOnUpdate =
      typeof parsed.autoReinstallOnUpdate === 'boolean'
        ? parsed.autoReinstallOnUpdate
        : defaults.autoReinstallOnUpdate
    const settings: AppSettings = {
      version: 1,
      watchFolders,
      folders: migrateFolders(watchFolders, parsed.folders, {
        installNew: installWatchFolderFonts,
        autoUpdate: autoReinstallOnUpdate,
      }),
      defaultView: isViewLayout(parsed.defaultView) ? parsed.defaultView : defaults.defaultView,
      defaultSort: readSortMode(parsed.defaultSort) ?? defaults.defaultSort,
      installAfterUpload:
        typeof parsed.installAfterUpload === 'boolean'
          ? parsed.installAfterUpload
          : defaults.installAfterUpload,
      installWatchFolderFonts,
      theme: isThemeMode(parsed.theme) ? parsed.theme : defaults.theme,
      menuBarIcon:
        typeof parsed.menuBarIcon === 'boolean' ? parsed.menuBarIcon : defaults.menuBarIcon,
      openAtLogin:
        typeof parsed.openAtLogin === 'boolean' ? parsed.openAtLogin : defaults.openAtLogin,
      clearOfficeFontCache:
        typeof parsed.clearOfficeFontCache === 'boolean'
          ? parsed.clearOfficeFontCache
          : defaults.clearOfficeFontCache,
      clearAdobeFontCache:
        typeof parsed.clearAdobeFontCache === 'boolean'
          ? parsed.clearAdobeFontCache
          : defaults.clearAdobeFontCache,
      autoReinstallOnUpdate,
      skipCacheClearOnReinstall:
        typeof parsed.skipCacheClearOnReinstall === 'boolean'
          ? parsed.skipCacheClearOnReinstall
          : defaults.skipCacheClearOnReinstall,
      nativeNotifications:
        typeof parsed.nativeNotifications === 'boolean'
          ? parsed.nativeNotifications
          : defaults.nativeNotifications,
      onboardingCompleted:
        typeof parsed.onboardingCompleted === 'boolean' ? parsed.onboardingCompleted : true,
      revisionBudgetBytes:
        typeof parsed.revisionBudgetBytes === 'number'
          ? parsed.revisionBudgetBytes
          : defaults.revisionBudgetBytes,
      activityRetentionDays:
        typeof parsed.activityRetentionDays === 'number'
          ? parsed.activityRetentionDays
          : defaults.activityRetentionDays,
      activityMaxOperations:
        typeof parsed.activityMaxOperations === 'number'
          ? parsed.activityMaxOperations
          : defaults.activityMaxOperations,
      specimen: readSpecimen(parsed.specimen),
      defaultDestination: parseDefaultDestination(parsed.defaultDestination),
      savedFilters: normalizeSavedFilters(parsed.savedFilters),
      retailSync: readRetailSync(parsed.retailSync),
    }
    return syncWatchFolderPaths(settings)
  } catch {
    return emptySettings()
  }
}

export function saveSettings(paths: AppPaths, settings: AppSettings): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  const tmp = `${paths.settingsPath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(syncWatchFolderPaths({ ...settings }), null, 2))
  fs.renameSync(tmp, paths.settingsPath)
}

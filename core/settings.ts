import fs from 'node:fs'
import type { AppPaths } from './paths.ts'
import type { AppSettings, SortMode, ThemeMode, ViewLayout } from './types.ts'

const emptySettings = (): AppSettings => ({
  version: 1,
  watchFolders: [],
  defaultView: 'list',
  defaultSort: 'name',
  installAfterUpload: true,
  theme: 'system',
  menuBarIcon: true,
  openAtLogin: false,
  clearOfficeFontCache: true,
})

function isViewLayout(value: unknown): value is ViewLayout {
  return value === 'list' || value === 'grid'
}

function isSortMode(value: unknown): value is SortMode {
  return value === 'name' || value === 'installed'
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
    return {
      version: 1,
      watchFolders: readWatchFolders(parsed),
      defaultView: isViewLayout(parsed.defaultView) ? parsed.defaultView : defaults.defaultView,
      defaultSort: isSortMode(parsed.defaultSort) ? parsed.defaultSort : defaults.defaultSort,
      installAfterUpload:
        typeof parsed.installAfterUpload === 'boolean'
          ? parsed.installAfterUpload
          : defaults.installAfterUpload,
      theme: isThemeMode(parsed.theme) ? parsed.theme : defaults.theme,
      menuBarIcon:
        typeof parsed.menuBarIcon === 'boolean' ? parsed.menuBarIcon : defaults.menuBarIcon,
      openAtLogin:
        typeof parsed.openAtLogin === 'boolean' ? parsed.openAtLogin : defaults.openAtLogin,
      clearOfficeFontCache:
        typeof parsed.clearOfficeFontCache === 'boolean'
          ? parsed.clearOfficeFontCache
          : defaults.clearOfficeFontCache,
    }
  } catch {
    return emptySettings()
  }
}

export function saveSettings(paths: AppPaths, settings: AppSettings): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  const tmp = `${paths.settingsPath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2))
  fs.renameSync(tmp, paths.settingsPath)
}

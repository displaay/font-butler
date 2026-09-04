import fs from 'node:fs'
import type { AppPaths } from './paths.ts'
import type { AppSettings, SortMode, ThemeMode, ViewLayout } from './types.ts'

const emptySettings = (): AppSettings => ({
  version: 1,
  watchFolder: null,
  defaultView: 'list',
  defaultSort: 'name',
  installAfterUpload: true,
  theme: 'system',
  menuBarIcon: true,
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

export function loadSettings(paths: AppPaths): AppSettings {
  if (!fs.existsSync(paths.settingsPath)) {
    return emptySettings()
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.settingsPath, 'utf8')) as Partial<AppSettings>
    if (!parsed || parsed.version !== 1) {
      return emptySettings()
    }
    const defaults = emptySettings()
    return {
      version: 1,
      watchFolder:
        typeof parsed.watchFolder === 'string' && parsed.watchFolder.trim()
          ? parsed.watchFolder
          : null,
      defaultView: isViewLayout(parsed.defaultView) ? parsed.defaultView : defaults.defaultView,
      defaultSort: isSortMode(parsed.defaultSort) ? parsed.defaultSort : defaults.defaultSort,
      installAfterUpload:
        typeof parsed.installAfterUpload === 'boolean'
          ? parsed.installAfterUpload
          : defaults.installAfterUpload,
      theme: isThemeMode(parsed.theme) ? parsed.theme : defaults.theme,
      menuBarIcon:
        typeof parsed.menuBarIcon === 'boolean' ? parsed.menuBarIcon : defaults.menuBarIcon,
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

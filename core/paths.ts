import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const projectRoot = path.resolve(here, '..')

export const APP_FOLDER_NAME = 'Font Buttler'
export const LEGACY_APP_FOLDER_NAME = 'Font Butler'

export function isMac(): boolean {
  return process.platform === 'darwin'
}

export type AppPaths = {
  dataRoot: string
  catalogPath: string
  settingsPath: string
  apiTokenPath: string
  installDir: string
  disabledDir: string
  sourcesDir: string
  uploadsDir: string
  systemCachePath: string
  seedDir: string
  userFontsDir: string
  computerFontsDir: string
  systemFontsDir: string
  supplementalFontsDir: string
  officeFontCacheDir: string
  atsCacheDir: string
}

function rewritePathPrefix(value: string | undefined, from: string, to: string): string | undefined {
  if (!value || !from || from === to) return value
  if (value === from) return to
  const prefix = from.endsWith(path.sep) ? from : from + path.sep
  if (value.startsWith(prefix)) return to + value.slice(from.length)
  return value
}

function isFreshDataRoot(dir: string): boolean {
  if (!fs.existsSync(dir)) return true
  return (
    !fs.existsSync(path.join(dir, 'catalog.json')) && !fs.existsSync(path.join(dir, 'settings.json'))
  )
}

function isEmptyDir(dir: string): boolean {
  if (!fs.existsSync(dir)) return true
  try {
    return fs.readdirSync(dir).length === 0
  } catch {
    return false
  }
}

export function migrateDir(from: string, to: string, unused: (dir: string) => boolean): boolean {
  if (!from || from === to || !fs.existsSync(from)) return false
  if (fs.existsSync(to) && !unused(to)) return false
  fs.mkdirSync(path.dirname(to), { recursive: true })
  if (fs.existsSync(to)) {
    fs.rmSync(to, { recursive: true, force: true })
  }
  fs.renameSync(from, to)
  return true
}

export function rewriteCatalogLegacyPaths(
  catalogPath: string,
  replacements: Array<{ from: string; to: string }>,
): void {
  if (!fs.existsSync(catalogPath)) return
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
      entries?: Array<{
        sourcePath?: string
        installedPath?: string
        disabledPath?: string
      }>
    }
    if (!Array.isArray(parsed.entries)) return
    let changed = false
    for (const entry of parsed.entries) {
      for (const key of ['sourcePath', 'installedPath', 'disabledPath'] as const) {
        const current = entry[key]
        let next = current
        for (const { from, to } of replacements) {
          next = rewritePathPrefix(next, from, to)
        }
        if (next !== current) {
          entry[key] = next
          changed = true
        }
      }
    }
    if (changed) {
      fs.writeFileSync(catalogPath, JSON.stringify(parsed, null, 2))
    }
  } catch {
    // Keep the catalog as-is if it cannot be rewritten.
  }
}

export function migrateLegacyMacAppDirs(home: string): { dataRoot: string; installDir: string } {
  const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const installDir = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  const legacyDataRoot = path.join(home, 'Library/Application Support', LEGACY_APP_FOLDER_NAME)
  const legacyInstallDir = path.join(home, 'Library/Fonts', LEGACY_APP_FOLDER_NAME)

  const movedData = migrateDir(legacyDataRoot, dataRoot, isFreshDataRoot)
  const movedInstall = migrateDir(legacyInstallDir, installDir, isEmptyDir)
  if (movedData || movedInstall) {
    rewriteCatalogLegacyPaths(path.join(dataRoot, 'catalog.json'), [
      { from: legacyInstallDir, to: installDir },
      { from: legacyDataRoot, to: dataRoot },
    ])
  }
  return { dataRoot, installDir }
}

export function getPaths(): AppPaths {
  const home = os.homedir()
  const override = process.env.FONT_BUTLER_DATA ?? process.env.FONTCASE_DATA
  const migrated =
    !override && isMac()
      ? migrateLegacyMacAppDirs(home)
      : {
          dataRoot: override ?? path.join(projectRoot, '.font-butler-data'),
          installDir: '',
        }
  const dataRoot = migrated.dataRoot
  const userFontsDir = isMac()
    ? path.join(home, 'Library/Fonts')
    : path.join(home, '.local/share/fonts')
  const installDir = isMac() ? userFontsDir : path.join(dataRoot, 'installed')

  return {
    dataRoot,
    catalogPath: path.join(dataRoot, 'catalog.json'),
    settingsPath: path.join(dataRoot, 'settings.json'),
    apiTokenPath: path.join(dataRoot, 'api-token'),
    installDir,
    disabledDir: path.join(dataRoot, 'Disabled'),
    sourcesDir: path.join(dataRoot, 'sources'),
    uploadsDir: path.join(dataRoot, 'uploads'),
    systemCachePath: path.join(dataRoot, 'system-cache.json'),
    seedDir: path.join(projectRoot, 'seed-fonts'),
    userFontsDir,
    computerFontsDir: isMac() ? '/Library/Fonts' : '/usr/local/share/fonts',
    systemFontsDir: isMac() ? '/System/Library/Fonts' : '/usr/share/fonts',
    supplementalFontsDir: isMac()
      ? '/System/Library/Fonts/Supplemental'
      : '/usr/share/fonts',
    officeFontCacheDir: path.join(
      home,
      'Library/Group Containers/UBF8T346G9.Office/FontCache',
    ),
    atsCacheDir: path.join(home, 'Library/Caches/com.apple.ATS'),
  }
}

export function ensureDirs(paths: AppPaths): void {
  for (const dir of [
    paths.dataRoot,
    paths.installDir,
    paths.disabledDir,
    paths.sourcesDir,
    paths.uploadsDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_FOLDER_NAME,
  LEGACY_APP_FOLDER_NAME,
  PREVIOUS_APP_FOLDER_NAME,
  adoptedMigrationDataRoot,
  migrationAlreadyHandled,
  isFreshDataRoot,
  migrateLegacyMacAppDirs,
  rewriteCatalogLegacyPaths,
} from '../electron/mac-data-migration.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const projectRoot = path.resolve(here, '..')

export {
  APP_FOLDER_NAME,
  LEGACY_APP_FOLDER_NAME,
  PREVIOUS_APP_FOLDER_NAME,
  isFreshDataRoot,
  migrateLegacyMacAppDirs,
  rewriteCatalogLegacyPaths,
}

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
  adobeFontsDir: string
}

export function buildPaths(options: {
  home?: string
  override?: string
  mac?: boolean
}): AppPaths {
  const home = options.home ?? os.homedir()
  const override = options.override
  const mac = options.mac ?? isMac()
  const handled = !override && migrationAlreadyHandled()
  const adopted = !override ? adoptedMigrationDataRoot() : null
  const migrated = handled || adopted
    ? {
        dataRoot: adopted ?? path.join(home, 'Library/Application Support', APP_FOLDER_NAME),
        installDir: path.join(home, 'Library/Fonts', APP_FOLDER_NAME),
        stalled: Boolean(adopted),
        stalledDataDir: adopted,
      }
    : !override && mac
      ? migrateLegacyMacAppDirs(home)
      : {
          dataRoot: override ?? path.join(projectRoot, '.font-butler-data'),
          installDir: '',
          stalled: false,
          stalledDataDir: null as string | null,
        }
  const dataRoot =
    !adopted && migrated.stalled && migrated.stalledDataDir ? migrated.stalledDataDir : migrated.dataRoot
  const isolated = Boolean(override)
  const userFontsDir = isolated
    ? path.join(dataRoot, 'user-fonts')
    : mac
      ? path.join(home, 'Library/Fonts')
      : path.join(home, '.local/share/fonts')
  const installDir = isolated
    ? mac
      ? userFontsDir
      : path.join(dataRoot, 'installed')
    : mac
      ? userFontsDir
      : path.join(dataRoot, 'installed')

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
    computerFontsDir: isolated
      ? path.join(dataRoot, 'computer-fonts')
      : mac
        ? '/Library/Fonts'
        : '/usr/local/share/fonts',
    systemFontsDir: isolated
      ? path.join(dataRoot, 'system-fonts')
      : mac
        ? '/System/Library/Fonts'
        : '/usr/share/fonts',
    supplementalFontsDir: isolated
      ? path.join(dataRoot, 'supplemental')
      : mac
        ? '/System/Library/Fonts/Supplemental'
        : '/usr/share/fonts',
    officeFontCacheDir: isolated
      ? path.join(dataRoot, 'office-cache')
      : path.join(home, 'Library/Group Containers/UBF8T346G9.Office/FontCache'),
    atsCacheDir: isolated
      ? path.join(dataRoot, 'ats-cache')
      : path.join(home, 'Library/Caches/com.apple.ATS'),
    adobeFontsDir: isolated
      ? path.join(dataRoot, 'adobe-fonts')
      : process.env.FONT_BUTLER_ADOBE_FONTS || path.join('/Library/Application Support/Adobe/Fonts'),
  }
}

export function getPaths(): AppPaths {
  return buildPaths({
    home: os.homedir(),
    override: process.env.FONT_BUTLER_DATA ?? process.env.FONTCASE_DATA,
    mac: isMac(),
  })
}

export function revisionsDir(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'revisions')
}

export function operationsPath(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'operations.json')
}

export function projectsPath(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'projects.json')
}

export function plansDir(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'plans')
}

export function retailManifestPath(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'retail-manifest.json')
}

/** Cached retail downloads that are not yet (or no longer) in Fonts. */
export function retailCacheDir(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'retail-cache')
}

export function retailTokenPath(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'retail-token')
}

export function journalPath(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'mutation-journal.json')
}

export function journalDir(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'journal')
}

export function ensureDirs(paths: AppPaths): void {
  for (const dir of [
    paths.dataRoot,
    paths.installDir,
    paths.disabledDir,
    paths.sourcesDir,
    paths.uploadsDir,
    revisionsDir(paths),
    plansDir(paths),
    journalDir(paths),
  ]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

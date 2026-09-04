import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const projectRoot = path.resolve(here, '..')

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

export function getPaths(): AppPaths {
  const home = os.homedir()
  const override = process.env.FONT_BUTLER_DATA ?? process.env.FONTCASE_DATA
  const dataRoot =
    override ??
    (isMac()
      ? path.join(home, 'Library/Application Support/Font Butler')
      : path.join(projectRoot, '.font-butler-data'))

  const installDir = isMac()
    ? path.join(home, 'Library/Fonts/Font Butler')
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
    userFontsDir: isMac()
      ? path.join(home, 'Library/Fonts')
      : path.join(home, '.local/share/fonts'),
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

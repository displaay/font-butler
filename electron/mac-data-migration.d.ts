export const APP_FOLDER_NAME: string
export const PREVIOUS_APP_FOLDER_NAME: string
export const LEGACY_APP_FOLDER_NAME: string
export const LEGACY_APP_FOLDER_NAMES: readonly string[]
export const FOLDER_MIGRATION_FILE: string

export type MacDirMigrationHooks = {
  renameSync?: (from: string, to: string) => void
  copyFileSync?: (from: string, to: string) => void
}

export type MacDataMigration = {
  dataRoot: string
  installDir: string
  stalled: boolean
  stalledDataDir: string | null
  stalledFontsDir: string | null
  /** False when a move failed and the destination was not already in use. */
  dataOccupied: boolean
  fontsOccupied: boolean
  movedData: boolean
  movedFonts: boolean
}

export function isFreshDataRoot(dir: string): boolean
export function isEmptyDir(dir: string): boolean
export function moveDirectoryAtomic(from: string, to: string, hooks?: MacDirMigrationHooks): void
export function rewriteCatalogLegacyPaths(
  catalogPath: string,
  replacements: Array<{ from: string; to: string }>,
): void
export function migrationStallMessage(result: MacDataMigration | null | undefined): string
export function migrateLegacyMacAppDirs(home: string, hooks?: MacDirMigrationHooks): MacDataMigration

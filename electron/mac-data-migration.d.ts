export const APP_FOLDER_NAME: string
export const PREVIOUS_APP_FOLDER_NAME: string
export const LEGACY_APP_FOLDER_NAME: string
export const LEGACY_APP_FOLDER_NAMES: readonly string[]
export const FOLDER_MIGRATION_FILE: string
export const PENDING_MIGRATION_FILE: string
export const MIGRATION_STALL_ENV: string
export const MIGRATION_DATA_ROOT_ENV: string
export const MIGRATION_HANDLED_ENV: string

export type MacDirMigrationHooks = {
  renameSync?: (from: string, to: string) => void
  copyFileSync?: (from: string, to: string) => void
  failRewrite?: boolean
  crashAfterDataMove?: boolean
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
export function rewriteJsonLegacyPaths(
  filePath: string,
  replacements: Array<{ from: string; to: string }>,
): void
export function adoptedMigrationDataRoot(env?: NodeJS.ProcessEnv): string | null
export function migrationAlreadyHandled(env?: NodeJS.ProcessEnv): boolean
export function shouldMigrateRealMacLibrary(input?: {
  platform?: string
  testFeed?: boolean
  env?: NodeJS.ProcessEnv
}): boolean
export function rewriteCatalogLegacyPaths(
  catalogPath: string,
  replacements: Array<{ from: string; to: string }>,
): void
export function migrationStallMessage(result: MacDataMigration | null | undefined): string
export function migrateLegacyMacAppDirs(home: string, hooks?: MacDirMigrationHooks): MacDataMigration

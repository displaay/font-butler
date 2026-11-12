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
  selfPid?: number
  isAlive?: (pid: number) => boolean
  cookieHeld?: (cookiePath: string, pid?: number) => boolean | null
  ownerWaitMs?: number
  ownerPollMs?: number
  sleepSync?: (ms: number) => void
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
  /** True when a running 0.4.0-style owner still holds the legacy library. */
  blockedByOwner: boolean
  ownerPid: number | null
  ownerDataDir: string | null
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
export function launchAfterMigrationFailure(home: string): {
  blockWorker: boolean
  stalled: boolean
  stalledDataDir: string | null
  dataRoot: string | null
  installDir: string
}
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
export function readSingletonLockPid(lockPath: string): number | null
export function singletonCookieHeld(cookiePath: string): boolean | null
export function legacyLibraryHasRunningOwner(
  dir: string,
  hooks?: {
    selfPid?: number
    isAlive?: (pid: number) => boolean
    cookieHeld?: (cookiePath: string, pid?: number) => boolean | null
  },
): boolean
export function findLegacyLibraryOwner(
  home: string,
  hooks?: MacDirMigrationHooks,
): { dir: string; pid: number | null } | null
export function legacyOwnerBlockMessage(result: {
  ownerDataDir?: string | null
} | null | undefined): string
export function migrateLegacyMacAppDirs(home: string, hooks?: MacDirMigrationHooks): MacDataMigration

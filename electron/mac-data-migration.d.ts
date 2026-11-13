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
  /** Source removal after a committed cross-device copy. Tests use this to fail partway. */
  rmSync?: (target: string, options: { recursive: boolean; force: boolean }) => void
  failRewrite?: boolean
  crashAfterDataMove?: boolean
  /** Throw after the verified copy is renamed into place and recorded, before source removal. */
  crashAfterCopyCommit?: boolean
  /** Called with the temp directory before a cross-device copy starts. */
  onPartialDir?: (dir: string) => void
  /** Fonts folder rename. Tests force EXDEV, EACCES, or a kill after the rename. */
  fontRenameSync?: (from: string, to: string) => void
  /** Throw after the fonts rename and before the placed record is written. */
  crashAfterFontRename?: boolean
  /** Throw after the rename into place and before the committed flag is written. */
  crashBeforeCommitRecord?: boolean
  /** Throw instead of writing the committed flag. The copy is already in place. */
  failCommitRecord?: boolean
  selfPid?: number
  isAlive?: (pid: number) => boolean
  cookieHeld?: (cookiePath: string, pid?: number) => boolean | null
  ownerWaitMs?: number
  ownerPollMs?: number
  sleepSync?: (ms: number) => void
  execPath?: string
  /** True when pid is this exact binary. Null when that cannot be known. */
  isSameExecutable?: (pid: number) => boolean | null
  /** True when pid is Cuttler, Font Buttler, Font Butler, or Electron. False for any other process. */
  isAppProcess?: (pid: number) => boolean | null
}

export type MacDataMigration = {
  dataRoot: string
  installDir: string
  stalled: boolean
  stalledDataDir: string | null
  stalledFontsDir: string | null
  /**
   * Source folder still on disk after the destination copy was committed.
   * The library is dataRoot / installDir. This path is not adopted.
   */
  leftoverDataDir?: string | null
  leftoverFontsDir?: string | null
  /** The Cuttler data folder is an uncommitted copy of the library still in use. */
  unfinishedDataCopy?: boolean
  leftoverDataDestEmpty?: boolean
  leftoverFontsDestEmpty?: boolean
  /** False when a move failed and the destination was not already in use. */
  dataOccupied: boolean
  fontsOccupied: boolean
  movedData: boolean
  movedFonts: boolean
  /** True when a running 0.4.0-style owner still holds the legacy library. */
  blockedByOwner: boolean
  ownerPid: number | null
  ownerDataDir: string | null
  /**
   * Set when this exact executable already holds the legacy lock. The caller
   * keeps userData there so Electron's single-instance lock can hand off,
   * and does not move the folder.
   */
  runningInstanceDataDir: string | null
}

export function isFreshDataRoot(dir: string): boolean
export function isEmptyDir(dir: string): boolean
export function moveDirectoryAtomic(from: string, to: string, hooks?: MacDirMigrationHooks): string | null
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
export function migrationAnnouncementFlags(result: MacDataMigration | null | undefined): {
  migrationStalled: boolean
  migrationLeftover: boolean
}
export function committedLeftoverDirectories(home: string): string[]
export function readSingletonLockPid(lockPath: string): number | null
export function singletonCookieHeld(cookiePath: string): boolean | null
export function isLegacyAppExecutable(exePath: string): boolean
export function legacyLibraryHasRunningOwner(dir: string, hooks?: MacDirMigrationHooks): boolean
export function findLegacyLibraryOwner(
  home: string,
  hooks?: MacDirMigrationHooks,
): { dir: string; pid: number | null; kind: 'legacy' | 'same-app' } | null
export function legacyOwnerBlockMessage(result: {
  ownerDataDir?: string | null
} | null | undefined): string
export function migrateLegacyMacAppDirs(home: string, hooks?: MacDirMigrationHooks): MacDataMigration

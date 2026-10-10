import fs from 'node:fs'
import path from 'node:path'
import { logMain } from './main-log.ts'
import { projectRoot } from './paths.ts'

/** Packaged test builds stamp this beside the app resources. The repo copy stays false. */
export const PACKAGED_BUILD_IDENTITY_FILE = 'build-identity.json'

export type BuildIdentity = {
  testBuild: boolean
}

/**
 * Dev and unpackaged reads: only a boolean `true` enables the logout probe.
 * A string, a number, a missing field, or bad JSON stays off.
 * A packaged `.app` does not use this fail-open result.
 */
export function parseBuildIdentity(raw: string): BuildIdentity {
  try {
    const parsed = JSON.parse(raw) as { testBuild?: unknown }
    if (parsed && typeof parsed === 'object' && parsed.testBuild === true) {
      return { testBuild: true }
    }
  } catch {
    // Unreadable identity never enables the probe.
  }
  return { testBuild: false }
}

export function isLogoutProbeEnabled(identity: { testBuild?: boolean } | null | undefined): boolean {
  return identity?.testBuild === true
}

/**
 * A stamped test build offers the probe after a real clear and after a
 * simulated clear. A clear that did not run stays closed, and so does a
 * release file.
 */
export function cacheClearLogoutProbe(
  result: { cleared?: boolean; simulated?: boolean },
  identity: { testBuild?: boolean } | null | undefined,
): boolean {
  if (!isLogoutProbeEnabled(identity)) return false
  const simulated = result.simulated === true && result.cleared !== true
  const cleared = result.cleared === true && result.simulated !== true
  return simulated || cleared
}

/**
 * Outermost `.app` that contains `start`. A nested helper stops at the
 * application bundle, and the walk does not continue to the parent of that bundle.
 */
export function enclosingAppBundle(start: string): string | null {
  let dir = start
  let found: string | null = null
  for (;;) {
    if (path.basename(dir).endsWith('.app')) found = dir
    const parent = path.dirname(dir)
    if (parent === dir) return found
    if (found) {
      const higher = parent.split(path.sep).some((part) => part.endsWith('.app'))
      if (!higher) return found
    }
    dir = parent
  }
}

let prependedIdentityCandidates: readonly string[] = []

/** Tests point this at a temp `build-identity.json`. Production leaves it empty. */
export function setBuildIdentityCandidatesForTests(candidates: readonly string[] | null): void {
  prependedIdentityCandidates = candidates ?? []
}

export type BuildIdentityLocations = {
  resourcesPath?: string
  execPath?: string
}

let locationOverride: BuildIdentityLocations | null = null

/** Tests pretend the process is inside a chosen app. Production leaves this empty. */
export function setBuildIdentityLocationsForTests(locations: BuildIdentityLocations | null): void {
  locationOverride = locations
}

/** `npm run electron` runs inside Electron.app and stays on the dev stamp. */
const DEV_ELECTRON_BUNDLE = 'Electron.app'

/**
 * One log line per process when a packaged stamp cannot be trusted.
 * The app then behaves as a test build.
 */
export const PACKAGED_BUILD_IDENTITY_FAILURE_LOG =
  'packaged build identity is unusable; treating this app as a test build'

let packagedIdentityFailureLogged = false

/** Tests start a fresh "log once" window. */
export function resetPackagedBuildIdentityLogForTests(): void {
  packagedIdentityFailureLogged = false
}

function logPackagedIdentityFailure(reason: string): void {
  if (packagedIdentityFailureLogged) return
  packagedIdentityFailureLogged = true
  logMain('install', `${PACKAGED_BUILD_IDENTITY_FAILURE_LOG} (${reason})`)
}

function identityLocations(locations: BuildIdentityLocations = {}): BuildIdentityLocations {
  if (!locationOverride) return locations
  return { ...locationOverride, ...locations }
}

/**
 * Outermost `.app` for this process, excluding the Electron dev binary.
 * A nested helper resolves to the application bundle.
 */
export function packagedAppBundle(locations: BuildIdentityLocations = {}): string | null {
  const resolved = identityLocations(locations)
  const resources =
    resolved.resourcesPath ??
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const execPath = resolved.execPath ?? process.execPath
  let bundle: string | null = null
  if (typeof resources === 'string' && resources.length > 0) {
    bundle = enclosingAppBundle(resources)
  }
  if (!bundle && typeof execPath === 'string' && execPath.length > 0) {
    bundle = enclosingAppBundle(path.dirname(execPath))
  }
  if (!bundle || path.basename(bundle) === DEV_ELECTRON_BUNDLE) return null
  return bundle
}

/** The only stamp a packaged app reads. Dev and Electron.app return null. */
export function packagedBuildIdentityPath(locations: BuildIdentityLocations = {}): string | null {
  const bundle = packagedAppBundle(locations)
  if (!bundle) return null
  return path.join(bundle, 'Contents', 'Resources', PACKAGED_BUILD_IDENTITY_FILE)
}

/**
 * Inside a packaged `.app`, the only file is that bundle's
 * `Contents/Resources/build-identity.json`. There is no fallback.
 * Dev, tests, and `Electron.app` still fall through to `build/build-identity.json`.
 * Environment variables are not consulted.
 */
export function buildIdentityCandidates(
  root = projectRoot,
  locations: BuildIdentityLocations = {},
): string[] {
  const packaged = packagedBuildIdentityPath(locations)
  if (packaged) return [packaged]
  const resolved = identityLocations(locations)
  const resources =
    resolved.resourcesPath ??
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const execPath = resolved.execPath ?? process.execPath
  const candidates: string[] = []
  if (typeof resources === 'string' && resources.length > 0) {
    candidates.push(path.join(resources, PACKAGED_BUILD_IDENTITY_FILE))
  } else if (typeof execPath === 'string' && execPath.length > 0) {
    const bundle = enclosingAppBundle(path.dirname(execPath))
    if (bundle) {
      candidates.push(path.join(bundle, 'Contents', 'Resources', PACKAGED_BUILD_IDENTITY_FILE))
    }
  }
  candidates.push(path.join(root, 'build', PACKAGED_BUILD_IDENTITY_FILE))
  return [...prependedIdentityCandidates, ...candidates]
}

export function loadBuildIdentityFrom(
  candidates: readonly string[],
  read: (filePath: string) => string | null,
): BuildIdentity {
  for (const candidate of candidates) {
    const raw = read(candidate)
    if (raw == null) continue
    return parseBuildIdentity(raw)
  }
  return { testBuild: false }
}

/**
 * Packaged stamp. Missing, unreadable, unparseable, and non-boolean values
 * are a test build. Boolean false stays a release. Boolean true stays a test build.
 */
export function readPackagedBuildIdentity(filePath: string): BuildIdentity {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    logPackagedIdentityFailure(code === 'ENOENT' ? 'missing' : 'unreadable')
    return { testBuild: true }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    logPackagedIdentityFailure('unparseable')
    return { testBuild: true }
  }
  const testBuild =
    parsed && typeof parsed === 'object' ? (parsed as { testBuild?: unknown }).testBuild : undefined
  if (typeof testBuild !== 'boolean') {
    logPackagedIdentityFailure('non-boolean')
    return { testBuild: true }
  }
  return { testBuild }
}

export function loadBuildIdentity(root = projectRoot): BuildIdentity {
  const packaged = packagedBuildIdentityPath()
  if (packaged) return readPackagedBuildIdentity(packaged)
  return loadBuildIdentityFrom(buildIdentityCandidates(root), (filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf8')
    } catch {
      return null
    }
  })
}

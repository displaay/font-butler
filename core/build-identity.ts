import fs from 'node:fs'
import path from 'node:path'
import { projectRoot } from './paths.ts'

/** Packaged test builds stamp this beside the app resources. The repo copy stays false. */
export const PACKAGED_BUILD_IDENTITY_FILE = 'build-identity.json'

export type BuildIdentity = {
  testBuild: boolean
}

/**
 * Only a boolean `true` enables the logout probe.
 * A string, a number, or a missing field stays off.
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

/**
 * Packaged apps read `Contents/Resources/build-identity.json` first.
 * When `resourcesPath` is missing, the executable is resolved only inside its
 * outermost `.app` bundle. A nested helper still sees that bundle's
 * `Contents/Resources` file, and the walk does not continue outside the bundle.
 * Dev and tests fall through to
 * `build/build-identity.json`. Environment variables are not consulted.
 */
export function buildIdentityCandidates(
  root = projectRoot,
  locations: { resourcesPath?: string; execPath?: string } = {},
): string[] {
  const resources =
    locations.resourcesPath ??
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const execPath = locations.execPath ?? process.execPath
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

export function loadBuildIdentity(root = projectRoot): BuildIdentity {
  return loadBuildIdentityFrom(buildIdentityCandidates(root), (filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf8')
    } catch {
      return null
    }
  })
}

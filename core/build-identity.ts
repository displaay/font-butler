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
 * The simulated-clear dialog offers the probe only for a stamped test build.
 * A release file, and a simulated clear without that stamp, stay closed.
 */
export function cacheClearLogoutProbe(
  result: { cleared?: boolean; simulated?: boolean },
  identity: { testBuild?: boolean } | null | undefined,
): boolean {
  return result.simulated === true && result.cleared !== true && isLogoutProbeEnabled(identity)
}

/**
 * Packaged apps read `Contents/Resources/build-identity.json` first.
 * A utility process may not publish `resourcesPath`, so the executable path
 * is walked up to that same Resources file. Dev and tests fall through to
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
  }
  if (typeof execPath === 'string' && execPath.length > 0) {
    let dir = path.dirname(execPath)
    for (let i = 0; i < 6; i += 1) {
      candidates.push(path.join(dir, 'Resources', PACKAGED_BUILD_IDENTITY_FILE))
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  candidates.push(path.join(root, 'build', PACKAGED_BUILD_IDENTITY_FILE))
  return candidates
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

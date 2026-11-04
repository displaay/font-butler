import fs from 'node:fs'
import path from 'node:path'
import { findById, loadCatalog } from './catalog.ts'
import type { AppPaths } from './paths.ts'
import { hasActivationDemand } from './projects.ts'

/**
 * Faces turned on with Activate until quit.
 * This list is not an activation owner. A manual install or a project that still
 * wants the face stays on when the list is cleared.
 */
type SessionActivationFile = {
  version: 1
  ids: string[]
}

export function sessionActivationsPath(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'session-activations.json')
}

export function loadSessionActivationIds(paths: AppPaths): string[] {
  const file = sessionActivationsPath(paths)
  if (!fs.existsSync(file)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SessionActivationFile>
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.ids)) return []
    return [
      ...new Set(parsed.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
    ]
  } catch {
    return []
  }
}

export function saveSessionActivationIds(paths: AppPaths, ids: string[]): void {
  const file = sessionActivationsPath(paths)
  const unique = [...new Set(ids)]
  if (unique.length === 0) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true })
    return
  }
  const tmp = `${file}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, ids: unique } satisfies SessionActivationFile, null, 2))
  fs.renameSync(tmp, file)
}

export function rememberSessionActivation(paths: AppPaths, ids: string[]): void {
  if (ids.length === 0) return
  const next = new Set(loadSessionActivationIds(paths))
  for (const id of ids) {
    if (id.trim()) next.add(id)
  }
  saveSessionActivationIds(paths, [...next])
}

export function forgetSessionActivation(paths: AppPaths, ids: string[]): void {
  if (ids.length === 0) return
  const current = loadSessionActivationIds(paths)
  if (current.length === 0) return
  const drop = new Set(ids)
  if (!current.some((id) => drop.has(id))) return
  saveSessionActivationIds(
    paths,
    current.filter((id) => !drop.has(id)),
  )
}

export async function releaseRecordedSessionActivations(
  paths: AppPaths,
  deactivate: (id: string) => Promise<void>,
): Promise<{ released: string[]; pending: string[] }> {
  const ids = loadSessionActivationIds(paths)
  const released: string[] = []
  const pending: string[] = []
  for (const id of ids) {
    const entry = findById(loadCatalog(paths), id)
    if (!entry || hasActivationDemand(entry)) continue
    if (entry.status !== 'installed' && entry.status !== 'outdated') continue
    try {
      await deactivate(id)
      released.push(id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/not installed/i.test(message)) continue
      pending.push(id)
    }
  }
  saveSessionActivationIds(paths, pending)
  return { released, pending }
}

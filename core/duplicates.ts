import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AppPaths } from './paths.ts'
import type { DuplicateWarning } from './types.ts'

type DuplicateFile = {
  version: 1
  items: DuplicateWarning[]
}

type SkippedDuplicatesFile = {
  version: 1
  keys: string[]
}

function duplicatesPath(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'duplicates.json')
}

function skippedDuplicatesPath(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'skipped-duplicates.json')
}

export function loadDuplicates(paths: AppPaths): DuplicateWarning[] {
  const file = duplicatesPath(paths)
  if (!fs.existsSync(file)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as DuplicateFile
    if (!parsed || !Array.isArray(parsed.items)) return []
    return parsed.items
  } catch {
    return []
  }
}

function saveDuplicates(paths: AppPaths, items: DuplicateWarning[]): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  fs.writeFileSync(duplicatesPath(paths), JSON.stringify({ version: 1, items }, null, 2))
}

function loadSkippedKeys(paths: AppPaths): string[] {
  const file = skippedDuplicatesPath(paths)
  if (!fs.existsSync(file)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as SkippedDuplicatesFile
    if (!parsed || !Array.isArray(parsed.keys)) return []
    return parsed.keys.filter((key) => typeof key === 'string' && key.length > 0)
  } catch {
    return []
  }
}

function saveSkippedKeys(paths: AppPaths, keys: string[]): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  fs.writeFileSync(
    skippedDuplicatesPath(paths),
    JSON.stringify({ version: 1, keys: [...new Set(keys)] }, null, 2),
  )
}

export function isDuplicateSkipped(paths: AppPaths, notifyKey: string): boolean {
  if (!notifyKey) return false
  return loadSkippedKeys(paths).includes(notifyKey)
}

/** Remember a Skip so watch/adopt do not recreate the same conflict. */
export function rememberSkippedDuplicate(paths: AppPaths, notifyKey: string): void {
  if (!notifyKey) return
  const keys = loadSkippedKeys(paths)
  if (keys.includes(notifyKey)) return
  keys.push(notifyKey)
  saveSkippedKeys(paths, keys)
}

export function rememberSkippedDuplicates(paths: AppPaths, notifyKeys: string[]): void {
  const next = new Set(loadSkippedKeys(paths))
  let changed = false
  for (const key of notifyKeys) {
    if (!key || next.has(key)) continue
    next.add(key)
    changed = true
  }
  if (changed) saveSkippedKeys(paths, [...next])
}

export function duplicateNotifyKey(
  incomingPath: string,
  fingerprint: string | undefined,
  occupyingFingerprints: string[],
): string {
  const occupying = [...occupyingFingerprints].sort().join(',')
  return `${path.resolve(incomingPath)}|${fingerprint ?? ''}|${occupying}`
}

export function upsertDuplicateWarning(
  paths: AppPaths,
  incoming: Omit<DuplicateWarning, 'id' | 'createdAt' | 'updatedAt' | 'notifiedAt'> & {
    notifyKey: string
  },
): { warning: DuplicateWarning | undefined; notify: boolean } {
  if (isDuplicateSkipped(paths, incoming.notifyKey)) {
    return { warning: undefined, notify: false }
  }
  const items = loadDuplicates(paths)
  const existing = items.find(
    (item) =>
      item.notifyKey === incoming.notifyKey ||
      path.resolve(item.path) === path.resolve(incoming.path),
  )
  const now = Date.now()
  if (existing) {
    const sameConflict = existing.notifyKey === incoming.notifyKey
    existing.path = incoming.path
    existing.fingerprint = incoming.fingerprint
    existing.familyName = incoming.familyName
    existing.format = incoming.format
    existing.incomingVersion = incoming.incomingVersion
    existing.conflictingEntryIds = incoming.conflictingEntryIds
    existing.activeEntryId = incoming.activeEntryId
    existing.folderId = incoming.folderId
    existing.notifyKey = incoming.notifyKey
    existing.updatedAt = now
    if (!sameConflict) existing.notifiedAt = now
    saveDuplicates(paths, items)
    return { warning: existing, notify: !sameConflict }
  }
  const warning: DuplicateWarning = {
    id: crypto.randomUUID(),
    path: incoming.path,
    fingerprint: incoming.fingerprint,
    familyName: incoming.familyName,
    format: incoming.format,
    incomingVersion: incoming.incomingVersion,
    conflictingEntryIds: incoming.conflictingEntryIds,
    activeEntryId: incoming.activeEntryId,
    folderId: incoming.folderId,
    notifyKey: incoming.notifyKey,
    createdAt: now,
    updatedAt: now,
    notifiedAt: now,
  }
  items.push(warning)
  saveDuplicates(paths, items)
  return { warning, notify: true }
}

export function removeDuplicateWarning(paths: AppPaths, id: string): DuplicateWarning | undefined {
  const items = loadDuplicates(paths)
  const found = items.find((item) => item.id === id)
  saveDuplicates(
    paths,
    items.filter((item) => item.id !== id),
  )
  return found
}

export function removeDuplicateWarnings(paths: AppPaths, ids: string[]): DuplicateWarning[] {
  if (ids.length === 0) return []
  const idSet = new Set(ids)
  const items = loadDuplicates(paths)
  const removed = items.filter((item) => idSet.has(item.id))
  if (removed.length === 0) return []
  saveDuplicates(
    paths,
    items.filter((item) => !idSet.has(item.id)),
  )
  return removed
}

export function removeDuplicatesForPath(paths: AppPaths, filePath: string): void {
  const resolved = path.resolve(filePath)
  saveDuplicates(
    paths,
    loadDuplicates(paths).filter((item) => path.resolve(item.path) !== resolved),
  )
}

export function pruneStaleDuplicates(paths: AppPaths): DuplicateWarning[] {
  const items = loadDuplicates(paths)
  const skipped = new Set(loadSkippedKeys(paths))
  const next = items.filter(
    (item) => fs.existsSync(item.path) && !skipped.has(item.notifyKey),
  )
  if (next.length !== items.length) saveDuplicates(paths, next)
  return next
}

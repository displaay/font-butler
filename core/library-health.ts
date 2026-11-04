import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { faceIdentityKey, isExternalSource } from './catalog.ts'
import { entryFormat } from './formats.ts'
import { fingerprintFile } from './fingerprint.ts'
import { inspectSfntTables, parseFontFile } from './parse.ts'
import type { AppPaths } from './paths.ts'
import { inspectSourceAvailability } from './state.ts'
import type {
  CatalogEntry,
  LibraryHealthAction,
  LibraryHealthCopy,
  LibraryHealthFinding,
  LibraryHealthReport,
} from './types.ts'

function resolved(value: string | undefined): string | undefined {
  return value ? path.resolve(value) : undefined
}

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function isParkedPath(filePath: string, paths: AppPaths): boolean {
  const resolvedPath = path.resolve(filePath)
  const disabled = path.resolve(paths.disabledDir)
  return resolvedPath === disabled || resolvedPath.startsWith(disabled + path.sep)
}

type RawCopy = Omit<LibraryHealthCopy, 'role'> & { recordedFingerprint?: string }

function recordedFingerprintFor(entry: CatalogEntry, filePath: string, kind: RawCopy['kind']): string | undefined {
  const target = path.resolve(filePath)
  if (kind === 'source') return entry.sourceFingerprint
  for (const copy of entry.installations ?? []) {
    if (resolved(copy.path) === target || resolved(copy.parkedPath) === target) {
      if (copy.fingerprint) return copy.fingerprint
    }
  }
  return entry.installedFingerprint ?? entry.sourceFingerprint
}

/** Read-only per-file check: readable, SFNT sound, parses, fingerprint matches. */
function inspectCopy(entry: CatalogEntry, filePath: string, kind: RawCopy['kind']): RawCopy {
  const live = kind === 'installed'
  const base: RawCopy = {
    entryId: entry.id,
    path: filePath,
    kind,
    live,
    verifiedGood: false,
    damaged: false,
    recordedFingerprint: recordedFingerprintFor(entry, filePath, kind),
  }
  if (!fileExists(filePath)) return base
  try {
    fs.accessSync(filePath, fs.constants.R_OK)
  } catch {
    return { ...base, damaged: true, reason: 'The file is not readable.' }
  }
  const sfnt = inspectSfntTables(filePath)
  if (!sfnt.ok) return { ...base, damaged: true, reason: (sfnt as { reason: string }).reason }
  let parsedFaces: CatalogEntry['faces']
  try {
    parsedFaces = parseFontFile(filePath, { previewSample: false }).faces
  } catch (error) {
    return {
      ...base,
      damaged: true,
      reason: error instanceof Error ? error.message : 'The font file could not be parsed.',
    }
  }
  if (!parsedFaces || parsedFaces.length === 0) {
    return { ...base, damaged: true, reason: 'No faces could be read from the file.' }
  }
  const expectedKey = faceIdentityKey(entry.faces, entryFormat(entry))
  const parsedKey = faceIdentityKey(parsedFaces, entryFormat(entry))
  if (!expectedKey || !parsedKey || parsedKey !== expectedKey) {
    return { ...base, damaged: true, reason: 'The file does not contain the recorded faces.' }
  }
  if (!base.recordedFingerprint) {
    return { ...base, reason: 'No recorded fingerprint to verify against.' }
  }
  let actual: string
  try {
    actual = fingerprintFile(filePath)
  } catch {
    return { ...base, damaged: true, reason: 'The file could not be fingerprinted.' }
  }
  if (actual !== base.recordedFingerprint) {
    return { ...base, reason: 'The file bytes no longer match the recorded fingerprint.' }
  }
  return { ...base, verifiedGood: true }
}

function copiesOfEntry(entry: CatalogEntry, paths: AppPaths): RawCopy[] {
  const seen = new Map<string, RawCopy>()
  const add = (filePath: string | undefined, kind: RawCopy['kind']) => {
    if (!filePath || !fileExists(filePath)) return
    const key = path.resolve(filePath)
    const existing = seen.get(key)
    // A live installed copy outranks the same path described as a source.
    if (existing && !(existing.kind === 'source' && kind === 'installed')) return
    seen.set(key, inspectCopy(entry, filePath, kind))
  }
  add(entry.sourcePath, 'source')
  if (entry.installedPath) {
    add(entry.installedPath, isParkedPath(entry.installedPath, paths) ? 'parked' : 'installed')
  }
  if (entry.disabledPath) add(entry.disabledPath, 'parked')
  for (const copy of entry.installations ?? []) {
    if (copy.parkedPath) add(copy.parkedPath, 'parked')
    else if (copy.path) add(copy.path, isParkedPath(copy.path, paths) ? 'parked' : 'installed')
  }
  return [...seen.values()]
}

function keeperRank(copy: RawCopy): number {
  if (!copy.verifiedGood) return 99
  if (copy.kind === 'installed') return 0
  if (copy.kind === 'source') return 1
  return 2
}

/** Verified-good keeper: installed+readable → source-present+readable → parked+readable. */
export function pickKeeper(copies: RawCopy[]): RawCopy | undefined {
  return copies
    .filter((copy) => copy.verifiedGood)
    .sort((a, b) => keeperRank(a) - keeperRank(b) || a.entryId.localeCompare(b.entryId) || a.path.localeCompare(b.path))[0]
}

function findingId(group: string, faceKey: string | null, entryIds: string[]): string {
  const hash = crypto.createHash('sha256').update(`${group}\0${faceKey ?? ''}\0${[...entryIds].sort().join(',')}`).digest('hex').slice(0, 16)
  return `health-${hash}`
}

function familyOf(entries: CatalogEntry[]): string {
  const first = entries[0]
  return first?.customFamilyName?.trim() || first?.faces[0]?.familyName?.trim() || (first ? path.basename(first.sourcePath) : 'Font')
}

function withRoles(copies: RawCopy[], keeper: RawCopy | undefined): LibraryHealthCopy[] {
  return copies.map((copy) => ({
    entryId: copy.entryId,
    path: copy.path,
    kind: copy.kind,
    live: copy.live,
    verifiedGood: copy.verifiedGood,
    damaged: copy.damaged,
    ...(copy.reason ? { reason: copy.reason } : {}),
    role: keeper && copy.entryId === keeper.entryId && copy.path === keeper.path ? 'keeper' : keeper && copy.live ? 'extra' : 'copy',
  }))
}

/**
 * Read-only Library Health scan. Never writes the catalog or moves files.
 * Grouping key is `faceIdentityKey(faces, format)` — format included, so
 * alt-format pairs are never grouped (or auto-parked) here.
 */
export function scanLibraryHealth(entries: CatalogEntry[], paths: AppPaths): LibraryHealthReport {
  const copiesByEntry = new Map<string, RawCopy[]>()
  for (const entry of entries) copiesByEntry.set(entry.id, copiesOfEntry(entry, paths))
  const allCopies = [...copiesByEntry.values()].flat()
  const findings: LibraryHealthFinding[] = []

  const byFace = new Map<string, CatalogEntry[]>()
  for (const entry of entries) {
    const key = faceIdentityKey(entry.faces, entryFormat(entry))
    if (!key) continue
    const list = byFace.get(key) ?? []
    list.push(entry)
    byFace.set(key, list)
  }

  // Live-path ownership across entries: parking one entry must never move a
  // file that another entry is installed from (one shared file on disk).
  const livePathOwners = new Map<string, Set<string>>()
  for (const [entryId, copies] of copiesByEntry) {
    for (const copy of copies) {
      if (!copy.live) continue
      const key = path.resolve(copy.path)
      const owners = livePathOwners.get(key) ?? new Set<string>()
      owners.add(entryId)
      livePathOwners.set(key, owners)
    }
  }
  const hasUnsharedLiveCopy = (entryId: string): boolean =>
    (copiesByEntry.get(entryId) ?? []).some(
      (copy) => copy.live && (livePathOwners.get(path.resolve(copy.path))?.size ?? 0) <= 1,
    )
  const sharesLivePathWithOther = (entryId: string): boolean =>
    (copiesByEntry.get(entryId) ?? []).some(
      (copy) => copy.live && (livePathOwners.get(path.resolve(copy.path))?.size ?? 0) > 1,
    )

  // (1) Installed twice: same face+format live in more than one entry.
  for (const [faceKey, group] of byFace) {
    const liveEntries = group.filter((entry) =>
      (copiesByEntry.get(entry.id) ?? []).some((copy) => copy.live),
    )
    if (liveEntries.length < 2) continue
    const groupCopies = liveEntries.flatMap((entry) => copiesByEntry.get(entry.id) ?? [])
    const keeper = pickKeeper(groupCopies)
    const entryIds = liveEntries.map((entry) => entry.id)
    const actions: LibraryHealthAction[] = keeper
      ? liveEntries
          .filter((entry) => entry.id !== keeper.entryId && hasUnsharedLiveCopy(entry.id))
          .map((entry) => ({ kind: 'park-extra' as const, entryId: entry.id, label: 'Park extra copy' }))
      : []
    const sharedOnly = Boolean(keeper) && actions.length === 0 && liveEntries.some((entry) => sharesLivePathWithOther(entry.id))
    findings.push({
      id: findingId('installed-twice', faceKey, entryIds),
      group: 'installed-twice',
      faceIdentityKey: faceKey,
      format: entryFormat(liveEntries[0]!),
      familyName: familyOf(liveEntries),
      entryIds,
      copies: withRoles(groupCopies, keeper),
      ...(keeper ? { keeperEntryId: keeper.entryId } : {}),
      actions,
      reportOnly: !keeper || sharedOnly,
      ...(!keeper
        ? { reportReason: 'No verified-good copy of this face was found, so nothing is parked. Check the files and re-run the scan.' }
        : sharedOnly
          ? { reportReason: 'These entries share one installed file, so parking an extra would move the file the keeper is installed from. Nothing is parked.' }
          : {}),
    })
  }

  // (2) Missing source file.
  for (const entry of entries) {
    if (!isExternalSource(entry)) continue
    const availability = inspectSourceAvailability(entry.sourcePath, { linked: true, external: true })
    if (availability !== 'missing' && availability !== 'offline' && availability !== 'unreadable') continue
    const faceKey = faceIdentityKey(entry.faces, entryFormat(entry))
    const copies = copiesByEntry.get(entry.id) ?? []
    if (availability === 'offline') {
      findings.push({
        id: findingId('missing-source', faceKey, [entry.id]),
        group: 'missing-source',
        faceIdentityKey: faceKey,
        format: entryFormat(entry),
        familyName: familyOf([entry]),
        entryIds: [entry.id],
        copies: withRoles(copies, pickKeeper(copies)),
        actions: [],
        reportOnly: true,
        reportReason: 'The source drive is offline. Reconnect it and re-run the scan — nothing to fix yet.',
      })
      continue
    }
    // Keeper is face-wide (format included), not just this entry's copies.
    const faceCopies = faceKey
      ? allCopies.filter((copy) => {
          const owner = entries.find((item) => item.id === copy.entryId)
          return owner ? faceIdentityKey(owner.faces, entryFormat(owner)) === faceKey : false
        })
      : copies
    const keeper = pickKeeper(faceCopies)
    if (!keeper) {
      findings.push({
        id: findingId('missing-source', faceKey, [entry.id]),
        group: 'missing-source',
        faceIdentityKey: faceKey,
        format: entryFormat(entry),
        familyName: familyOf([entry]),
        entryIds: [entry.id],
        copies: withRoles(copies, undefined),
        actions: [],
        reportOnly: true,
        reportReason:
          'No verified-good copy of this face was found, so nothing is parked or removed. Relink a good file or restore it from a backup.',
      })
      continue
    }
    const entryCopyPaths = new Set(copies.map((copy) => path.resolve(copy.path)))
    const otherGoodDistinct = faceCopies.some(
      (copy) => copy.entryId !== entry.id && copy.verifiedGood && !entryCopyPaths.has(path.resolve(copy.path)),
    )
    const isKeeperEntry = keeper.entryId === entry.id
    const actions: LibraryHealthAction[] = [
      { kind: 'relink', entryId: entry.id, label: 'Relink to the moved file…' },
    ]
    // The verified-good keeper is never parked — not as the only copy, and
    // not while an extra stays installed. Parking also needs an unshared
    // live file so it cannot move a file another entry is installed from.
    if (copies.some((copy) => copy.live) && !isKeeperEntry && otherGoodDistinct && hasUnsharedLiveCopy(entry.id)) {
      actions.push({ kind: 'park-installed', entryId: entry.id, label: 'Park the installed copy' })
    }
    if (!isKeeperEntry && otherGoodDistinct) {
      actions.push({ kind: 'remove-entry', entryId: entry.id, label: 'Remove this catalog entry only' })
    }
    findings.push({
      id: findingId('missing-source', faceKey, [entry.id]),
      group: 'missing-source',
      faceIdentityKey: faceKey,
      format: entryFormat(entry),
      familyName: familyOf([entry]),
      entryIds: [entry.id],
      copies: withRoles(copies, keeper),
      keeperEntryId: keeper.entryId,
      actions,
      reportOnly: false,
      ...(availability === 'unreadable' ? { reportReason: 'The source file is present but unreadable.' } : {}),
    })
  }

  // (3) Damaged / unreadable files.
  const reportedDamaged = new Set<string>()
  for (const entry of entries) {
    const copies = copiesByEntry.get(entry.id) ?? []
    const damaged = copies.filter((copy) => copy.damaged)
    if (damaged.length === 0) continue
    const faceKey = faceIdentityKey(entry.faces, entryFormat(entry))
    const dedupe = `${faceKey ?? entry.id}:${entry.id}`
    if (reportedDamaged.has(dedupe)) continue
    reportedDamaged.add(dedupe)
    const goodElsewhere = allCopies.filter(
      (copy) => copy.verifiedGood && !(copy.entryId === entry.id && damaged.some((bad) => bad.path === copy.path)),
    ).filter((copy) => {
      if (!faceKey) return false
      const owner = entries.find((item) => item.id === copy.entryId)
      return owner ? faceIdentityKey(owner.faces, entryFormat(owner)) === faceKey : false
    })
    const keeper = pickKeeper(goodElsewhere)
    const actions: LibraryHealthAction[] = []
    if (keeper) {
      if (damaged.some((copy) => copy.live)) {
        actions.push({ kind: 'park-damaged', entryId: entry.id, label: 'Park the damaged copy' })
      }
      if (keeper.entryId !== entry.id) {
        actions.push({
          kind: 'install-good-copy',
          entryId: entry.id,
          goodEntryId: keeper.entryId,
          label: 'Park damaged and install the good copy',
        })
      }
      if (damaged.some((copy) => copy.kind === 'source')) {
        actions.push({ kind: 'relink', entryId: entry.id, label: 'Relink to an undamaged file…' })
      }
    }
    findings.push({
      id: findingId('damaged', faceKey, [entry.id]),
      group: 'damaged',
      faceIdentityKey: faceKey,
      format: entryFormat(entry),
      familyName: familyOf([entry]),
      entryIds: [entry.id],
      copies: withRoles(copies, keeper),
      ...(keeper ? { keeperEntryId: keeper.entryId } : {}),
      actions,
      reportOnly: !keeper,
      ...(keeper
        ? {}
        : {
            reportReason:
              'This damaged file is the only copy of this face, so it is left exactly where it is — never deleted. Restore it from a backup or relink a good file.',
          }),
    })
  }

  const counts = { 'installed-twice': 0, 'missing-source': 0, damaged: 0 } as LibraryHealthReport['counts']
  for (const finding of findings) counts[finding.group] += 1
  return { scannedAt: Date.now(), findings, counts }
}

/** All inspected copies for entries matching `faceKey` (format included). */
export function verifiedGoodCopiesForFace(
  entries: CatalogEntry[],
  paths: AppPaths,
  faceKey: string | null,
): LibraryHealthCopy[] {
  if (!faceKey) return []
  const good: LibraryHealthCopy[] = []
  for (const entry of entries) {
    if (faceIdentityKey(entry.faces, entryFormat(entry)) !== faceKey) continue
    for (const copy of copiesOfEntry(entry, paths)) {
      if (copy.verifiedGood) good.push({ ...copy, role: 'copy' })
    }
  }
  return good
}

/**
 * Keeper guard for parking: refuse when parking `entryId` would leave no
 * verified-good copy of the face outside that entry, or when `entryId` is
 * the designated keeper itself. Other entries' parked copies still count —
 * turning a font off never loses it — but the parked entry's own copies do
 * not satisfy the guard for an installed-twice fix.
 */
export function assertParkKeepsVerifiedGood(
  entries: CatalogEntry[],
  paths: AppPaths,
  faceKey: string | null,
  entryId: string,
  keeperEntryId?: string,
): void {
  if (!faceKey) throw new Error('This finding has no verified face identity, so nothing will be parked.')
  if (keeperEntryId && keeperEntryId === entryId) {
    throw new Error('That copy is the verified-good keeper for this face, so it will not be parked.')
  }
  const target = entries.find((entry) => entry.id === entryId)
  const targetCopies = target ? copiesOfEntry(target, paths) : []
  const targetPaths = new Set(targetCopies.map((copy) => path.resolve(copy.path)))
  const targetLivePaths = new Set(
    targetCopies.filter((copy) => copy.live).map((copy) => path.resolve(copy.path)),
  )
  // One file on disk can back two catalog entries. Parking the target would
  // rename that file out from under the other entry — refuse, whoever owns it.
  for (const other of entries) {
    if (other.id === entryId) continue
    const shared = copiesOfEntry(other, paths).some(
      (copy) => copy.live && targetLivePaths.has(path.resolve(copy.path)),
    )
    if (shared) {
      throw new Error(
        'That copy shares its installed file with another copy of this face, so parking it would move the file the other copy is installed from.',
      )
    }
  }
  // The surviving verified-good copy must be a different file, not the same
  // path under another entry id.
  const remaining = verifiedGoodCopiesForFace(entries, paths, faceKey).some(
    (copy) => copy.entryId !== entryId && !targetPaths.has(path.resolve(copy.path)),
  )
  if (!remaining) {
    throw new Error('Parking that copy would leave no verified-good copy of this face, so it will not be parked.')
  }
}

import { AsyncLocalStorage } from 'node:async_hooks'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadCatalog, removeEntryById, saveCatalog, upsertEntry } from './catalog.ts'
import { isUnderAnyRoot } from './containment.ts'
import { copiesOf } from './destinations.ts'
import { tryFingerprintFile } from './fingerprint.ts'
import { uniquePathFromOriginal } from './install.ts'
import { ensureFontActivation, getFontNative, type FontNative } from './native.ts'
import { createOperation, finishOperation, upsertOperation } from './operations.ts'
import { journalDir, journalPath, type AppPaths } from './paths.ts'
import { displayEntry } from './service-helpers.ts'
import { applyEntryFacts } from './state.ts'
import type { CatalogEntry } from './types.ts'

export type MutationJournalKind = 'install' | 'replace' | 'park' | 'switch'
export type MutationJournalPhase = 'prepared' | 'mutating' | 'catalog' | 'failed'
export type JournalFileRole = 'macos-live' | 'adobe-live' | 'macos-parked' | 'adobe-parked' | 'source'

export type JournalFileSnapshot = {
  role: JournalFileRole
  originalPath: string
  snapshotPath: string
  fingerprint?: string
}

export type JournalTarget = {
  entryId: string
  familyName: string
  entryBefore: CatalogEntry | null
  destPaths: string[]
  files: JournalFileSnapshot[]
}

export type MutationJournal = {
  version: 1
  id: string
  kind: MutationJournalKind
  phase: MutationJournalPhase
  startedAt: number
  lastError?: string
  targets: JournalTarget[]
}

type MutationJournalFile = {
  version: 1
  journals: MutationJournal[]
}

const openJournal = new AsyncLocalStorage<MutationJournal>()

function cloneEntry(entry: CatalogEntry): CatalogEntry {
  return JSON.parse(JSON.stringify(entry)) as CatalogEntry
}

function familyNameOf(entry: CatalogEntry): string {
  return entry.customFamilyName || entry.faces[0]?.familyName || 'Unknown'
}

function isParkedPath(filePath: string, paths: AppPaths): boolean {
  return isUnderAnyRoot(filePath, [paths.disabledDir])
}

function isMacosLivePath(filePath: string, paths: AppPaths): boolean {
  if (isParkedPath(filePath, paths)) return false
  return isUnderAnyRoot(filePath, [paths.installDir, paths.userFontsDir])
}

function emptyJournalFile(): MutationJournalFile {
  return { version: 1, journals: [] }
}

function readJournalFile(paths: AppPaths): MutationJournalFile {
  const file = journalPath(paths)
  if (!fs.existsSync(file)) return emptyJournalFile()
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as MutationJournalFile
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.journals)) {
      return emptyJournalFile()
    }
    return parsed
  } catch {
    return emptyJournalFile()
  }
}

function writeJournalFile(paths: AppPaths, data: MutationJournalFile): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  const dest = journalPath(paths)
  const tmp = `${dest}.${process.pid}.${process.hrtime.bigint()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, dest)
}

function snapshotFile(
  snapshotRoot: string,
  originalPath: string,
  role: JournalFileRole,
): JournalFileSnapshot | undefined {
  if (!fs.existsSync(originalPath) || !fs.statSync(originalPath).isFile()) return undefined
  const ext = path.extname(originalPath) || '.ttf'
  const snapshotPath = path.join(snapshotRoot, `${role}${ext}`)
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true })
  fs.copyFileSync(originalPath, snapshotPath)
  return {
    role,
    originalPath: path.resolve(originalPath),
    snapshotPath,
    fingerprint: tryFingerprintFile(snapshotPath),
  }
}

function intendedDestPaths(entry: CatalogEntry): string[] {
  const found = new Set<string>()
  const add = (value?: string) => {
    if (value) found.add(path.resolve(value))
  }
  add(entry.installedPath)
  add(entry.sourcePath)
  for (const copy of copiesOf(entry)) {
    add(copy.path)
  }
  return [...found]
}

function snapshotTarget(paths: AppPaths, entry: CatalogEntry, snapshotRoot: string): JournalTarget {
  const files: JournalFileSnapshot[] = []
  const macosLive = entry.installedPath
  if (macosLive && !isParkedPath(macosLive, paths)) {
    const snap = snapshotFile(snapshotRoot, macosLive, 'macos-live')
    if (snap) files.push(snap)
  }
  const macosParked = entry.disabledPath
  if (macosParked) {
    const snap = snapshotFile(snapshotRoot, macosParked, 'macos-parked')
    if (snap) files.push(snap)
  }
  const adobe = copiesOf(entry).find((copy) => copy.destinationId === 'adobe-shared')
  // A parked Adobe copy retains its nominal live path. If another file is
  // already there, it predates this transaction and must be preserved on a
  // failed unpark rather than being mistaken for a newly-created copy.
  if (adobe?.path && !isParkedPath(adobe.path, paths)) {
    const snap = snapshotFile(snapshotRoot, adobe.path, 'adobe-live')
    if (snap) files.push(snap)
  }
  if (adobe?.parkedPath) {
    const snap = snapshotFile(snapshotRoot, adobe.parkedPath, 'adobe-parked')
    if (snap) files.push(snap)
  }
  // Source write-back is part of a few higher-level mutations (for example
  // baking features). Keep an external source in the same durable journal so
  // a failure after the installed copy was committed restores both files.
  if (entry.sourcePath && !files.some((file) => path.resolve(file.originalPath) === path.resolve(entry.sourcePath))) {
    const snap = snapshotFile(snapshotRoot, entry.sourcePath, 'source')
    if (snap) files.push(snap)
  }
  return {
    entryId: entry.id,
    familyName: familyNameOf(entry),
    entryBefore: cloneEntry(entry),
    destPaths: intendedDestPaths(entry),
    files,
  }
}

function upsertJournal(paths: AppPaths, journal: MutationJournal): void {
  const data = readJournalFile(paths)
  const index = data.journals.findIndex((item) => item.id === journal.id)
  if (index === -1) {
    data.journals.push(journal)
  } else {
    data.journals[index] = journal
  }
  writeJournalFile(paths, data)
}

export function currentMutationJournal(): MutationJournal | undefined {
  return openJournal.getStore()
}

export function recordMutationDestination(
  paths: AppPaths,
  entryId: string,
  filePath: string,
  journalId?: string,
): void {
  const journal =
    openJournal.getStore() ??
    (journalId
      ? readJournalFile(paths).journals.find((item) => item.id === journalId)
      : undefined)
  if (!journal) return
  const target = journal.targets.find((item) => item.entryId === entryId)
  if (!target) return
  const resolved = path.resolve(filePath)
  if (!target.destPaths.some((item) => path.resolve(item) === resolved)) {
    target.destPaths.push(resolved)
    upsertJournal(paths, journal)
  }
}

/**
 * Add targets discovered after a journal has started. This is needed by
 * higher-level mutations that wrap an operation which discovers format
 * conflicts lazily; nested journals intentionally reuse the outer journal,
 * so those conflict entries must be snapshotted before they are removed.
 */
export function extendMutationJournal(
  paths: AppPaths,
  entries: CatalogEntry[],
  newEntryIds: string[] = [],
): void {
  const journal = openJournal.getStore()
  if (!journal) return
  const seen = new Set(journal.targets.map((target) => target.entryId))
  const snapshotRoot = path.join(journalDir(paths), journal.id)
  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    const target = snapshotTarget(paths, entry, path.join(snapshotRoot, entry.id))
    if (newEntryIds.includes(entry.id)) target.entryBefore = null
    journal.targets.push(target)
  }
  upsertJournal(paths, journal)
}

export function loadIncompleteJournals(paths: AppPaths): MutationJournal[] {
  return readJournalFile(paths).journals.filter(
    (item) =>
      item.phase === 'prepared' ||
      item.phase === 'mutating' ||
      item.phase === 'catalog' ||
      item.phase === 'failed',
  )
}

export function beginJournal(
  paths: AppPaths,
  input: { kind: MutationJournalKind; entries: CatalogEntry[]; newEntryIds?: string[] },
): MutationJournal {
  const id = crypto.randomUUID()
  const snapshotRoot = path.join(journalDir(paths), id)
  fs.mkdirSync(snapshotRoot, { recursive: true })
  const seen = new Set<string>()
  const targets: JournalTarget[] = []
  for (const entry of input.entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    const target = snapshotTarget(paths, entry, path.join(snapshotRoot, entry.id))
    if (input.newEntryIds?.includes(entry.id)) target.entryBefore = null
    targets.push(target)
  }
  const journal: MutationJournal = {
    version: 1,
    id,
    kind: input.kind,
    phase: 'prepared',
    startedAt: Date.now(),
    targets,
  }
  upsertJournal(paths, journal)
  return journal
}

export function markJournalPhase(
  paths: AppPaths,
  journalId: string,
  phase: MutationJournalPhase,
  lastError?: string,
): void {
  const data = readJournalFile(paths)
  const journal = data.journals.find((item) => item.id === journalId)
  if (!journal) return
  journal.phase = phase
  if (lastError) journal.lastError = lastError
  writeJournalFile(paths, data)
  const current = openJournal.getStore()
  if (current?.id === journalId) {
    current.phase = phase
    if (lastError) current.lastError = lastError
  }
}

export function completeJournal(paths: AppPaths, journalId: string): void {
  const data = readJournalFile(paths)
  data.journals = data.journals.filter((item) => item.id !== journalId)
  if (data.journals.length === 0 && fs.existsSync(journalPath(paths))) {
    fs.rmSync(journalPath(paths), { force: true })
  } else {
    writeJournalFile(paths, data)
  }
  const snapshotRoot = path.join(journalDir(paths), journalId)
  if (fs.existsSync(snapshotRoot)) {
    fs.rmSync(snapshotRoot, { recursive: true, force: true })
  }
}

export async function withMutationJournal<T>(
  paths: AppPaths,
  input: { kind: MutationJournalKind; entries: CatalogEntry[]; newEntryIds?: string[] },
  work: () => Promise<T>,
): Promise<T> {
  if (openJournal.getStore()) {
    return work()
  }
  const journal = beginJournal(paths, input)
  return openJournal.run(journal, async () => {
    try {
      markJournalPhase(paths, journal.id, 'mutating')
      const result = await work()
      completeJournal(paths, journal.id)
      return result
    } catch (error) {
      markJournalPhase(
        paths,
        journal.id,
        'failed',
        error instanceof Error ? error.message : String(error),
      )
      try {
        await restoreJournal(paths, journal, getFontNative())
        completeJournal(paths, journal.id)
      } catch (rollbackError) {
        markJournalPhase(
          paths,
          journal.id,
          'failed',
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        )
      }
      throw error
    }
  })
}

function snapshottedLivePaths(target: JournalTarget): Set<string> {
  return new Set(
    target.files
      .filter((file) => file.role.endsWith('-live'))
      .map((file) => path.resolve(file.originalPath)),
  )
}

async function restoreSnapshotFile(
  paths: AppPaths,
  native: FontNative,
  file: JournalFileSnapshot,
): Promise<void> {
  if (!fs.existsSync(file.snapshotPath)) return
  fs.mkdirSync(path.dirname(file.originalPath), { recursive: true })
  fs.copyFileSync(file.snapshotPath, file.originalPath)
  if (file.role === 'macos-live' && isMacosLivePath(file.originalPath, paths)) {
    try {
      await ensureFontActivation(native, file.originalPath, true)
    } catch {
      // Restoring bytes is the priority; native activation is best-effort on startup.
    }
  }
}

async function removeLivePath(native: FontNative, filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) return
  try {
    await native.unregisterFont(filePath)
  } catch {
    // Removing an incomplete dest must not fail the rest of reconcile.
  }
  fs.rmSync(filePath, { force: true })
}

function referencedParkedPaths(entry: CatalogEntry): Set<string> {
  const parked = new Set<string>()
  if (entry.disabledPath) parked.add(path.resolve(entry.disabledPath))
  for (const copy of copiesOf(entry)) {
    if (copy.parkedPath) parked.add(path.resolve(copy.parkedPath))
  }
  return parked
}

function removeStrayParkedCopy(paths: AppPaths, livePath: string, allowed: Set<string>): void {
  const vault = uniquePathFromOriginal(paths.disabledDir, livePath)
  if (!fs.existsSync(vault)) return
  if (allowed.has(path.resolve(vault))) return
  const liveFp = tryFingerprintFile(livePath)
  const vaultFp = tryFingerprintFile(vault)
  if (liveFp && vaultFp && liveFp === vaultFp) {
    fs.rmSync(vault, { force: true })
  }
}

async function restoreJournal(
  paths: AppPaths,
  journal: MutationJournal,
  native: FontNative,
): Promise<void> {
  const catalog = fs.existsSync(paths.catalogPath) ? loadCatalog(paths) : { version: 1 as const, entries: [] }
  for (const target of journal.targets) {
    for (const file of target.files) {
      await restoreSnapshotFile(paths, native, file)
    }
    if (target.entryBefore) {
      const restored = cloneEntry(target.entryBefore)
      applyEntryFacts(restored)
      upsertEntry(catalog, restored)
    } else {
      removeEntryById(catalog, target.entryId)
    }

    const before = target.entryBefore
    const liveSnapshots = snapshottedLivePaths(target)
    const allowedParked = before ? referencedParkedPaths(before) : new Set<string>()

    if (before && (before.status === 'installed' || before.status === 'outdated')) {
      for (const livePath of liveSnapshots) {
        removeStrayParkedCopy(paths, livePath, allowedParked)
      }
    }

    // A mutation may write a second extension or destination before the
    // catalog commit. Restore exactly the prior live set; status alone is not
    // enough because an installed entry can gain a new destination.
    // A live destination belongs to the prior state only if we actually
    // snapshotted bytes from it. Deactivated records intentionally retain the
    // nominal live path in their catalog row while the file is parked.
    const expectedOriginals = new Set(
      target.files.map((file) => path.resolve(file.originalPath)),
    )
    const expectedLive = liveSnapshots
    for (const destPath of target.destPaths) {
      const resolved = path.resolve(destPath)
      if (expectedOriginals.has(resolved) || expectedLive.has(resolved) || isParkedPath(resolved, paths)) continue
      if (fs.existsSync(resolved)) {
        await removeLivePath(native, resolved)
      }
    }
  }
  saveCatalog(paths, catalog)
}

function recoveryReason(kind: MutationJournalKind): string {
  switch (kind) {
    case 'replace':
      return 'Rolled back an incomplete replace.'
    case 'park':
      return 'Restored the previous working install after an incomplete park.'
    case 'switch':
      return 'Restored the previous working fonts after an incomplete switch.'
    default:
      return 'Rolled back an incomplete install.'
  }
}

function recordRecovery(
  paths: AppPaths,
  journal: MutationJournal,
  outcome: 'succeeded' | 'failed',
  reason: string,
): void {
  const familyName = [...new Set(journal.targets.map((target) => target.familyName))].join(', ')
  const items = journal.targets.map((target) => ({
    id: crypto.randomUUID(),
    entryId: target.entryId,
    label: target.entryBefore ? displayEntry(target.entryBefore) : target.familyName,
    outcome,
    reason,
  }))
  if (items.length === 0) {
    items.push({
      id: crypto.randomUUID(),
      entryId: undefined,
      label: familyName || journal.kind,
      outcome,
      reason,
    })
  }
  const operation = finishOperation(
    createOperation({
      trigger: 'startup',
      action: 'recover-journal',
      familyName: familyName || undefined,
    }),
    items,
  )
  operation.undoable = false
  upsertOperation(paths, operation)
}

export async function reconcileMutationJournals(
  paths: AppPaths,
  native: FontNative,
): Promise<MutationJournal[]> {
  const journals = loadIncompleteJournals(paths).sort((left, right) => left.startedAt - right.startedAt)
  const processed: MutationJournal[] = []
  for (const journal of journals) {
    try {
      await restoreJournal(paths, journal, native)
      recordRecovery(paths, journal, 'succeeded', recoveryReason(journal.kind))
      completeJournal(paths, journal.id)
      processed.push(journal)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      markJournalPhase(paths, journal.id, 'failed', message)
      recordRecovery(paths, journal, 'failed', message)
      processed.push(journal)
    }
  }
  return processed
}

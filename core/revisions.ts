import fs from 'node:fs'
import path from 'node:path'
import { isFullyUnderAnyRoot } from './containment.ts'
import { fingerprintFile } from './fingerprint.ts'
import { parseFontFile } from './parse.ts'
import { revisionsDir } from './paths.ts'
import type { AppPaths } from './paths.ts'
import type { FontFaceInfo, FontRevision, RevisionIndex } from './types.ts'

const REVISION_FINGERPRINT = /^[a-f0-9]{64}$/i

export function isRevisionFingerprint(value: string | undefined): value is string {
  return Boolean(value && REVISION_FINGERPRINT.test(value))
}

function resolvedRevisionFile(paths: AppPaths, fingerprint: string): string | undefined {
  if (!isRevisionFingerprint(fingerprint)) return undefined
  const dest = path.resolve(revisionsDir(paths), fingerprint)
  if (!isFullyUnderAnyRoot(dest, [revisionsDir(paths)])) return undefined
  return dest
}

const emptyIndex = (): RevisionIndex => ({ version: 1, revisions: [] })

function indexPath(paths: AppPaths): string {
  return path.join(revisionsDir(paths), 'index.json')
}

export function loadRevisionIndex(paths: AppPaths): RevisionIndex {
  const file = indexPath(paths)
  if (!fs.existsSync(file)) return emptyIndex()
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RevisionIndex
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.revisions)) {
      return emptyIndex()
    }
    return parsed
  } catch {
    return emptyIndex()
  }
}

function saveRevisionIndex(paths: AppPaths, index: RevisionIndex): void {
  fs.mkdirSync(revisionsDir(paths), { recursive: true })
  const tmp = `${indexPath(paths)}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2))
  fs.renameSync(tmp, indexPath(paths))
}

export function revisionFilePath(paths: AppPaths, fingerprint: string): string {
  const dest = resolvedRevisionFile(paths, fingerprint)
  if (!dest) throw new Error('That revision id is not valid.')
  return dest
}

export function storeRevision(
  paths: AppPaths,
  filePath: string,
  options: { faces?: FontFaceInfo[]; format?: string } = {},
): FontRevision | undefined {
  if (!fs.existsSync(filePath)) return undefined
  const fingerprint = fingerprintFile(filePath)
  const dest = revisionFilePath(paths, fingerprint)
  fs.mkdirSync(revisionsDir(paths), { recursive: true })
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(filePath, dest)
  }
  const index = loadRevisionIndex(paths)
  const existing = index.revisions.find((item) => item.fingerprint === fingerprint)
  if (existing) {
    existing.refs += 1
    saveRevisionIndex(paths, index)
    return existing
  }
  let faces = options.faces
  let format = options.format
  if (!faces || !format) {
    try {
      const parsed = parseFontFile(dest)
      faces = parsed.faces
      format = parsed.format
    } catch {
      faces = faces ?? []
      format = format ?? path.extname(filePath).slice(1).toLowerCase()
    }
  }
  const revision: FontRevision = {
    fingerprint,
    format: format || 'ttf',
    size: fs.statSync(dest).size,
    faces,
    createdAt: Date.now(),
    refs: 1,
  }
  index.revisions.push(revision)
  saveRevisionIndex(paths, index)
  return revision
}

export function releaseRevision(paths: AppPaths, fingerprint: string | undefined): void {
  if (!fingerprint) return
  const index = loadRevisionIndex(paths)
  const item = index.revisions.find((row) => row.fingerprint === fingerprint)
  if (!item) return
  item.refs = Math.max(0, item.refs - 1)
  saveRevisionIndex(paths, index)
}

export function revisionUsageBytes(paths: AppPaths): number {
  const dir = revisionsDir(paths)
  if (!fs.existsSync(dir)) return 0
  let total = 0
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.json') || name.endsWith('.tmp')) continue
    try {
      total += fs.statSync(path.join(dir, name)).size
    } catch {
      // Skip unreadable blobs.
    }
  }
  return total
}

export function evictUnreferencedRevisions(
  paths: AppPaths,
  options: { budgetBytes: number; pinned: Set<string>; required: Set<string> },
): { evicted: string[]; postponed: boolean } {
  const index = loadRevisionIndex(paths)
  const evicted: string[] = []
  let usage = revisionUsageBytes(paths)
  const candidates = index.revisions
    .filter(
      (item) =>
        item.refs <= 0 &&
        !options.pinned.has(item.fingerprint) &&
        !options.required.has(item.fingerprint),
    )
    .sort((a, b) => a.createdAt - b.createdAt)
  for (const item of candidates) {
    if (usage <= options.budgetBytes) break
    const file = revisionFilePath(paths, item.fingerprint)
    if (fs.existsSync(file)) {
      usage -= item.size
      fs.rmSync(file, { force: true })
    }
    evicted.push(item.fingerprint)
  }
  if (evicted.length) {
    index.revisions = index.revisions.filter((item) => !evicted.includes(item.fingerprint))
    saveRevisionIndex(paths, index)
  }
  const requiredMissing = [...options.required].some((fingerprint) => {
    return !fs.existsSync(revisionFilePath(paths, fingerprint))
  })
  return { evicted, postponed: usage > options.budgetBytes || requiredMissing }
}

export function readRevisionBytes(paths: AppPaths, fingerprint: string): Buffer | undefined {
  const file = resolvedRevisionFile(paths, fingerprint)
  if (!file || !fs.existsSync(file)) return undefined
  return fs.readFileSync(file)
}

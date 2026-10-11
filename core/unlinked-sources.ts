import fs from 'node:fs'
import path from 'node:path'
import { tryFingerprintFile } from './fingerprint.ts'
import type { AppPaths } from './paths.ts'

type UnlinkedSourceFile = {
  version: 1
  entries: Array<{ path: string; fingerprint: string }>
}

function listPath(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'unlinked-sources.json')
}

function loadUnlinkedSources(paths: AppPaths): UnlinkedSourceFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(listPath(paths), 'utf8')) as UnlinkedSourceFile
    if (parsed?.version === 1 && Array.isArray(parsed.entries)) return parsed
  } catch {
    // Missing or unreadable: nothing is ignored.
  }
  return { version: 1, entries: [] }
}

function saveUnlinkedSources(paths: AppPaths, data: UnlinkedSourceFile): void {
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  const target = listPath(paths)
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data))
  fs.renameSync(temp, target)
}

/** Remember a source that was uninstalled and unlinked, matched by path and bytes. */
export function rememberUnlinkedSource(paths: AppPaths, sourcePath: string, fingerprint: string): void {
  if (!sourcePath || !fingerprint) return
  const resolved = path.resolve(sourcePath)
  const data = loadUnlinkedSources(paths)
  const entries = data.entries.filter((entry) => path.resolve(entry.path) !== resolved)
  entries.push({ path: resolved, fingerprint })
  saveUnlinkedSources(paths, { version: 1, entries })
}

/** A manual add accepts the file again, whatever its bytes are. */
export function allowUnlinkedSource(paths: AppPaths, sourcePath: string): void {
  if (!sourcePath) return
  const resolved = path.resolve(sourcePath)
  const data = loadUnlinkedSources(paths)
  const entries = data.entries.filter((entry) => path.resolve(entry.path) !== resolved)
  if (entries.length === data.entries.length) return
  saveUnlinkedSources(paths, { version: 1, entries })
}

/**
 * True when this exact file was unlinked and the bytes have not changed.
 * A new fingerprint is a different file and is allowed back in.
 */
export function isUnlinkedSource(paths: AppPaths, sourcePath: string): boolean {
  const resolved = path.resolve(sourcePath)
  const stored = loadUnlinkedSources(paths).entries.find((entry) => path.resolve(entry.path) === resolved)
  if (!stored?.fingerprint) return false
  return tryFingerprintFile(resolved) === stored.fingerprint
}

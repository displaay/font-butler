import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadCatalog } from './catalog.ts'
import { isUnderAnyRoot } from './containment.ts'
import { pruneStaleDuplicates } from './duplicates.ts'
import { emitEvent } from './events.ts'
import { entryFormat } from './formats.ts'
import { getFontNative } from './native.ts'
import { readFileStat } from './parse.ts'
import type { AppPaths } from './paths.ts'
import { moveToTrash } from './reveal.ts'
import type { CatalogEntry, DuplicateWarning, FontFaceInfo, Notice } from './types.ts'

export function now(): number {
  return Date.now()
}

export function newId(): string {
  return crypto.randomUUID()
}

export function displayFamily(entry: CatalogEntry): string {
  return entry.customFamilyName || entry.faces[0]?.familyName || 'Unknown'
}

function uniqueStyleNames(faces: Array<Pick<FontFaceInfo, 'styleName'>>): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const face of faces) {
    const name = face.styleName.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

function styleSummary(faces: Array<Pick<FontFaceInfo, 'styleName'>>): string {
  const styles = uniqueStyleNames(faces)
  if (styles.length === 0) return ''
  if (styles.length <= 3) return styles.join(', ')
  return `${styles.length} styles`
}

function prettyFileName(filePath?: string): string {
  if (!filePath) return ''
  const name = path.basename(filePath)
  return name.replace(/^(?:[0-9]{10,}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})-/i, '')
}

export function displayEntryLabel(input: {
  familyName?: string
  faces?: Array<Pick<FontFaceInfo, 'styleName'>>
  format?: string
  filePath?: string
}): string {
  const fileName = prettyFileName(input.filePath)
  const format = (input.format || path.extname(input.filePath || '').replace(/^\./, ''))
    .trim()
    .toUpperCase()
  const styles = styleSummary(input.faces ?? [])
  if (styles) return format ? `${styles} · ${format}` : styles
  const parts: string[] = []
  if (input.familyName) parts.push(input.familyName)
  if (fileName && fileName !== parts[0]) parts.push(fileName)
  else if (format && format !== parts[0]) parts.push(format)
  return parts.join(' · ') || input.familyName || fileName || 'Unknown'
}

export function displayEntry(entry: CatalogEntry): string {
  return displayEntryLabel({
    familyName: displayFamily(entry),
    faces: entry.faces,
    format: entryFormat(entry),
    filePath: entry.sourcePath || entry.installedPath || entry.disabledPath,
  })
}

export function bindEntryToInstalledFile(entry: CatalogEntry, dest: string): void {
  const resolved = path.resolve(dest)
  const stat = readFileStat(resolved)
  entry.sourcePath = resolved
  entry.installedPath = resolved
  entry.disabledPath = undefined
  entry.sourceMtimeMs = stat.mtimeMs
  entry.sourceSize = stat.size
  entry.sourcePresent = false
  entry.installedSnapshotMtimeMs = stat.mtimeMs
  entry.installedSnapshotSize = stat.size
  entry.status = 'installed'
}

export function emitCatalog(paths: AppPaths): CatalogEntry[] {
  const catalog = loadCatalog(paths)
  emitEvent({ type: 'catalog', entries: catalog.entries })
  return catalog.entries
}

export function emitDuplicates(paths: AppPaths): DuplicateWarning[] {
  const duplicates = pruneStaleDuplicates(paths)
  emitEvent({ type: 'duplicates', duplicates })
  return duplicates
}

export function emitNotice(notice: Notice): void {
  emitEvent({ type: 'notice', notice })
}

export function touchEntry(entry: CatalogEntry): void {
  entry.updatedAt = now()
}

export async function removeInstalledCopy(entry: CatalogEntry): Promise<void> {
  if (entry.installedPath) {
    await getFontNative().unregisterFont(entry.installedPath)
    if (fs.existsSync(entry.installedPath)) {
      fs.rmSync(entry.installedPath, { force: true })
    }
  }
  entry.installedPath = undefined
}

export function isProtectedSource(filePath: string, paths: AppPaths): boolean {
  return isUnderAnyRoot(filePath, [
    paths.systemFontsDir,
    paths.computerFontsDir,
    paths.supplementalFontsDir,
  ])
}

export async function deleteSourceFile(filePath: string, paths: AppPaths): Promise<void> {
  const resolved = path.resolve(filePath)
  if (isProtectedSource(resolved, paths)) {
    throw new Error('System font files cannot be deleted.')
  }
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(resolved)
  } catch {
    return
  }
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(resolved)
    return
  }
  if (!stat.isFile()) {
    throw new Error('That source path is not a file.')
  }
  await moveToTrash(resolved)
}

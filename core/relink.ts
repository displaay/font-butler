import fs from 'node:fs'
import path from 'node:path'
import { faceIdentityKey } from './catalog.ts'
import { tryFingerprintFile } from './fingerprint.ts'
import { isWebFontFormat, normalizeFormat } from './formats.ts'
import { isFontFile, isPreviewableFontFile, parseFontFile } from './parse.ts'
import type { CatalogEntry, FolderRelinkPreview, FolderRelinkRow, RelinkPreview } from './types.ts'

export function inspectRelinkCandidate(entry: CatalogEntry, candidatePath: string): RelinkPreview {
  const resolved = path.resolve(candidatePath)
  const preview: RelinkPreview = {
    entryId: entry.id,
    oldPath: entry.sourcePath,
    proposedPath: resolved,
    match: 'missing',
    identityMatch: false,
    format: '',
    bytesDiffer: true,
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    preview.reason = 'That file is missing.'
    return preview
  }
  if (!isPreviewableFontFile(resolved) && !isFontFile(resolved)) {
    preview.match = 'mismatch'
    preview.reason = 'That file is not a supported font.'
    return preview
  }
  let parsed
  try {
    parsed = parseFontFile(resolved)
  } catch (error) {
    preview.match = 'mismatch'
    preview.reason = error instanceof Error ? error.message : 'Could not read that font.'
    return preview
  }
  preview.format = parsed.format
  const incomingKey = faceIdentityKey(parsed.faces, parsed.format)
  const currentKey = faceIdentityKey(entry.faces, entry.format || path.extname(entry.sourcePath))
  preview.identityMatch = Boolean(incomingKey && currentKey && incomingKey === currentKey)
  const incomingPrint = tryFingerprintFile(resolved)
  const currentPrint = entry.sourceFingerprint || entry.installedFingerprint
  const bytesDiffer = Boolean(incomingPrint && currentPrint && incomingPrint !== currentPrint)
  preview.bytesDiffer = incomingPrint && currentPrint ? bytesDiffer : true
  if (isWebFontFormat(parsed.format) !== Boolean(entry.previewOnly || isWebFontFormat(entry.format))) {
    preview.match = 'mismatch'
    preview.reason = 'A renamed derivative needs its own identity. Import this file separately.'
    return preview
  }
  if (entry.sourceFingerprint && incomingPrint === entry.sourceFingerprint) {
    preview.match = 'fingerprint'
    preview.bytesDiffer = false
    return preview
  }
  if (preview.identityMatch) {
    preview.match = 'identity'
    return preview
  }
  preview.match = 'mismatch'
  preview.reason = 'That file does not match this font’s identity.'
  return preview
}

export function inspectFolderRelink(
  entries: CatalogEntry[],
  oldRoot: string,
  newRoot: string,
  options: { search?: boolean } = {},
): FolderRelinkPreview {
  const from = path.resolve(oldRoot)
  const to = path.resolve(newRoot)
  const rows: FolderRelinkRow[] = []
  const owned = entries.filter((entry) => {
    const source = path.resolve(entry.sourcePath)
    return source === from || source.startsWith(`${from}${path.sep}`)
  })
  const searched = options.search ? listFontFiles(to) : []
  for (const entry of owned) {
    const relative = path.relative(from, path.resolve(entry.sourcePath))
    const proposed = path.join(to, relative)
    const row: FolderRelinkRow = {
      entryId: entry.id,
      relativePath: relative,
      oldPath: entry.sourcePath,
      status: 'not-found',
      candidates: [],
      bytesDiffer: false,
    }
    if (fs.existsSync(proposed) && fs.statSync(proposed).isFile()) {
      const preview = inspectRelinkCandidate(entry, proposed)
      row.proposedPath = proposed
      row.selected = preview.match === 'mismatch' ? undefined : proposed
      row.bytesDiffer = preview.bytesDiffer
      row.status = preview.match === 'mismatch' ? 'not-found' : preview.bytesDiffer ? 'changed' : 'matched'
      if (preview.match !== 'mismatch') {
        rows.push(row)
        continue
      }
    }
    if (options.search) {
      const matches = searched.filter((candidate) => {
        const preview = inspectRelinkCandidate(entry, candidate)
        return preview.match === 'fingerprint' || preview.match === 'identity'
      })
      row.candidates = matches
      if (matches.length === 1) {
        const preview = inspectRelinkCandidate(entry, matches[0]!)
        row.proposedPath = matches[0]
        row.selected = matches[0]
        row.bytesDiffer = preview.bytesDiffer
        row.status = preview.bytesDiffer ? 'changed' : 'matched'
      } else if (matches.length > 1) {
        row.status = 'ambiguous'
      }
    }
    rows.push(row)
  }
  return { oldRoot: from, newRoot: to, rows }
}

function listFontFiles(root: string, depth = 0): string[] {
  if (depth > 10) return []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFontFiles(full, depth + 1))
    } else if (entry.isFile() && (isFontFile(full) || isPreviewableFontFile(full))) {
      files.push(path.resolve(full))
    }
  }
  return files
}

export function formatMatches(left: string, right: string): boolean {
  return normalizeFormat(left) === normalizeFormat(right)
}

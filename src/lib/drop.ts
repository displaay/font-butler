import {
  countFormats,
  formatFromName,
  isInstallableFormat,
  isWebFormat,
  type FormatCount,
} from './formats.ts'

const FONT_NAME = /\.(ttf|otf|ttc|otc|woff2?)$/i
const MAX_DEPTH = 10

function nativePath(file: File): string | undefined {
  const value = (file as File & { path?: string }).path
  return value && value.trim() ? value : undefined
}

export function isDroppedFontName(name: string): boolean {
  return FONT_NAME.test(name)
}

export type DropPartition = {
  paths: string[]
  files: File[]
  formats: FormatCount[]
  skippedWeb: number
}

export function partitionDropPayload(
  paths: string[],
  files: File[],
  extraSkippedWeb = 0,
): DropPartition {
  const fontPaths: string[] = []
  const folderPaths: string[] = []
  const keptFiles: File[] = []
  const counted: string[] = []
  let skippedWeb = extraSkippedWeb

  for (const filePath of paths) {
    const format = formatFromName(filePath)
    if (!format) {
      folderPaths.push(filePath)
      continue
    }
    if (isWebFormat(format)) {
      skippedWeb += 1
      continue
    }
    if (!isInstallableFormat(format)) continue
    fontPaths.push(filePath)
    counted.push(format)
  }

  for (const file of files) {
    const format = formatFromName(file.name)
    if (!format) continue
    if (isWebFormat(format)) {
      skippedWeb += 1
      continue
    }
    if (!isInstallableFormat(format)) continue
    keptFiles.push(file)
    counted.push(format)
  }

  if (fontPaths.length > 0 || keptFiles.length > 0) {
    return {
      paths: fontPaths,
      files: keptFiles,
      formats: countFormats(counted),
      skippedWeb,
    }
  }

  return {
    paths: folderPaths,
    files: [],
    formats: [],
    skippedWeb,
  }
}

export function filterPayloadToFormat(
  paths: string[],
  files: File[],
  format: string,
): { paths: string[]; files: File[] } {
  return {
    paths: paths.filter((filePath) => formatFromName(filePath) === format),
    files: files.filter((file) => formatFromName(file.name) === format),
  }
}

export function shouldSkipDroppedName(name: string): boolean {
  return name.startsWith('.') || name === '__MACOSX'
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

function readDirectory(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader()
  const all: FileSystemEntry[] = []
  return new Promise((resolve, reject) => {
    const next = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all)
          return
        }
        all.push(...batch)
        next()
      }, reject)
    }
    next()
  })
}

async function walkEntry(
  entry: FileSystemEntry,
  paths: Set<string>,
  files: File[],
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH || shouldSkipDroppedName(entry.name)) {
    return
  }
  if (entry.isDirectory) {
    const children = await readDirectory(entry as FileSystemDirectoryEntry)
    for (const child of children) {
      await walkEntry(child, paths, files, depth + 1)
    }
    return
  }
  if (!entry.isFile || !isDroppedFontName(entry.name)) {
    return
  }
  const file = await fileFromEntry(entry as FileSystemFileEntry)
  const filePath = nativePath(file)
  if (filePath) {
    paths.add(filePath)
    return
  }
  files.push(file)
}

export function collectNativeFolderPaths(
  items: Array<{ isDirectory: boolean; path?: string }>,
): string[] {
  const folders = new Set<string>()
  for (const item of items) {
    if (item.isDirectory && item.path?.trim()) {
      folders.add(item.path.trim())
    }
  }
  return [...folders]
}

function droppedFolderItems(dataTransfer: DataTransfer): Array<{
  isDirectory: boolean
  path?: string
}> {
  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => {
      const entry = item.webkitGetAsEntry?.() ?? null
      const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null
      return {
        isDirectory: Boolean(entry?.isDirectory),
        path: file ? nativePath(file) : undefined,
      }
    })
}

export async function collectDropPayload(dataTransfer: DataTransfer): Promise<{
  paths: string[]
  files: File[]
  folders: string[]
}> {
  const paths = new Set<string>()
  const files: File[] = []
  const folders = collectNativeFolderPaths(droppedFolderItems(dataTransfer))

  for (const file of Array.from(dataTransfer.files ?? [])) {
    const filePath = nativePath(file)
    if (filePath) {
      paths.add(filePath)
    }
  }

  const entries = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => Boolean(entry))

  for (const entry of entries) {
    await walkEntry(entry, paths, files, 0)
  }

  if (paths.size === 0 && files.length === 0) {
    for (const file of Array.from(dataTransfer.files ?? [])) {
      if (isDroppedFontName(file.name)) {
        files.push(file)
      }
    }
  }

  return { paths: [...paths], files, folders }
}

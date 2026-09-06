import { desktopPathForFile } from './desktop.ts'
import {
  countFormats,
  formatFromName,
  isInstallableFormat,
  isWebFormat,
  normalizeFormat,
  type FormatCount,
} from './formats.ts'

const FONT_NAME = /\.(ttf|otf|ttc|otc|woff2?)$/i
const MAX_DEPTH = 10

function nativePath(file: File): string | undefined {
  return desktopPathForFile(file)
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
    } else if (!isInstallableFormat(format)) {
      continue
    }
    fontPaths.push(filePath)
    counted.push(format)
  }

  const listedPaths = new Set(paths)
  for (const file of files) {
    const filePath = nativePath(file)
    if (filePath && listedPaths.has(filePath)) continue
    const format = formatFromName(file.name)
    if (!format) continue
    if (isWebFormat(format)) {
      skippedWeb += 1
    } else if (!isInstallableFormat(format)) {
      continue
    }
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
  folders?: Set<string>,
  rootDir?: FileSystemDirectoryEntry,
): Promise<void> {
  if (depth > MAX_DEPTH || shouldSkipDroppedName(entry.name)) {
    return
  }
  if (entry.isDirectory) {
    const dir = entry as FileSystemDirectoryEntry
    const root = depth === 0 ? dir : rootDir
    const children = await readDirectory(dir)
    for (const child of children) {
      await walkEntry(child, paths, files, depth + 1, folders, root)
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
    if (folders && rootDir) {
      const folderPath = inferDroppedFolderPath(filePath, entry.fullPath, rootDir.fullPath)
      if (folderPath) folders.add(folderPath)
    }
    return
  }
  files.push(file)
}

export function inferFolderFromRelativePath(
  nativeFilePath: string,
  relativePath: string,
): string | undefined {
  const rel = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const slash = rel.indexOf('/')
  if (slash < 0) return undefined
  return inferDroppedFolderPath(nativeFilePath, `/${rel}`, `/${rel.slice(0, slash)}`)
}

export function inferDroppedFolderPath(
  nativeFilePath: string,
  fileFullPath: string,
  folderFullPath: string,
): string | undefined {
  const sep = nativeFilePath.includes('\\') ? '\\' : '/'
  const fileFull = fileFullPath.replace(/\\/g, '/')
  const folderFull = folderFullPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  if (fileFull !== folderFull && !fileFull.startsWith(`${folderFull}/`)) return undefined
  const relativePosix = fileFull.slice(folderFull.length)
  if (!relativePosix) return nativeFilePath
  const relativeNative = relativePosix.replace(/\//g, sep)
  if (!nativeFilePath.endsWith(relativeNative)) return undefined
  const inferred = nativeFilePath.slice(0, nativeFilePath.length - relativeNative.length)
  if (!inferred) return undefined
  const folderName = folderFull.split('/').filter(Boolean).pop()
  if (folderName && !inferred.endsWith(folderName)) return undefined
  return inferred
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

export function isDroppedFolderPath(filePath: string, fileName = filePath): boolean {
  return !isDroppedFontName(fileName) && !isDroppedFontName(filePath)
}

export function importPathsForProjectDrop(paths: string[], folders: string[]): string[] {
  if (folders.length === 0) return [...new Set(paths)]
  const extra = paths.filter(
    (filePath) =>
      !folders.some((folder) => {
        const sep = filePath.includes('\\') ? '\\' : '/'
        return (
          filePath === folder ||
          filePath.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`)
        )
      }),
  )
  return [...new Set([...folders, ...extra])]
}

export function planPathsForImport(inputPaths: string[], partitionedPaths: string[]): string[] {
  const folders = inputPaths.filter((filePath) => isDroppedFolderPath(filePath))
  return [...new Set([...folders, ...partitionedPaths])]
}

export function isWebOnlyDrop(partition: DropPartition): boolean {
  const hasDesktop = partition.formats.some((item) => isInstallableFormat(item.format))
  return (
    !hasDesktop &&
    (partition.skippedWeb > 0 || partition.formats.some((item) => isWebFormat(item.format))) &&
    !partition.paths.some((filePath) => isDroppedFolderPath(filePath))
  )
}

function filePathNamed(files: File[], name: string): string | undefined {
  const match = files.find((file) => file.name === name)
  return match ? nativePath(match) : undefined
}

function droppedFolderItems(dataTransfer: DataTransfer): Array<{
  isDirectory: boolean
  path?: string
}> {
  const listed = Array.from(dataTransfer.files ?? [])
  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => {
      const entry = item.webkitGetAsEntry?.() ?? null
      const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null
      const directory = entry?.isDirectory ? (entry as FileSystemDirectoryEntry) : null
      return {
        isDirectory: Boolean(directory),
        path:
          (file ? nativePath(file) : undefined) ??
          (directory ? filePathNamed(listed, directory.name) : undefined),
      }
    })
}

export function commonDroppedFolder(filePaths: string[]): string | undefined {
  if (filePaths.length === 0) return undefined
  const dirs = filePaths.map((filePath) => {
    const normalized = filePath.replace(/\\/g, '/')
    const index = normalized.lastIndexOf('/')
    return index < 0 ? normalized : normalized.slice(0, index)
  })
  let common = dirs[0]
  for (const dir of dirs.slice(1)) {
    while (common && dir !== common && !dir.startsWith(`${common}/`)) {
      const index = common.lastIndexOf('/')
      common = index < 0 ? '' : common.slice(0, index)
    }
  }
  return common || undefined
}

export async function collectDropPayload(dataTransfer: DataTransfer): Promise<{
  paths: string[]
  files: File[]
  folders: string[]
  hadDirectory: boolean
}> {
  const paths = new Set<string>()
  const files: File[] = []
  const folderItems = droppedFolderItems(dataTransfer)
  const folders = new Set(collectNativeFolderPaths(folderItems))
  let hadDirectory = folderItems.some((item) => item.isDirectory)

  for (const file of Array.from(dataTransfer.files ?? [])) {
    const filePath = nativePath(file)
    if (!filePath) continue
    paths.add(filePath)
    if (isDroppedFolderPath(filePath, file.name)) {
      folders.add(filePath)
    }
    const inferred = inferFolderFromRelativePath(filePath, file.webkitRelativePath ?? '')
    if (inferred) folders.add(inferred)
  }

  const entries = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => Boolean(entry))

  for (const entry of entries) {
    if (entry.isDirectory) hadDirectory = true
    await walkEntry(
      entry,
      paths,
      files,
      0,
      folders,
      entry.isDirectory ? (entry as FileSystemDirectoryEntry) : undefined,
    )
  }

  if (paths.size === 0 && files.length === 0) {
    for (const file of Array.from(dataTransfer.files ?? [])) {
      if (isDroppedFontName(file.name)) {
        files.push(file)
      }
    }
  }

  return { paths: [...paths], files, folders: [...folders], hadDirectory }
}

export function filterDropByFormat(partition: DropPartition, format: string): DropPartition {
  const want = normalizeFormat(format)
  const paths = partition.paths.filter((filePath) => formatFromName(filePath) === want)
  const files = partition.files.filter((file) => formatFromName(file.name) === want)
  const counted = [
    ...paths.map((filePath) => formatFromName(filePath)),
    ...files.map((file) => formatFromName(file.name)),
  ].filter((value): value is string => Boolean(value))
  return {
    paths,
    files,
    formats: countFormats(counted),
    skippedWeb: partition.skippedWeb,
  }
}

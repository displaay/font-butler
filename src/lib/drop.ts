const FONT_NAME = /\.(ttf|otf|ttc|otc|woff2?)$/i
const MAX_DEPTH = 10

function nativePath(file: File): string | undefined {
  const value = (file as File & { path?: string }).path
  return value && value.trim() ? value : undefined
}

export function isDroppedFontName(name: string): boolean {
  return FONT_NAME.test(name)
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

export async function collectDropPayload(dataTransfer: DataTransfer): Promise<{
  paths: string[]
  files: File[]
}> {
  const paths = new Set<string>()
  const files: File[] = []

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

  return { paths: [...paths], files }
}

import { SYSTEM_FONT_CACHE_VERSION } from './constants.ts'
import fs from 'node:fs'
import path from 'node:path'
import { loadCatalog } from './catalog.ts'
import { isFontFile, parseFontFile, readFileStat } from './parse.ts'
import { isFullyUnderAnyRoot, isUnderAnyRoot } from './containment.ts'
import { type AppPaths, isMac } from './paths.ts'
import type { SystemFace } from './types.ts'

function walkFonts(root: string, acc: string[]): void {
  if (!fs.existsSync(root)) {
    return
  }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      walkFonts(full, acc)
      continue
    }
    if (entry.isFile() && isFontFile(full)) {
      acc.push(full)
    }
  }
}

function isProtectedPath(filePath: string, paths: AppPaths): boolean {
  const roots = [paths.systemFontsDir]
  if (!isMac()) {
    roots.push('/usr/share/fonts')
  }
  return isUnderAnyRoot(filePath, roots)
}

function isWritable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

type CacheFile = {
  version?: number
  faces: SystemFace[]
  stamps: Record<string, number>
}

export function scanSystemFonts(paths: AppPaths): SystemFace[] {
  const roots = [paths.computerFontsDir, paths.systemFontsDir]
  const files: string[] = []
  for (const root of [...new Set(roots)]) {
    walkFonts(root, files)
  }

  let cache: CacheFile = { faces: [], stamps: {} }
  if (fs.existsSync(paths.systemCachePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(paths.systemCachePath, 'utf8')) as CacheFile
      if (parsed.version === SYSTEM_FONT_CACHE_VERSION) {
        cache = parsed
      }
    } catch {
      cache = { faces: [], stamps: {} }
    }
  }

  const catalog = loadCatalog(paths)
  const byInstall = new Map(
    catalog.entries
      .filter((entry) => entry.installedPath)
      .map((entry) => [path.resolve(entry.installedPath!), entry.id]),
  )
  const bySource = new Map(
    catalog.entries.map((entry) => [path.resolve(entry.sourcePath), entry.id]),
  )
  const cachedByPath = new Map<string, SystemFace[]>()
  for (const face of cache.faces) {
    const list = cachedByPath.get(face.path)
    if (list) list.push(face)
    else cachedByPath.set(face.path, [face])
  }

  const nextFaces: SystemFace[] = []
  const nextStamps: Record<string, number> = {}
  const seenPaths = new Set<string>()

  for (const filePath of files) {
    let mtime = 0
    try {
      mtime = readFileStat(filePath).mtimeMs
    } catch {
      continue
    }
    nextStamps[filePath] = mtime
    seenPaths.add(path.resolve(filePath))
    const cached = cachedByPath.get(filePath) ?? []
    if (cache.stamps[filePath] === mtime && cached.length > 0) {
      nextFaces.push(
        ...cached.map((face) => ({
          ...face,
          managedId: byInstall.get(path.resolve(filePath)) ?? bySource.get(path.resolve(filePath)),
          protected: isProtectedPath(filePath, paths),
          writable: isWritable(filePath) && !isProtectedPath(filePath, paths),
        })),
      )
      continue
    }
    try {
      const parsed = parseFontFile(filePath)
      for (const face of parsed.faces) {
        nextFaces.push({
          path: filePath,
          familyName: face.familyName,
          styleName: face.styleName,
          fullName: face.fullName,
          postscriptName: face.postscriptName,
          isVariable: face.isVariable,
          instanceCount: face.instanceCount,
          instanceNames: face.instanceNames,
          weight: face.weight,
          italic: face.italic,
          format: parsed.format,
          previewSample: parsed.previewSample,
          protected: isProtectedPath(filePath, paths),
          writable: isWritable(filePath) && !isProtectedPath(filePath, paths),
          managedId:
            byInstall.get(path.resolve(filePath)) ?? bySource.get(path.resolve(filePath)),
        })
      }
    } catch {
      // Skip unreadable or corrupt fonts.
    }
  }

  for (const entry of catalog.entries) {
    if (entry.status !== 'deactivated' || !entry.disabledPath || !fs.existsSync(entry.disabledPath)) {
      continue
    }
    if (!isUnderAnyRoot(entry.sourcePath, [paths.computerFontsDir])) {
      continue
    }
    if (seenPaths.has(path.resolve(entry.disabledPath))) continue
    seenPaths.add(path.resolve(entry.disabledPath))
    for (const face of entry.faces) {
      nextFaces.push({
        path: entry.disabledPath,
        familyName: face.familyName,
        styleName: face.styleName,
        fullName: face.fullName,
        postscriptName: face.postscriptName,
        isVariable: face.isVariable,
        instanceCount: face.instanceCount,
        instanceNames: face.instanceNames,
        weight: face.weight,
        italic: face.italic,
        format: entry.format,
        previewSample: entry.previewSample,
        protected: false,
        writable: true,
        managedId: entry.id,
        deactivated: true,
      })
    }
  }

  fs.mkdirSync(paths.dataRoot, { recursive: true })
  fs.writeFileSync(
    paths.systemCachePath,
    JSON.stringify({ version: SYSTEM_FONT_CACHE_VERSION, faces: nextFaces, stamps: nextStamps }),
  )
  return nextFaces
}

export function allowedFontPath(filePath: string, paths: AppPaths): boolean {
  return isFullyUnderAnyRoot(filePath, [
    paths.installDir,
    paths.disabledDir,
    paths.sourcesDir,
    paths.uploadsDir,
    paths.userFontsDir,
    paths.computerFontsDir,
    paths.systemFontsDir,
    paths.seedDir,
  ])
}

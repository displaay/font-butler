import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import chokidar, { type FSWatcher } from 'chokidar'
import { isFullyUnderAnyRoot } from './containment.ts'
import { isFontFile, parseFontFile } from './parse.ts'
import type { FontFaceInfo } from './types.ts'

export const TEST_INSTALL_APP_NAME = 'Displaay Font Builder'

/** Glyphs 3 and 4 session fonts. Font Builder lists these in `gui/worker.py`; the Glyphs plugin uses `GSGlyphsInfo.applicationSupportPath()/Temp`. */
export const GLYPHS_TEST_INSTALL_APP_NAMES = ['Glyphs 3', 'Glyphs 4'] as const

export type TestInstallFont = {
  id: string
  path: string
  familyName: string
  styleName: string
  fullName: string
  postscriptName: string
  isVariable: boolean
  instanceCount: number
  instanceNames: string[]
  weight: number
  italic: boolean
  format: string
  previewSample?: string
  mtimeMs: number
  size: number
  faces: FontFaceInfo[]
}

export function defaultTestInstallDir(home = os.homedir()): string {
  return path.join(home, 'Library', 'Application Support', TEST_INSTALL_APP_NAME, 'TestInstall')
}

export function glyphsTestInstallDirs(home = os.homedir()): string[] {
  return GLYPHS_TEST_INSTALL_APP_NAMES.map((name) =>
    path.join(home, 'Library', 'Application Support', name, 'Temp'),
  )
}

export function testInstallDirs(home = os.homedir()): string[] {
  return [defaultTestInstallDir(home), ...glyphsTestInstallDirs(home)]
}

export function testInstallId(filePath: string): string {
  return `ti_${createHash('sha1').update(path.resolve(filePath)).digest('hex').slice(0, 16)}`
}

/** Real font file inside `dir`, or null when the path escapes it (including symlinks). */
export function resolveTestInstallFile(filePath: string, dir: string): string | null {
  if (!filePath || !dir) return null
  const root = path.resolve(dir)
  if (!fs.existsSync(root)) return null
  const requested = path.resolve(filePath)
  if (!isFullyUnderAnyRoot(requested, [root])) return null
  let real: string
  try {
    real = fs.realpathSync(requested)
  } catch {
    return null
  }
  if (!isFullyUnderAnyRoot(real, [root])) return null
  try {
    if (!fs.statSync(real).isFile() || !isFontFile(real)) return null
  } catch {
    return null
  }
  return real
}

export function resolveTestInstallFileInDirs(filePath: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    const resolved = resolveTestInstallFile(filePath, dir)
    if (resolved) return resolved
  }
  return null
}

export function scanTestInstallDir(dir: string): TestInstallFont[] {
  const root = path.resolve(dir)
  if (!fs.existsSync(root)) return []
  let names: string[]
  try {
    names = fs.readdirSync(root)
  } catch {
    return []
  }
  const fonts: TestInstallFont[] = []
  for (const name of names) {
    const filePath = resolveTestInstallFile(path.join(root, name), root)
    if (!filePath) continue
    try {
      const stat = fs.statSync(filePath)
      const parsed = parseFontFile(filePath)
      const face = parsed.faces[0]
      if (!face) continue
      fonts.push({
        id: testInstallId(filePath),
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
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        faces: parsed.faces,
      })
    } catch {
      // Skip unreadable files so one bad font does not hide the rest.
    }
  }
  fonts.sort((a, b) => a.path.localeCompare(b.path))
  return fonts
}

export function scanTestInstallDirs(dirs: string[]): TestInstallFont[] {
  const fonts = dirs.flatMap((dir) => scanTestInstallDir(dir))
  fonts.sort((a, b) => a.path.localeCompare(b.path))
  return fonts
}

export function deleteTestInstallFiles(dir: string, filePaths: string[]): string[] {
  const removed: string[] = []
  for (const filePath of filePaths) {
    const resolved = resolveTestInstallFile(filePath, dir)
    if (!resolved) continue
    try {
      fs.unlinkSync(resolved)
      removed.push(resolved)
    } catch {
      // Already gone.
    }
  }
  return removed
}

export function startTestInstallWatch(dir: string, onChange: () => void): () => Promise<void> {
  const root = path.resolve(dir)
  const parent = path.dirname(root)
  let watcher: FSWatcher | null = null
  let parentWatcher: FSWatcher | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let poll: ReturnType<typeof setInterval> | null = null
  let closed = false

  const kick = () => {
    if (closed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!closed) onChange()
    }, 300)
  }

  const watchDir = () => {
    if (closed || watcher || !fs.existsSync(root)) return
    watcher = chokidar.watch(root, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    })
    watcher.on('add', kick)
    watcher.on('unlink', kick)
    watcher.on('change', kick)
  }

  const watchParent = () => {
    if (closed || parentWatcher || !fs.existsSync(parent)) return
    parentWatcher = chokidar.watch(parent, { ignoreInitial: true, depth: 0 })
    parentWatcher.on('addDir', (added) => {
      if (path.resolve(added) !== root) return
      watchDir()
      kick()
    })
  }

  watchDir()
  watchParent()
  if (!fs.existsSync(parent)) {
    poll = setInterval(() => {
      if (!fs.existsSync(parent) && !fs.existsSync(root)) return
      if (poll) clearInterval(poll)
      poll = null
      watchParent()
      watchDir()
      kick()
    }, 2000)
    poll.unref?.()
  }

  return async () => {
    closed = true
    if (timer) clearTimeout(timer)
    if (poll) clearInterval(poll)
    await watcher?.close()
    await parentWatcher?.close()
    watcher = null
    parentWatcher = null
  }
}

export function startTestInstallWatches(dirs: string[], onChange: () => void): () => Promise<void> {
  const stops = dirs.map((dir) => startTestInstallWatch(dir, onChange))
  return async () => {
    await Promise.all(stops.map((stop) => stop()))
  }
}

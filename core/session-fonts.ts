import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

type SessionFontsAddon = {
  unregisterSessionFonts: (paths: string[]) => number
  isSessionScopedFont: (filePath: string) => boolean
}

const require = createRequire(import.meta.url)
const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function addonCandidates(): string[] {
  const resourcesPath =
    'resourcesPath' in process && typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  return [
    path.join(resourcesPath, 'app.asar.unpacked/electron/session-fonts.node'),
    path.join(moduleDir, 'session-fonts.node'),
    path.join(moduleDir, '../electron/session-fonts.node'),
  ]
}

function devAddonPaths(): { src: string; out: string } | null {
  const src = path.join(moduleDir, '../electron/session-fonts.mm')
  if (!fs.existsSync(src)) return null
  return { src, out: path.join(moduleDir, '../electron/session-fonts.node') }
}

function devAddonIsCurrent(src: string, out: string): boolean {
  if (!fs.existsSync(out)) return false
  return fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs
}

function compileDevAddon(): string | null {
  if (process.platform !== 'darwin') return null
  const paths = devAddonPaths()
  if (!paths) return null
  if (devAddonIsCurrent(paths.src, paths.out)) return paths.out
  fs.mkdirSync(path.dirname(paths.out), { recursive: true })
  const result = spawnSync(
    'clang++',
    [
      '-std=c++17',
      '-ObjC++',
      '-shared',
      '-fPIC',
      '-undefined',
      'dynamic_lookup',
      '-mmacosx-version-min=11.0',
      '-framework',
      'CoreText',
      '-framework',
      'Foundation',
      '-o',
      paths.out,
      paths.src,
    ],
    { encoding: 'utf8' },
  )
  return result.status === 0 && fs.existsSync(paths.out) ? paths.out : null
}

function addonIsCurrent(addon: Partial<SessionFontsAddon>): addon is SessionFontsAddon {
  return typeof addon.unregisterSessionFonts === 'function' && typeof addon.isSessionScopedFont === 'function'
}

let loadedAddon: SessionFontsAddon | null | undefined

function loadAddon(): SessionFontsAddon | null {
  if (loadedAddon !== undefined) return loadedAddon
  loadedAddon = null
  if (process.platform !== 'darwin') return null
  const candidates = addonCandidates()
  const compiled = compileDevAddon()
  if (compiled) candidates.unshift(compiled)
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate) || !fs.existsSync(candidate)) continue
    seen.add(candidate)
    try {
      const addon = require(candidate) as Partial<SessionFontsAddon>
      if (!addonIsCurrent(addon)) continue
      loadedAddon = addon
      return addon
    } catch {
      continue
    }
  }
  return null
}

/** True when Core Text has this file registered for the session (a Glyphs test install). */
export function isSessionScopedFont(filePath: string): boolean {
  if (!filePath || process.platform !== 'darwin') return false
  try {
    return loadAddon()?.isSessionScopedFont(filePath) ?? false
  } catch {
    return false
  }
}

/** Unregister session-scoped Core Text fonts. Missing addon still lets the caller delete files. */
export function unregisterSessionFonts(paths: string[]): void {
  if (paths.length === 0 || process.platform !== 'darwin') return
  try {
    loadAddon()?.unregisterSessionFonts(paths)
  } catch {
    // File deletion still removes the test install from Font Butler.
  }
}

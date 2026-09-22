import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

type SessionFontsAddon = {
  unregisterSessionFonts: (paths: string[]) => number
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

function compileDevAddon(): string | null {
  if (process.platform !== 'darwin') return null
  const src = path.join(moduleDir, '../electron/session-fonts.mm')
  const out = path.join(moduleDir, '../electron/session-fonts.node')
  if (!fs.existsSync(src)) return null
  fs.mkdirSync(path.dirname(out), { recursive: true })
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
      out,
      src,
    ],
    { encoding: 'utf8' },
  )
  return result.status === 0 && fs.existsSync(out) ? out : null
}

function loadAddon(): SessionFontsAddon | null {
  if (process.platform !== 'darwin') return null
  const candidates = addonCandidates()
  if (!candidates.some((candidate) => fs.existsSync(candidate))) {
    const compiled = compileDevAddon()
    if (compiled) candidates.unshift(compiled)
  }
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue
    try {
      return require(candidate) as SessionFontsAddon
    } catch {
      continue
    }
  }
  return null
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

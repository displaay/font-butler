import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileMachOSlices, strayMachOFiles } from './macho-slices.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(repoRoot, 'electron/finder-sync-receiver.node')

export function finderSyncReceiverAddonPath(root = repoRoot) {
  return path.join(root, 'electron/finder-sync-receiver.node')
}

function receiverCompileArgs(src, out, archArgs) {
  return [
    '-std=c++17',
    '-ObjC++',
    '-shared',
    '-fPIC',
    '-undefined',
    'dynamic_lookup',
    '-fobjc-arc',
    '-mmacosx-version-min=11.0',
    ...archArgs,
    '-framework',
    'Cocoa',
    '-framework',
    'Security',
    '-framework',
    'ServiceManagement',
    '-o',
    out,
    src,
  ]
}

export function compileFinderSyncReceiverAddon({
  repo = repoRoot,
  out = dest,
  arch = process.arch,
  clang = process.env.FONT_BUTLER_CLANG || 'clang++',
} = {}) {
  if (process.platform !== 'darwin') {
    return { ok: false, skipped: true, reason: 'Finder Sync receiver compiles only on macOS' }
  }
  const src = path.join(repo, 'electron/finder-sync-receiver.mm')
  if (!fs.existsSync(src)) {
    return { ok: false, skipped: false, reason: `Missing ${src}` }
  }
  const compiled = compileMachOSlices({
    out,
    arch,
    clang,
    spawnSync,
    argsFor: (sliceOut, archArgs) => receiverCompileArgs(src, sliceOut, archArgs),
  })
  if (!compiled.ok) return compiled
  const stray = strayMachOFiles(path.dirname(out), { slicesOnly: true })
  if (stray.length) {
    return { ok: false, skipped: false, reason: `Stray Mach-O next to the Finder Sync receiver: ${stray.join(', ')}` }
  }
  return compiled
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const result = compileFinderSyncReceiverAddon()
  if (result.skipped) {
    console.log(result.reason)
    process.exit(0)
  }
  if (!result.ok) {
    console.error(result.reason)
    process.exit(1)
  }
  console.log(`Wrote ${result.out}`)
}

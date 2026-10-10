import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { finderSyncClangArchArgs } from '../electron/finder-sync.mjs'

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
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const slices = finderSyncClangArchArgs(arch)
  const commands = (slices.length ? slices : [[]]).map((archArgs, index) => {
    const sliceOut = slices.length > 1 ? `${out}.slice${index}` : out
    return { sliceOut, args: receiverCompileArgs(src, sliceOut, archArgs) }
  })
  for (const command of commands) {
    const result = spawnSync(clang, command.args, { encoding: 'utf8' })
    if (result.status !== 0) {
      const detail = [result.stderr, result.stdout, result.error?.message].filter(Boolean).join('\n')
      return { ok: false, skipped: false, reason: detail || `clang++ exited ${result.status}` }
    }
  }
  if (commands.length > 1) {
    const lipo = spawnSync('lipo', ['-create', ...commands.map((command) => command.sliceOut), '-output', out], {
      encoding: 'utf8',
    })
    if (lipo.status !== 0) {
      const detail = [lipo.stderr, lipo.stdout, lipo.error?.message].filter(Boolean).join('\n')
      return { ok: false, skipped: false, reason: detail || 'lipo failed for the Finder Sync receiver' }
    }
  }
  return { ok: true, skipped: false, out }
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

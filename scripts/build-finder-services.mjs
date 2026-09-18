import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(repoRoot, 'electron/finder-services.node')

export function finderServicesAddonPath(root = repoRoot) {
  return path.join(root, 'electron/finder-services.node')
}

export function compileFinderServicesAddon({
  repo = repoRoot,
  out = dest,
  clang = process.env.FONT_BUTLER_CLANG || 'clang++',
} = {}) {
  if (process.platform !== 'darwin') {
    return { ok: false, skipped: true, reason: 'Finder services compile only on macOS' }
  }
  const src = path.join(repo, 'electron/finder-services.mm')
  if (!fs.existsSync(src)) {
    return { ok: false, skipped: false, reason: `Missing ${src}` }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const result = spawnSync(
    clang,
    [
      '-std=c++17',
      '-ObjC++',
      '-shared',
      '-fPIC',
      '-undefined',
      'dynamic_lookup',
      '-mmacosx-version-min=11.0',
      '-framework',
      'Cocoa',
      '-o',
      out,
      src,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout, result.error?.message].filter(Boolean).join('\n')
    return { ok: false, skipped: false, reason: detail || `clang++ exited ${result.status}` }
  }
  return { ok: true, skipped: false, out }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const result = compileFinderServicesAddon()
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

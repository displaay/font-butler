import { spawnSync as nodeSpawnSync } from 'node:child_process'
import {
  closeSync,
  mkdirSync as nodeMkdirSync,
  mkdtempSync as nodeMkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync as nodeRmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { finderSyncClangArchArgs } from '../electron/finder-sync.mjs'

const MACHO_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcafebabe, 0xbebafeca, 0xcefaedfe, 0xcffaedfe])

export function bufferIsMachO(buffer) {
  if (!buffer || buffer.length < 4) return false
  return MACHO_MAGICS.has(buffer.readUInt32BE(0))
}

/**
 * Mach-O files under `root` that are not in `allow`, plus any `*.sliceN`
 * file. Symlinks are not followed. `allow` entries are absolute or relative
 * paths of binaries that belong in the bundle.
 */
export function strayMachOFiles(root, { allow = [], slicesOnly = false } = {}) {
  if (!root) return []
  const allowed = new Set(allow.map((file) => path.resolve(file)))
  const stray = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      if (/\.slice\d+$/.test(entry.name)) {
        stray.push(full)
        continue
      }
      if (slicesOnly || allowed.has(path.resolve(full))) continue
      let fd
      try {
        fd = openSync(full, 'r')
        const buffer = Buffer.alloc(4)
        const bytes = readSync(fd, buffer, 0, 4, 0)
        if (bytes >= 4 && bufferIsMachO(buffer)) stray.push(full)
      } catch {
        // Unreadable files are not reported as Mach-O.
      } finally {
        if (fd != null) closeSync(fd)
      }
    }
  }
  return stray.sort()
}

/**
 * Compile one or more clang slices, then lipo them onto `out` when there
 * are two. Slice files are written in a temp directory outside `out` and
 * removed afterwards, including when lipo fails.
 */
export function compileMachOSlices({
  out,
  arch = process.arch,
  clang = 'clang++',
  spawnSync = nodeSpawnSync,
  argsFor,
  mkdtempSync = nodeMkdtempSync,
  rmSync = nodeRmSync,
  mkdirSync = nodeMkdirSync,
  tempRoot = tmpdir(),
} = {}) {
  if (!out) return { ok: false, skipped: false, reason: 'Missing output path' }
  if (typeof argsFor !== 'function') return { ok: false, skipped: false, reason: 'Missing compile arguments' }
  mkdirSync(path.dirname(out), { recursive: true })
  const slices = finderSyncClangArchArgs(arch)
  const groups = slices.length ? slices : [[]]
  const scratch = groups.length > 1 ? mkdtempSync(path.join(tempRoot, 'font-butler-macho-')) : ''
  const failureText = (result, fallback) =>
    [result?.stderr, result?.stdout, result?.error?.message].filter(Boolean).join('\n') || fallback
  try {
    const sliceOuts = []
    for (let index = 0; index < groups.length; index += 1) {
      const sliceOut = scratch ? path.join(scratch, `slice${index}`) : out
      sliceOuts.push(sliceOut)
      const result = spawnSync(clang, argsFor(sliceOut, groups[index]), { encoding: 'utf8' })
      if (result.status !== 0) {
        return { ok: false, skipped: false, reason: failureText(result, `clang++ exited ${result.status}`) }
      }
    }
    if (scratch) {
      const lipo = spawnSync('lipo', ['-create', ...sliceOuts, '-output', out], { encoding: 'utf8' })
      if (lipo.status !== 0) {
        return { ok: false, skipped: false, reason: failureText(lipo, 'lipo failed') }
      }
    }
    return { ok: true, skipped: false, out }
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }
}

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Compile and run the native probe that a process which is not the Finder Sync
 * appex fails SecRequirement plus kSecCSStrictValidate, and that an anonymous
 * NSXPCListener rejects that client before submitAction runs.
 * Off macOS this is skipped. CI is Ubuntu; the Mac pack machine runs it.
 */
export function runFinderSyncXpcRejectionTest({
  repo = repoRoot,
  clang = process.env.FONT_BUTLER_CLANG || 'clang++',
  platform = process.platform,
} = {}) {
  if (platform !== 'darwin') {
    return { ok: false, skipped: true, reason: 'The Finder Sync XPC rejection test runs on macOS.' }
  }
  const source = path.join(repo, 'electron/finder-sync-xpc-test.mm')
  if (!fs.existsSync(source)) {
    return { ok: false, skipped: false, reason: `Missing ${source}` }
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-xpc-'))
  const binary = path.join(directory, 'finder-sync-xpc-test')
  try {
    const compiled = spawnSync(
      clang,
      [
        '-std=c++17',
        '-ObjC++',
        '-fobjc-arc',
        '-mmacosx-version-min=11.0',
        '-framework',
        'Cocoa',
        '-framework',
        'Security',
        '-o',
        binary,
        source,
      ],
      { encoding: 'utf8' },
    )
    if ((compiled.status ?? 1) !== 0) {
      const detail = [compiled.stderr, compiled.stdout, compiled.error?.message].filter(Boolean).join('\n')
      return { ok: false, skipped: false, reason: detail || `clang++ exited ${compiled.status}` }
    }
    const ran = spawnSync(binary, [], { encoding: 'utf8', timeout: 15000 })
    if ((ran.status ?? 1) !== 0) {
      const detail = [ran.stderr, ran.stdout, ran.error?.message].filter(Boolean).join('\n')
      return { ok: false, skipped: false, reason: detail || `XPC rejection test exited ${ran.status}` }
    }
    return { ok: true, skipped: false }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const result = runFinderSyncXpcRejectionTest()
  if (result.skipped) {
    console.log(result.reason)
    process.exit(0)
  }
  if (!result.ok) {
    console.error(result.reason)
    process.exit(1)
  }
  console.log('A wrongly signed Finder Sync XPC client was rejected.')
}

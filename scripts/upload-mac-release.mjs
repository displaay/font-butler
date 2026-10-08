import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNotarizedMacRelease, macReleaseFiles } from './assert-notarized-mac-release.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = assertNotarizedMacRelease(repoRoot)
if (failures.length) {
  console.error('Refusing to upload this macOS build.')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

const { version } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const files = macReleaseFiles(repoRoot)
const upload = [...files.dmgs, ...files.zips, ...files.zipBlockmaps, files.feed].filter((file) => existsSync(file))
const result = spawnSync('gh', ['release', 'upload', `v${version}`, ...upload, '--clobber'], {
  cwd: repoRoot,
  stdio: 'inherit',
})
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status === null ? 1 : result.status)

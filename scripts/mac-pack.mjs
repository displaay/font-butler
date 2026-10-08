import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyNotaryEnv,
  developerIdInKeychainOutput,
  electronBuilderArgs,
  packConfig,
  planMacPack,
} from './mac-signing.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = process.argv.includes('--release')

function developerIdPresent() {
  if (process.platform !== 'darwin') return false
  try {
    const output = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
    })
    return developerIdInKeychainOutput(output)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Could not list code signing identities (${message}).`)
    return false
  }
}

const plan = planMacPack({
  platform: process.platform,
  release,
  env: process.env,
  developerIdPresent: developerIdPresent(),
})

if (plan.error) {
  console.error(plan.error)
  process.exit(1)
}

console.log(plan.summary)

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const configDir = mkdtempSync(path.join(tmpdir(), 'font-butler-mac-'))
const configPath = path.join(configDir, 'electron-builder.json')
writeFileSync(configPath, JSON.stringify(packConfig(pkg.build, plan)))

const cli = path.join(repoRoot, 'node_modules/electron-builder/cli.js')
let status = 1
try {
  const result = spawnSync(process.execPath, [cli, ...electronBuilderArgs(configPath)], {
    cwd: repoRoot,
    env: applyNotaryEnv(process.env, plan),
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(result.error.message)
    status = 1
  } else {
    status = result.status === null ? 1 : result.status
  }
} finally {
  rmSync(configDir, { recursive: true, force: true })
}

if (status !== 0) process.exit(status)

if (plan.keychainProfile) {
  // The DMG was stapled inside afterAllArtifactBuild. electron-builder writes
  // latest-mac.yml only after that hook, in publishManager.awaitTasks(), with
  // the pre-staple DMG hash. Rewrite sha512/size from the files now on disk
  // and drop the stale DMG blockmap before the notarization assert.
  const { rewriteMacUpdateFeed } = await import('./mac-dmg-staple.mjs')
  try {
    await rewriteMacUpdateFeed(path.join(repoRoot, 'release'))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  const check = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/assert-notarized-mac-release.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  if (check.error) {
    console.error(check.error.message)
    process.exit(1)
  }
  process.exit(check.status === null ? 1 : check.status)
}

process.exit(0)

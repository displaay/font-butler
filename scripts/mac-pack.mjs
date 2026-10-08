import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyNotaryEnv,
  developerIdInKeychainOutput,
  electronBuilderArgs,
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

const cli = path.join(repoRoot, 'node_modules/electron-builder/cli.js')
const result = spawnSync(process.execPath, [cli, ...electronBuilderArgs(plan)], {
  cwd: repoRoot,
  env: applyNotaryEnv(process.env, plan),
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status === null ? 1 : result.status)

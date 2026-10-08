import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { DEVELOPER_ID_IDENTITY } from './mac-signing.mjs'

const require = createRequire(import.meta.url)
const { serializeToYaml } = require('builder-util')
const yaml = require('js-yaml')

export function sha512Base64(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('base64')))
  })
}

/**
 * electron-builder 26 writes `latest-mac.yml` in `publishManager.awaitTasks()`,
 * which runs after `afterAllArtifactBuild`. By then the DMG staple has already
 * changed the DMG bytes, so the file on disk does not match the hashes in that
 * yml. Recompute sha512 and size for the zip and the DMG from the bytes on disk,
 * and drop the stale DMG blockmap. The zip blockmap stays: the zip is built
 * from the already-stapled app and is not modified here.
 */
export async function rewriteMacUpdateFeed(releaseDir) {
  const ymlPath = path.join(releaseDir, 'latest-mac.yml')
  if (!existsSync(ymlPath)) {
    throw new Error(
      `${ymlPath} is missing after electron-builder finished. The update feed would not match the stapled files.`,
    )
  }
  const doc = yaml.load(readFileSync(ymlPath, 'utf8'))
  if (!doc || !Array.isArray(doc.files) || doc.files.length === 0) {
    throw new Error(`latest-mac.yml has no files list (${ymlPath}).`)
  }
  if (typeof doc.path !== 'string' || !doc.path.endsWith('.zip')) {
    throw new Error('latest-mac.yml path must be the update zip.')
  }
  let dmgEntries = 0
  let zipEntry = null
  for (const entry of doc.files) {
    if (!entry || typeof entry.url !== 'string' || entry.url.length === 0) {
      throw new Error(`latest-mac.yml has a files entry without a url (${ymlPath}).`)
    }
    const name = path.basename(entry.url)
    const file = path.join(releaseDir, name)
    if (!existsSync(file)) {
      throw new Error(`latest-mac.yml lists ${entry.url}, but ${file} is not on disk.`)
    }
    entry.sha512 = await sha512Base64(file)
    entry.size = statSync(file).size
    if (name === path.basename(doc.path)) zipEntry = entry
    if (name.endsWith('.dmg')) {
      dmgEntries += 1
      delete entry.blockMapSize
    }
  }
  if (dmgEntries === 0) {
    throw new Error('latest-mac.yml has no DMG entry to match the stapled disk image.')
  }
  if (!zipEntry) {
    throw new Error(`latest-mac.yml path ${doc.path} is not in files.`)
  }
  doc.sha512 = zipEntry.sha512
  if (typeof doc.size === 'number') doc.size = zipEntry.size
  for (const name of readdirSync(releaseDir)) {
    if (name.endsWith('.dmg.blockmap')) unlinkSync(path.join(releaseDir, name))
  }
  writeFileSync(ymlPath, serializeToYaml(doc, false, true))
}

function signedByDeveloperId(file) {
  const result = spawnSync('codesign', ['-dv', '--verbose=4', file], { encoding: 'utf8' })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const signed =
    (result.status ?? 1) === 0 &&
    output.includes(`Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}`) &&
    !/Signature=adhoc/i.test(output)
  return { signed, output }
}

/**
 * Sign happened inside electron-builder (`dmg.sign: true`). Notarize and staple
 * afterwards. `xattr -cr` must not run on the DMG after this: the staple is an
 * xattr, and stripping it would leave an unstapled disk image.
 *
 * Do not read or write `latest-mac.yml` here. electron-builder 26.15.3 writes
 * that file in `publishManager.awaitTasks()` after this hook returns, so it
 * does not exist yet. `scripts/mac-pack.mjs` rewrites the feed once the
 * builder process has exited.
 *
 * `deps` is for tests that simulate this hook on a non-macOS host. Production
 * calls omit it and notarize with the keychain profile.
 */
export async function stapleSignedDmgs(artifactPaths, env = process.env, deps = {}) {
  const profile = (env.APPLE_KEYCHAIN_PROFILE || '').trim()
  if (!profile) return
  const notarize = deps.notarize
  const verifySignature = deps.verifySignature ?? signedByDeveloperId
  if (!notarize && process.platform !== 'darwin') {
    throw new Error(
      'APPLE_KEYCHAIN_PROFILE is set, but this is not macOS. Refusing to finish without notarizing the DMG.',
    )
  }
  const dmgs = (artifactPaths ?? []).filter((file) => file.endsWith('.dmg'))
  if (dmgs.length === 0) {
    throw new Error('APPLE_KEYCHAIN_PROFILE is set, but no DMG was produced. Refusing to finish an unnotarized release.')
  }
  const notarizeDmg = notarize ?? (await import('@electron/notarize')).notarize
  const keychain = (env.APPLE_KEYCHAIN || '').trim()
  for (const dmg of dmgs) {
    const check = verifySignature(dmg)
    if (!check.signed) {
      throw new Error(
        `Refusing to notarize ${path.basename(dmg)} because it is not signed with Developer ID identity "${DEVELOPER_ID_IDENTITY}". The build will not fall back to an unsigned disk image.\n${check.output}`,
      )
    }
    console.log(`Notarizing and stapling ${path.basename(dmg)}`)
    await notarizeDmg({
      appPath: dmg,
      keychainProfile: profile,
      ...(keychain ? { keychain } : {}),
    })
  }
}

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
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

/** Stapling the DMG changes its bytes after electron-builder hashed it. Keep the zip hash. Drop the stale DMG blockmap. */
export async function refreshDmgUpdateInfo(ymlPath, dmgPaths) {
  const doc = yaml.load(readFileSync(ymlPath, 'utf8'))
  if (!doc || !Array.isArray(doc.files)) {
    throw new Error(`latest-mac.yml has no files list (${ymlPath}).`)
  }
  const zipPath = doc.path
  const zipSha = doc.sha512
  if (typeof zipPath !== 'string' || !zipPath.endsWith('.zip')) {
    throw new Error('latest-mac.yml path must stay the update zip.')
  }
  const byName = new Map(dmgPaths.map((file) => [path.basename(file), file]))
  let updated = 0
  for (const entry of doc.files) {
    const file = byName.get(entry.url)
    if (!file) continue
    entry.sha512 = await sha512Base64(file)
    entry.size = statSync(file).size
    updated += 1
    const blockmap = `${file}.blockmap`
    if (existsSync(blockmap)) unlinkSync(blockmap)
  }
  if (updated !== dmgPaths.length) {
    throw new Error(
      `latest-mac.yml is missing ${dmgPaths.length - updated} stapled DMG ${dmgPaths.length - updated === 1 ? 'entry' : 'entries'}.`,
    )
  }
  if (doc.path !== zipPath || doc.sha512 !== zipSha) {
    throw new Error('Refusing to rewrite latest-mac.yml because the zip hash would change.')
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
 */
export async function stapleSignedDmgs(artifactPaths, env = process.env) {
  const profile = (env.APPLE_KEYCHAIN_PROFILE || '').trim()
  if (!profile) return
  if (process.platform !== 'darwin') {
    throw new Error(
      'APPLE_KEYCHAIN_PROFILE is set, but this is not macOS. Refusing to finish without notarizing the DMG.',
    )
  }
  const dmgs = (artifactPaths ?? []).filter((file) => file.endsWith('.dmg'))
  if (dmgs.length === 0) {
    throw new Error('APPLE_KEYCHAIN_PROFILE is set, but no DMG was produced. Refusing to finish an unnotarized release.')
  }
  const { notarize } = await import('@electron/notarize')
  const keychain = (env.APPLE_KEYCHAIN || '').trim()
  for (const dmg of dmgs) {
    const check = signedByDeveloperId(dmg)
    if (!check.signed) {
      throw new Error(
        `Refusing to notarize ${path.basename(dmg)} because it is not signed with Developer ID identity "${DEVELOPER_ID_IDENTITY}". The build will not fall back to an unsigned disk image.\n${check.output}`,
      )
    }
    console.log(`Notarizing and stapling ${path.basename(dmg)}`)
    await notarize({
      appPath: dmg,
      keychainProfile: profile,
      ...(keychain ? { keychain } : {}),
    })
  }
  const ymlPath = path.join(path.dirname(dmgs[0]), 'latest-mac.yml')
  if (!existsSync(ymlPath)) {
    throw new Error(`Stapled the DMG but ${ymlPath} is missing, so the update feed would not match the file.`)
  }
  await refreshDmgUpdateInfo(ymlPath, dmgs)
}

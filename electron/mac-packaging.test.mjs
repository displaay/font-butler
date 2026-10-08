import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { notarizationFailures } from '../scripts/assert-notarized-mac-release.mjs'
import { refreshDmgUpdateInfo, sha512Base64 } from '../scripts/mac-dmg-staple.mjs'
import {
  ADHOC_ENTITLEMENTS,
  DEVELOPER_ID_IDENTITY,
  NOTARY_KEYCHAIN_PROFILE,
  applyNotaryEnv,
  developerIdInKeychainOutput,
  electronBuilderArgs,
  packConfig,
  planMacPack,
  releaseConfigErrors,
} from '../scripts/mac-signing.mjs'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

function readRepo(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

function pkg() {
  return JSON.parse(readRepo('package.json'))
}

test('mac release config signs with the Developer ID identity and notarizes via the keychain profile', () => {
  const parsed = pkg()
  assert.deepEqual(releaseConfigErrors(parsed), [])
  assert.equal(parsed.build.mac.identity, DEVELOPER_ID_IDENTITY)
  assert.equal(parsed.build.mac.hardenedRuntime, true)
  assert.equal(parsed.build.mac.notarize, true)
  assert.equal(parsed.build.mac.type, undefined)
  assert.equal(parsed.build.mac.signIgnore, undefined)
  assert.equal(parsed.build.mac.entitlements, 'build/entitlements.mac.plist')
  assert.equal(parsed.build.mac.entitlementsInherit, 'build/entitlements.mac.plist')
  assert.equal(parsed.build.dmg, undefined)
  assert.equal(parsed.build.afterPack, './scripts/strip-mac-xattrs.mjs')
  assert.equal(parsed.build.afterAllArtifactBuild, './scripts/strip-mac-xattrs.mjs')
  assert.match(parsed.scripts.dist, /COPYFILE_DISABLE=1/)
  assert.match(parsed.scripts.dist, /node scripts\/mac-pack\.mjs/)
  assert.doesNotMatch(parsed.scripts.dist, /--release/)
  assert.match(parsed.scripts['release:mac'], /mac-pack\.mjs --release/)
  assert.match(parsed.scripts['publish:mac'], /upload-mac-release\.mjs/)
  assert.match(parsed.scripts['bundle:python'], /COPYFILE_DISABLE=1/)
  assert.doesNotMatch(parsed.scripts.dist, /CSC_IDENTITY_AUTO_DISCOVERY=false/)
  assert.doesNotMatch(parsed.scripts['release:mac'], /CSC_IDENTITY_AUTO_DISCOVERY=false/)
  assert.match(readRepo('scripts/strip-mac-xattrs.mjs'), /compileFinderServicesAddon/)
  assert.match(readRepo('scripts/strip-mac-xattrs.mjs'), /stapleSignedDmgs/)
  assert.match(readRepo('scripts/mac-pack.mjs'), /find-identity/)
  assert.match(readRepo('scripts/mac-pack.mjs'), /assert-notarized-mac-release/)
  assert.doesNotMatch(readRepo('docs/releases.md'), /quisek\.com/)
  assert.match(readRepo('docs/releases.md'), /<your-apple-id>/)
  assert.match(readRepo('docs/releases.md'), /git worktree add ~\/git\/font-butler-release origin\/main/)
  assert.match(readRepo('docs/releases.md'), /download this version manually once/i)
})

test('electron-builder 26 accepts the mac signing config and the notarized DMG sign flag', async () => {
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js')
  const build = pkg().build
  await validateConfiguration(build, { isEnabled: false })
  const release = planMacPack({
    platform: 'darwin',
    release: true,
    env: {},
    developerIdPresent: true,
  })
  const signed = packConfig(build, release)
  assert.equal(signed.dmg.sign, true)
  assert.equal(typeof signed.dmg.sign, 'boolean')
  assert.equal(signed.mac.identity, DEVELOPER_ID_IDENTITY)
  assert.equal(signed.mac.forceCodeSigning, true)
  await validateConfiguration(signed, { isEnabled: false })

  const adHoc = planMacPack({
    platform: 'darwin',
    release: false,
    env: {},
    developerIdPresent: false,
  })
  const local = packConfig(build, adHoc)
  assert.equal(local.dmg, undefined)
  assert.equal(local.mac.identity, '-')
  assert.equal(local.mac.entitlements, ADHOC_ENTITLEMENTS)
  assert.equal(local.mac.forceCodeSigning, false)
  await validateConfiguration(local, { isEnabled: false })
  assert.deepEqual(electronBuilderArgs('/tmp/font-butler-electron-builder.json'), [
    '--mac',
    '--publish',
    'never',
    '--config',
    '/tmp/font-butler-electron-builder.json',
  ])
})

test('Developer ID entitlements are allow-jit only', () => {
  const entitlements = readRepo('build/entitlements.mac.plist')
  const adhoc = readRepo('build/entitlements.mac.adhoc.plist')
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/)
  assert.doesNotMatch(entitlements, /allow-unsigned-executable-memory/)
  assert.doesNotMatch(entitlements, /disable-library-validation/)
  assert.doesNotMatch(entitlements, /get-task-allow/)
  assert.match(adhoc, /com\.apple\.security\.cs\.allow-jit/)
  assert.match(adhoc, /com\.apple\.security\.cs\.disable-library-validation/)
  assert.doesNotMatch(adhoc, /allow-unsigned-executable-memory/)
  assert.doesNotMatch(adhoc, /get-task-allow/)
  assert.equal(ADHOC_ENTITLEMENTS, 'build/entitlements.mac.adhoc.plist')
})

test('tag release workflow packages on macOS and refuses an un-notarized publish', () => {
  const workflow = readRepo('.github/workflows/release.yml')
  const ci = readRepo('.github/workflows/ci.yml')
  assert.match(workflow, /tags:\s*\n\s*- "v\*"/)
  assert.match(workflow, /runs-on: macos-latest/)
  assert.match(workflow, /npm run dist/)
  assert.match(workflow, /assert-notarized-mac-release\.mjs/)
  assert.match(workflow, /softprops\/action-gh-release@v2/)
  const gate = workflow.indexOf('assert-notarized-mac-release.mjs')
  const publish = workflow.indexOf('softprops/action-gh-release@v2')
  assert.ok(gate > 0 && gate < publish)
  assert.match(workflow, /latest-mac\.yml/)
  assert.match(workflow, /draft: false/)
  assert.match(workflow, /prerelease: false/)
  assert.doesNotMatch(workflow, /CSC_IDENTITY_AUTO_DISCOVERY=false/)
  assert.match(ci, /github\.ref_type != 'tag'/)
})

test('release:mac forces Developer ID signing, DMG stapling, and the notary profile', () => {
  const plan = planMacPack({
    platform: 'darwin',
    release: true,
    env: {},
    developerIdPresent: true,
  })
  assert.equal(plan.mode, 'release')
  assert.equal(plan.identity, DEVELOPER_ID_IDENTITY)
  assert.equal(plan.forceCodeSigning, true)
  assert.equal(plan.signDmg, true)
  assert.equal(plan.keychainProfile, NOTARY_KEYCHAIN_PROFILE)
  assert.match(plan.summary, /notarizing/)
  assert.doesNotMatch(plan.summary, /@/)
  const env = applyNotaryEnv(
    {
      APPLE_ID: 'person@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'secret',
      APPLE_KEYCHAIN_PROFILE: 'other',
      PATH: '/usr/bin',
    },
    plan,
  )
  assert.equal(env.APPLE_KEYCHAIN_PROFILE, NOTARY_KEYCHAIN_PROFILE)
  assert.equal(env.APPLE_ID, undefined)
  assert.equal(env.APPLE_APP_SPECIFIC_PASSWORD, undefined)
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.COPYFILE_DISABLE, '1')
})

test('release:mac keeps an explicit profile and optional keychain', () => {
  const plan = planMacPack({
    platform: 'darwin',
    release: true,
    env: { APPLE_KEYCHAIN_PROFILE: 'custom-profile', APPLE_KEYCHAIN: '/Library/Keychains/login.keychain-db' },
    developerIdPresent: true,
  })
  assert.equal(plan.keychainProfile, 'custom-profile')
  assert.equal(plan.keychain, '/Library/Keychains/login.keychain-db')
  assert.equal(plan.signDmg, true)
  const env = applyNotaryEnv({}, plan)
  assert.equal(env.APPLE_KEYCHAIN_PROFILE, 'custom-profile')
  assert.equal(env.APPLE_KEYCHAIN, '/Library/Keychains/login.keychain-db')
})

test('release:mac refuses to run off macOS or without the certificate', () => {
  const linux = planMacPack({
    platform: 'linux',
    release: true,
    env: { APPLE_KEYCHAIN_PROFILE: NOTARY_KEYCHAIN_PROFILE },
    developerIdPresent: false,
  })
  assert.match(linux.error, /macOS/)
  assert.equal(linux.identity, undefined)

  const missing = planMacPack({
    platform: 'darwin',
    release: true,
    env: {},
    developerIdPresent: false,
  })
  assert.match(missing.error, /ad-hoc/)
  assert.equal(missing.identity, undefined)
})

test('dist without a profile ad-hoc signs when the certificate is missing', () => {
  const plan = planMacPack({
    platform: 'darwin',
    release: false,
    env: {},
    developerIdPresent: false,
  })
  assert.equal(plan.mode, 'ad-hoc')
  assert.equal(plan.identity, '-')
  assert.equal(plan.forceCodeSigning, false)
  assert.equal(plan.signDmg, false)
  assert.equal(plan.keychainProfile, null)
  assert.equal(plan.adhocEntitlements, ADHOC_ENTITLEMENTS)
  const env = applyNotaryEnv({ APPLE_ID: 'person@example.com', APPLE_TEAM_ID: 'A7WWML89LQ' }, plan)
  assert.equal(env.APPLE_ID, undefined)
  assert.equal(env.APPLE_KEYCHAIN_PROFILE, undefined)
  assert.equal(env.APPLE_TEAM_ID, undefined)
})

test('a keychain profile never falls back to ad-hoc', () => {
  const missing = planMacPack({
    platform: 'darwin',
    release: false,
    env: { APPLE_KEYCHAIN_PROFILE: NOTARY_KEYCHAIN_PROFILE, APPLE_ID: 'person@example.com' },
    developerIdPresent: false,
  })
  assert.match(missing.error, /ad-hoc/)
  assert.equal(missing.mode, undefined)
  assert.equal(missing.identity, undefined)

  const linux = planMacPack({
    platform: 'linux',
    release: false,
    env: { APPLE_KEYCHAIN_PROFILE: NOTARY_KEYCHAIN_PROFILE },
    developerIdPresent: false,
  })
  assert.match(linux.error, /not macOS/)
  assert.equal(linux.identity, undefined)
})

test('dist with the certificate notarizes only when the keychain profile is set', () => {
  const absent = planMacPack({
    platform: 'darwin',
    release: false,
    env: { APPLE_ID: 'person@example.com', APPLE_APP_SPECIFIC_PASSWORD: 'secret', APPLE_TEAM_ID: 'A7WWML89LQ' },
    developerIdPresent: true,
  })
  assert.equal(absent.mode, 'developer-id')
  assert.equal(absent.identity, DEVELOPER_ID_IDENTITY)
  assert.equal(absent.forceCodeSigning, false)
  assert.equal(absent.signDmg, false)
  assert.equal(absent.keychainProfile, null)
  const stripped = applyNotaryEnv(
    { APPLE_ID: 'person@example.com', APPLE_APP_SPECIFIC_PASSWORD: 'secret' },
    absent,
  )
  assert.equal(stripped.APPLE_ID, undefined)
  assert.equal(stripped.APPLE_KEYCHAIN_PROFILE, undefined)

  const present = planMacPack({
    platform: 'darwin',
    release: false,
    env: { APPLE_KEYCHAIN_PROFILE: NOTARY_KEYCHAIN_PROFILE },
    developerIdPresent: true,
  })
  assert.equal(present.mode, 'notarize')
  assert.equal(present.forceCodeSigning, true)
  assert.equal(present.signDmg, true)
  assert.equal(present.keychainProfile, NOTARY_KEYCHAIN_PROFILE)
  const config = packConfig(pkg().build, present)
  assert.equal(config.dmg.sign, true)
  assert.equal(
    developerIdInKeychainOutput(`  1) ABCD "Developer ID Application: ${DEVELOPER_ID_IDENTITY}"`),
    true,
  )
  assert.equal(
    developerIdInKeychainOutput('  1) ABCD "Apple Development: DANIEL QUISEK (A7WWML89LQ)"'),
    false,
  )
})

test('a non-mac dist without a profile does not pretend to notarize', () => {
  const plan = planMacPack({
    platform: 'linux',
    release: false,
    env: {},
    developerIdPresent: false,
  })
  assert.equal(plan.mode, 'skip-platform')
  assert.equal(plan.keychainProfile, null)
  assert.equal(plan.signDmg, false)
  assert.equal(plan.forceCodeSigning, false)
  const env = applyNotaryEnv({ APPLE_KEYCHAIN_PROFILE: NOTARY_KEYCHAIN_PROFILE }, plan)
  assert.equal(env.APPLE_KEYCHAIN_PROFILE, undefined)
})

test('publish evidence fails closed for an ad-hoc or unstapled build', () => {
  const accepted = notarizationFailures({
    codesignDisplay: `Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}\nTeamIdentifier=A7WWML89LQ`,
    codesignVerifyStatus: 0,
    entitlements: 'com.apple.security.cs.allow-jit',
    staplerAppStatus: 0,
    staplerDmgStatus: 0,
    staplerZipAppStatus: 0,
    staplerDmgAppStatus: 0,
    spctlOutput: 'source=Notarized Developer ID',
    spctlStatus: 0,
  })
  assert.deepEqual(accepted, [])

  const adHoc = notarizationFailures({
    codesignDisplay: 'Signature=adhoc',
    codesignVerifyStatus: 0,
    entitlements: 'com.apple.security.cs.allow-jit\ncom.apple.security.cs.disable-library-validation',
    staplerAppStatus: 1,
    staplerDmgStatus: 1,
    staplerZipAppStatus: 1,
    staplerDmgAppStatus: 1,
    spctlOutput: 'source=no usable signature',
    spctlStatus: 1,
  })
  assert.ok(adHoc.some((failure) => /ad-hoc/.test(failure)))
  assert.ok(adHoc.some((failure) => /get-task-allow|library validation|stapler|spctl|Developer ID/.test(failure)))

  const debuggable = notarizationFailures({
    codesignDisplay: `Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}`,
    codesignVerifyStatus: 0,
    entitlements: 'com.apple.security.get-task-allow',
    staplerAppStatus: 0,
    staplerDmgStatus: 0,
    staplerZipAppStatus: 0,
    staplerDmgAppStatus: 0,
    spctlOutput: 'source=Notarized Developer ID',
    spctlStatus: 0,
  })
  assert.ok(debuggable.some((failure) => /get-task-allow/.test(failure)))
})

test('stapling the DMG refreshes only the DMG hash in latest-mac.yml', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'font-butler-feed-'))
  try {
    const dmg = path.join(dir, 'Font-Buttler-0.3.8-arm64.dmg')
    const blockmap = `${dmg}.blockmap`
    writeFileSync(dmg, 'stapled-dmg-bytes')
    writeFileSync(blockmap, 'stale-blockmap')
    const zipSha = 'zip-sha-must-stay'
    const ymlPath = path.join(dir, 'latest-mac.yml')
    writeFileSync(
      ymlPath,
      yaml.dump({
        version: '0.3.8',
        files: [
          { url: 'Font-Buttler-0.3.8-arm64.zip', sha512: zipSha, size: 10 },
          { url: 'Font-Buttler-0.3.8-arm64.dmg', sha512: 'old-dmg-sha', size: 1 },
        ],
        path: 'Font-Buttler-0.3.8-arm64.zip',
        sha512: zipSha,
      }),
    )
    await refreshDmgUpdateInfo(ymlPath, [dmg])
    const doc = yaml.load(readFileSync(ymlPath, 'utf8'))
    assert.equal(doc.path, 'Font-Buttler-0.3.8-arm64.zip')
    assert.equal(doc.sha512, zipSha)
    assert.equal(doc.files[0].sha512, zipSha)
    assert.equal(doc.files[1].sha512, await sha512Base64(dmg))
    assert.equal(doc.files[1].size, Buffer.byteLength('stapled-dmg-bytes'))
    assert.equal(existsSync(blockmap), false)
    assert.equal(readFileSync(ymlPath, 'utf8').includes('old-dmg-sha'), false)
    await assert.rejects(
      () => refreshDmgUpdateInfo(ymlPath, [path.join(dir, 'Font-Buttler-0.3.8-x64.dmg')]),
      /missing 1 stapled DMG entry/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

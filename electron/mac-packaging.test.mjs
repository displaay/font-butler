import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  TEST_FEED_ENV_REFUSAL,
  TEST_FEED_MARKER_REFUSAL,
  TEST_FEED_MARKER_UNREADABLE,
  TEST_FEED_MARKER_PROBE_FAILURE,
  assertNotarizedMacRelease,
  macReleaseAssetNames,
  notarizationFailures,
  packagedElectronMarkerFailures,
  prepareMacPublish,
  readZipAppTestFeedMarker,
  releaseAssetVersion,
  testFeedArchiveFailures,
  testFeedPublishEnvFailures,
  updateFeedFailures,
  zipHasTestFeedMarker,
} from '../scripts/assert-notarized-mac-release.mjs'
import {
  expectedReleaseTag,
  publishVersionedMacRelease,
  releaseCommitGuard,
  remoteTagCommitSha,
  remoteTagLsRemoteArgs,
  worktreeDirty,
} from '../scripts/upload-mac-release.mjs'
import { rewriteMacUpdateFeed, sha512Base64, stapleSignedDmgs } from '../scripts/mac-dmg-staple.mjs'
import {
  ADHOC_ENTITLEMENTS,
  DEVELOPER_ID_IDENTITY,
  NOTARY_KEYCHAIN_PROFILE,
  TEST_FEED_ADHOC_ENTITLEMENTS,
  TEST_FEED_BUILD_ENV,
  TEST_FEED_ENTITLEMENTS,
  TEST_FEED_VERSION_ENV,
  applyNotaryEnv,
  applyTestFeedMetadata,
  developerIdInKeychainOutput,
  electronBuilderArgs,
  packConfig,
  planMacPack,
  releaseConfigErrors,
} from '../scripts/mac-signing.mjs'
import { readAppTestFeedMarker } from '../electron/app-update-install.mjs'

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
  assert.equal(parsed.build.afterSign, './scripts/verify-finder-sync-appex.mjs')
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
  assert.match(readRepo('scripts/strip-mac-xattrs.mjs'), /prepareFinderSyncAppex/)
  assert.match(readRepo('scripts/strip-mac-xattrs.mjs'), /signFinderSyncAppex/)
  assert.match(readRepo('scripts/strip-mac-xattrs.mjs'), /stapleSignedDmgs/)
  assert.match(readRepo('scripts/mac-pack.mjs'), /find-identity/)
  const macPack = readRepo('scripts/mac-pack.mjs')
  const feedRewrite = macPack.indexOf('rewriteMacUpdateFeed')
  const notarizationAssert = macPack.indexOf('assert-notarized-mac-release')
  assert.ok(feedRewrite !== -1 && notarizationAssert !== -1 && feedRewrite < notarizationAssert)
  const stapleSource = readRepo('scripts/mac-dmg-staple.mjs')
  const stapleBody = stapleSource.slice(stapleSource.indexOf('export async function stapleSignedDmgs'))
  assert.doesNotMatch(stapleBody, /latest-mac\.yml/)
  assert.doesNotMatch(readRepo('docs/releases.md'), /quisek\.com/)
  assert.match(readRepo('docs/releases.md'), /<your-apple-id>/)
  assert.match(readRepo('docs/releases.md'), /git worktree add ~\/git\/font-butler-release origin\/main/)
  assert.match(readRepo('docs/releases.md'), /git tag "v\$\{version\}"/)
  assert.match(readRepo('docs/releases.md'), /git push origin "v\$\{version\}"/)
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

test('Developer ID entitlements are allow-jit plus the release app group', () => {
  const entitlements = readRepo('build/entitlements.mac.plist')
  const adhoc = readRepo('build/entitlements.mac.adhoc.plist')
  const testFeed = readRepo('build/entitlements.mac.test-feed.plist')
  const testAdhoc = readRepo('build/entitlements.mac.adhoc.test-feed.plist')
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/)
  assert.match(entitlements, /com\.apple\.security\.application-groups/)
  assert.match(entitlements, /A7WWML89LQ\.group\.app\.fontbutler\.desktop\.FinderSync</)
  assert.doesNotMatch(entitlements, /FinderSync\.Test/)
  assert.doesNotMatch(entitlements, /allow-unsigned-executable-memory/)
  assert.doesNotMatch(entitlements, /disable-library-validation/)
  assert.doesNotMatch(entitlements, /get-task-allow/)
  assert.match(adhoc, /com\.apple\.security\.cs\.allow-jit/)
  assert.match(adhoc, /com\.apple\.security\.cs\.disable-library-validation/)
  assert.match(adhoc, /A7WWML89LQ\.group\.app\.fontbutler\.desktop\.FinderSync</)
  assert.doesNotMatch(adhoc, /allow-unsigned-executable-memory/)
  assert.doesNotMatch(adhoc, /get-task-allow/)
  assert.match(testFeed, /A7WWML89LQ\.group\.app\.fontbutler\.desktop\.FinderSync\.Test</)
  assert.doesNotMatch(testFeed, /disable-library-validation/)
  assert.match(testAdhoc, /disable-library-validation/)
  assert.match(testAdhoc, /FinderSync\.Test</)
  assert.equal(ADHOC_ENTITLEMENTS, 'build/entitlements.mac.adhoc.plist')
  assert.equal(TEST_FEED_ENTITLEMENTS, 'build/entitlements.mac.test-feed.plist')
  assert.equal(TEST_FEED_ADHOC_ENTITLEMENTS, 'build/entitlements.mac.adhoc.test-feed.plist')
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
  const testPlan = planMacPack({
    platform: 'darwin',
    release: false,
    env: { [TEST_FEED_BUILD_ENV]: '1' },
    developerIdPresent: false,
  })
  assert.equal(testPlan.adhocEntitlements, TEST_FEED_ADHOC_ENTITLEMENTS)
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
    entitlements:
      'com.apple.security.cs.allow-jit\n<string>A7WWML89LQ.group.app.fontbutler.desktop.FinderSync</string>',
    staplerAppStatus: 0,
    staplerDmgStatus: 0,
    staplerZipAppStatus: 0,
    staplerDmgAppStatus: 0,
    spctlOutput: 'source=Notarized Developer ID',
    spctlStatus: 0,
    expectedAppGroup: 'A7WWML89LQ.group.app.fontbutler.desktop.FinderSync',
  })
  assert.deepEqual(accepted, [])
  const otherGroup = notarizationFailures({
    codesignDisplay: `Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}\nTeamIdentifier=A7WWML89LQ`,
    codesignVerifyStatus: 0,
    entitlements: '<string>A7WWML89LQ.group.app.fontbutler.desktop.FinderSync.Test</string>',
    staplerAppStatus: 0,
    staplerDmgStatus: 0,
    staplerZipAppStatus: 0,
    staplerDmgAppStatus: 0,
    spctlOutput: 'source=Notarized Developer ID',
    spctlStatus: 0,
    expectedAppGroup: 'A7WWML89LQ.group.app.fontbutler.desktop.FinderSync',
  })
  assert.ok(otherGroup.some((failure) => /application group/.test(failure)))

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
  assert.ok(adHoc.some((failure) => /library validation/.test(failure)))
  assert.ok(adHoc.some((failure) => /stapler|spctl|Developer ID/.test(failure)))

  const libraryValidation = notarizationFailures({
    codesignDisplay: `Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}`,
    codesignVerifyStatus: 0,
    entitlements: 'com.apple.security.cs.allow-jit\ncom.apple.security.cs.disable-library-validation',
    staplerAppStatus: 0,
    staplerDmgStatus: 0,
    staplerZipAppStatus: 0,
    staplerDmgAppStatus: 0,
    spctlOutput: 'source=Notarized Developer ID',
    spctlStatus: 0,
  })
  assert.ok(libraryValidation.some((failure) => /library validation/.test(failure)))
  assert.equal(libraryValidation.some((failure) => /get-task-allow/.test(failure)), false)

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

test('latest-mac.yml is rewritten after the builder, not inside the DMG staple hook', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'font-butler-feed-'))
  try {
    const dmgName = 'Font-Buttler-0.3.8-arm64.dmg'
    const zipName = 'Font-Buttler-0.3.8-arm64.zip'
    const dmg = path.join(dir, dmgName)
    const zip = path.join(dir, zipName)
    const dmgBlockmap = `${dmg}.blockmap`
    const zipBlockmap = `${zip}.blockmap`
    const dmgBytes = 'stapled-dmg-bytes'
    const zipBytes = 'zip-bytes-on-disk'
    writeFileSync(dmg, dmgBytes)
    writeFileSync(zip, zipBytes)
    writeFileSync(dmgBlockmap, 'stale-dmg-blockmap')
    writeFileSync(zipBlockmap, 'zip-blockmap')
    const ymlPath = path.join(dir, 'latest-mac.yml')

    // afterAllArtifactBuild staples the DMG while publishManager.awaitTasks()
    // has not written latest-mac.yml yet. That must not fail the build.
    let notarized = null
    await stapleSignedDmgs([dmg, zip], { APPLE_KEYCHAIN_PROFILE: 'font-butler-notary' }, {
      notarize: async ({ appPath }) => {
        notarized = appPath
      },
      verifySignature: () => ({ signed: true, output: '' }),
    })
    assert.equal(notarized, dmg)
    assert.equal(existsSync(ymlPath), false)
    assert.equal(existsSync(dmgBlockmap), true)
    await assert.rejects(() => rewriteMacUpdateFeed(dir), /latest-mac\.yml is missing/)

    // The builder then writes the feed with the pre-staple hashes.
    writeFileSync(
      ymlPath,
      yaml.dump({
        version: '0.3.8',
        files: [
          { url: zipName, sha512: 'stale-zip-sha', size: 1, blockMapSize: 9 },
          { url: dmgName, sha512: 'stale-dmg-sha', size: 2, blockMapSize: 8 },
        ],
        path: zipName,
        sha512: 'stale-zip-sha',
        releaseDate: '2026-01-01T00:00:00.000Z',
      }),
    )
    await rewriteMacUpdateFeed(dir)
    const doc = yaml.load(readFileSync(ymlPath, 'utf8'))
    const zipSha = await sha512Base64(zip)
    const dmgSha = await sha512Base64(dmg)
    assert.equal(doc.path, zipName)
    assert.equal(doc.sha512, zipSha)
    assert.equal(doc.files[0].url, zipName)
    assert.equal(doc.files[0].sha512, zipSha)
    assert.equal(doc.files[0].size, Buffer.byteLength(zipBytes))
    assert.equal(doc.files[0].blockMapSize, 9)
    assert.equal(doc.files[1].url, dmgName)
    assert.equal(doc.files[1].sha512, dmgSha)
    assert.equal(doc.files[1].size, Buffer.byteLength(dmgBytes))
    assert.equal(doc.files[1].blockMapSize, undefined)
    assert.equal(doc.releaseDate, '2026-01-01T00:00:00.000Z')
    assert.equal(existsSync(dmgBlockmap), false)
    assert.equal(readFileSync(zipBlockmap, 'utf8'), 'zip-blockmap')
    const written = readFileSync(ymlPath, 'utf8')
    assert.equal(written.includes('stale-dmg-sha'), false)
    assert.equal(written.includes('stale-zip-sha'), false)

    writeFileSync(
      ymlPath,
      yaml.dump({
        version: '0.3.8',
        files: [{ url: zipName, sha512: 'stale-zip-sha', size: 1 }],
        path: zipName,
        sha512: 'stale-zip-sha',
      }),
    )
    await assert.rejects(() => rewriteMacUpdateFeed(dir), /no DMG entry/)
    await assert.rejects(
      () => rewriteMacUpdateFeed(path.join(dir, 'missing-release')),
      /latest-mac\.yml is missing/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the publish check hashes the stapled DMG and zip and does not upload a DMG blockmap', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'font-butler-feed-assert-'))
  try {
    const releaseDir = writeVersionedRelease(root, '0.3.8')
    const dmgName = 'Font-Buttler-0.3.8-arm64.dmg'
    const zipName = 'Font-Buttler-0.3.8-arm64.zip'
    const dmg = path.join(releaseDir, dmgName)
    const zip = path.join(releaseDir, zipName)
    const feed = path.join(releaseDir, 'latest-mac.yml')
    const dmgBlockmap = `${dmg}.blockmap`
    const dmgBytes = 'stapled-dmg-bytes'
    const zipBytes = 'stapled-zip-bytes'
    writeFileSync(dmg, dmgBytes)
    writeFileSync(zip, zipBytes)
    writeFileSync(dmgBlockmap, 'stale-dmg-blockmap')
    writeFileSync(
      feed,
      yaml.dump({
        version: '0.3.8',
        files: [
          { url: zipName, sha512: 'stale-zip-sha', size: 1 },
          { url: dmgName, sha512: 'stale-dmg-sha', size: 2 },
        ],
        path: zipName,
        sha512: 'stale-zip-sha',
      }),
    )
    await rewriteMacUpdateFeed(releaseDir)
    const doc = yaml.load(readFileSync(feed, 'utf8'))
    const dmgSha = await sha512Base64(dmg)
    const zipSha = await sha512Base64(zip)
    assert.equal(doc.files.find((entry) => entry.url === dmgName).sha512, dmgSha)
    assert.equal(doc.files.find((entry) => entry.url === dmgName).size, Buffer.byteLength(dmgBytes))
    assert.equal(doc.files.find((entry) => entry.url === zipName).sha512, zipSha)
    assert.equal(doc.files.find((entry) => entry.url === zipName).size, Buffer.byteLength(zipBytes))
    assert.equal(doc.sha512, zipSha)
    assert.deepEqual(await updateFeedFailures({ dmg, zip, feed }), [])
    assert.equal(existsSync(dmgBlockmap), false)

    writeFileSync(dmgBlockmap, 'stale-dmg-blockmap')
    const prepared = prepareMacPublish(root, '0.3.8')
    assert.equal(existsSync(dmgBlockmap), false)
    assert.equal(prepared.failures.length, 0)
    assert.equal(prepared.upload.some((file) => file.endsWith('.dmg.blockmap')), false)
    const calls = []
    const published = await publishVersionedMacRelease({
      tag: 'v0.3.8',
      files: [...prepared.upload, dmgBlockmap],
      release: { exists: false, draft: false },
      tagOnRemote: true,
      exec: async (_command, args) => ghDraftExec(calls, args),
    })
    assert.equal(published.ok, true)
    const upload = calls.find((args) => args[0] === 'release' && args[1] === 'upload')
    assert.equal(upload.some((arg) => String(arg).endsWith('.dmg.blockmap')), false)

    writeFileSync(dmg, 'dmg-bytes-changed-after-the-feed-was-written')
    const mismatched = await updateFeedFailures({ dmg, zip, feed })
    assert.ok(mismatched.some((failure) => failure.includes(dmgName) && failure.includes('sha512')))
    assert.ok(mismatched.some((failure) => failure.includes(dmgName) && failure.includes('size')))
    assert.equal(mismatched.some((failure) => failure.includes(zipName)), false)
    const asserted = await assertNotarizedMacRelease(root, '0.3.8')
    assert.ok(asserted.some((failure) => failure.includes(dmgName) && failure.includes('sha512')))
    assert.ok(asserted.some((failure) => failure.includes(dmgName) && failure.includes('size')))

    writeFileSync(dmg, dmgBytes)
    const zipOnly = yaml.load(readFileSync(feed, 'utf8'))
    zipOnly.files.find((entry) => entry.url === zipName).size = 1
    writeFileSync(feed, yaml.dump(zipOnly))
    const sizeMismatch = await updateFeedFailures({ dmg, zip, feed })
    assert.deepEqual(sizeMismatch, [`latest-mac.yml size for ${zipName} does not match the file on disk.`])
    const sizeAsserted = await assertNotarizedMacRelease(root, '0.3.8')
    assert.ok(sizeAsserted.includes(`latest-mac.yml size for ${zipName} does not match the file on disk.`))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function writeVersionedRelease(root, version) {
  const releaseDir = path.join(root, 'release')
  mkdirSync(path.join(releaseDir, 'mac-arm64', 'Font Buttler.app'), { recursive: true })
  mkdirSync(path.join(releaseDir, 'mac', 'Font Buttler.app'), { recursive: true })
  const stem = `Font-Buttler-${version}-arm64`
  for (const name of [`${stem}.dmg`, `${stem}.zip`, `${stem}.zip.blockmap`, 'latest-mac.yml']) {
    writeFileSync(path.join(releaseDir, name), name)
  }
  return releaseDir
}

test('a stale archive from another version blocks publish', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'font-butler-assets-'))
  try {
    const releaseDir = writeVersionedRelease(root, '0.3.8')
    writeFileSync(path.join(releaseDir, 'Font-Buttler-0.3.7-arm64.dmg'), 'old')
    const prepared = prepareMacPublish(root, '0.3.8')
    assert.equal(prepared.upload.length, 0)
    assert.ok(prepared.failures.some((failure) => failure.includes('Font-Buttler-0.3.7-arm64.dmg')))
    assert.equal(prepared.app, path.join(releaseDir, 'mac-arm64', 'Font Buttler.app'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('publish uploads only the version-matched arm64 archives', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'font-butler-upload-'))
  try {
    writeVersionedRelease(root, '0.3.8')
    const prepared = prepareMacPublish(root, '0.3.8')
    assert.deepEqual(
      prepared.upload.map((file) => path.basename(file)),
      [
        'Font-Buttler-0.3.8-arm64.dmg',
        'Font-Buttler-0.3.8-arm64.zip',
        'Font-Buttler-0.3.8-arm64.zip.blockmap',
        'latest-mac.yml',
      ],
    )
    const calls = []
    const published = await publishVersionedMacRelease({
      tag: 'v0.3.8',
      files: prepared.upload,
      release: { exists: false, draft: false },
      tagOnRemote: true,
      exec: async (_command, args) => ghDraftExec(calls, args),
    })
    assert.equal(published.ok, true)
    assert.equal(published.draft, true)
    assert.equal(calls.some((args) => args.includes('--draft=false')), false)
    const upload = calls.find((args) => args[0] === 'release' && args[1] === 'upload')
    assert.deepEqual(
      upload.slice(3, -1).map((file) => path.basename(file)),
      [
        'Font-Buttler-0.3.8-arm64.dmg',
        'Font-Buttler-0.3.8-arm64.zip',
        'Font-Buttler-0.3.8-arm64.zip.blockmap',
        'latest-mac.yml',
      ],
    )
    assert.equal(upload.some((arg) => String(arg).includes('0.3.7')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function ghDraftExec(calls, args, { uploadStatus = 0 } = {}) {
  calls.push(args)
  if (args[1] === 'view') {
    const names = args.includes('--json')
      ? [
          'Font-Buttler-0.3.8-arm64.dmg',
          'Font-Buttler-0.3.8-arm64.zip',
          'Font-Buttler-0.3.8-arm64.zip.blockmap',
          'latest-mac.yml',
        ]
      : []
    return { status: 0, output: JSON.stringify({ isDraft: true, assets: names.map((name) => ({ name })) }) }
  }
  if (args[1] === 'upload') return { status: uploadStatus, output: uploadStatus === 0 ? '' : 'upload failed' }
  return { status: 0, output: '' }
}

test('a missing GitHub Release stays a draft after upload', async () => {
  const files = [
    'release/Font-Buttler-0.3.8-arm64.dmg',
    'release/Font-Buttler-0.3.8-arm64.zip',
    'release/Font-Buttler-0.3.8-arm64.zip.blockmap',
    'release/latest-mac.yml',
  ]
  const calls = []
  const drafted = await publishVersionedMacRelease({
    tag: 'v0.3.8',
    files,
    release: { exists: false, draft: false },
    tagOnRemote: true,
    exec: async (_command, args) => ghDraftExec(calls, args),
  })
  assert.equal(drafted.ok, true)
  assert.equal(drafted.draft, true)
  assert.deepEqual(
    calls.map((args) => args.slice(0, 3)),
    [
      ['release', 'create', 'v0.3.8'],
      ['release', 'upload', 'v0.3.8'],
      ['release', 'view', 'v0.3.8'],
    ],
  )
  assert.ok(calls[0].includes('--verify-tag'))
  assert.ok(calls[0].includes('--draft'))
  assert.equal(calls.some((args) => args.includes('--draft=false')), false)
  assert.equal(calls.some((args) => args[1] === 'edit'), false)

  const failedCalls = []
  const failed = await publishVersionedMacRelease({
    tag: 'v0.3.8',
    files,
    release: { exists: false, draft: false },
    tagOnRemote: true,
    exec: async (_command, args) => ghDraftExec(failedCalls, args, { uploadStatus: 1 }),
  })
  assert.equal(failed.ok, false)
  assert.match(failed.error, /draft/)
  assert.equal(failedCalls.some((args) => args.includes('--draft=false')), false)
  assert.equal(failedCalls.some((args) => args[1] === 'edit'), false)

  const overwriteCalls = []
  const overwrite = await publishVersionedMacRelease({
    tag: 'v0.3.8',
    files,
    release: { exists: true, draft: false },
    tagOnRemote: true,
    exec: async () => {
      overwriteCalls.push('ran')
      throw new Error('gh should not run')
    },
  })
  assert.equal(overwrite.ok, false)
  assert.match(overwrite.error, /already published/)
  assert.match(overwrite.error, /overwrite/)
  assert.deepEqual(overwrite.commands, [])
  assert.deepEqual(overwriteCalls, [])

  const untagged = await publishVersionedMacRelease({
    tag: 'v0.3.8',
    files,
    release: { exists: false, draft: false },
    tagOnRemote: false,
    exec: async () => {
      throw new Error('gh should not run')
    },
  })
  assert.equal(untagged.ok, false)
  assert.match(untagged.error, /not on origin/)
  assert.match(untagged.error, /git push origin v0\.3\.8/)
  assert.deepEqual(untagged.commands, [])
})

test('resuming a draft rejects extra assets and accepts an exact set', async () => {
  const files = [
    'release/Font-Buttler-0.3.8-arm64.dmg',
    'release/Font-Buttler-0.3.8-arm64.zip',
    'release/Font-Buttler-0.3.8-arm64.zip.blockmap',
    'release/latest-mac.yml',
  ]
  const expected = files.map((file) => path.basename(file))
  const extraName = 'Font-Buttler-0.3.7-arm64.dmg'

  const extraCalls = []
  const extra = await publishVersionedMacRelease({
    tag: 'v0.3.8',
    files,
    release: { exists: true, draft: true },
    tagOnRemote: true,
    exec: async (_command, args) => {
      extraCalls.push(args)
      if (args[1] === 'view') {
        return {
          status: 0,
          output: JSON.stringify({
            isDraft: true,
            assets: [...expected, extraName].map((name) => ({ name })),
          }),
        }
      }
      return { status: 0, output: '' }
    },
  })
  assert.equal(extra.ok, false)
  assert.ok(extra.error.includes(extraName))
  assert.match(extra.error, /does not delete assets/)
  assert.equal(extraCalls.some((args) => args[1] === 'upload'), false)
  assert.equal(extraCalls.some((args) => args.some((arg) => String(arg).includes('delete'))), false)

  const afterCalls = []
  let views = 0
  const afterUpload = await publishVersionedMacRelease({
    tag: 'v0.3.8',
    files,
    release: { exists: true, draft: true },
    tagOnRemote: true,
    exec: async (_command, args) => {
      afterCalls.push(args)
      if (args[1] === 'view') {
        views += 1
        const names = views === 1 ? expected : [...expected, extraName]
        return { status: 0, output: JSON.stringify({ isDraft: true, assets: names.map((name) => ({ name })) }) }
      }
      return { status: 0, output: '' }
    },
  })
  assert.equal(afterUpload.ok, false)
  assert.ok(afterUpload.error.includes(extraName))
  assert.match(afterUpload.error, /does not delete assets/)
  assert.deepEqual(
    afterCalls.map((args) => args.slice(0, 2)),
    [
      ['release', 'view'],
      ['release', 'upload'],
      ['release', 'view'],
    ],
  )
  assert.equal(afterCalls.some((args) => args.some((arg) => String(arg).includes('delete'))), false)

  const exactCalls = []
  const exact = await publishVersionedMacRelease({
    tag: 'v0.3.8',
    files,
    release: { exists: true, draft: true },
    tagOnRemote: true,
    exec: async (_command, args) => ghDraftExec(exactCalls, args),
  })
  assert.equal(exact.ok, true)
  assert.equal(exact.draft, true)
  assert.deepEqual(
    exactCalls.map((args) => args.slice(0, 2)),
    [
      ['release', 'view'],
      ['release', 'upload'],
      ['release', 'view'],
    ],
  )
})

test('publish requires the remote tag commit to equal HEAD and a clean tree', async () => {
  const files = [
    'release/Font-Buttler-0.3.8-arm64.dmg',
    'release/Font-Buttler-0.3.8-arm64.zip',
    'release/Font-Buttler-0.3.8-arm64.zip.blockmap',
    'release/latest-mac.yml',
  ]
  const head = 'a'.repeat(40)
  const other = 'b'.repeat(40)
  const tagObject = 'c'.repeat(40)
  assert.match(readRepo('docs/releases.md'), /git ls-remote origin refs\/tags\/v<version>\^\{}/)
  assert.match(readRepo('docs/releases.md'), /clean checkout of the tag/)
  const uploadSource = readRepo('scripts/upload-mac-release.mjs')
  assert.deepEqual(remoteTagLsRemoteArgs('v0.3.8'), [
    ['ls-remote', 'origin', 'refs/tags/v0.3.8^{}'],
    ['ls-remote', 'origin', 'refs/tags/v0.3.8'],
  ])
  assert.match(uploadSource, /remoteTagLsRemoteArgs/)
  assert.doesNotMatch(uploadSource, /rev-parse[^\n]*tags/)
  assert.doesNotMatch(uploadSource, /--untracked-files=no/)
  assert.doesNotMatch(uploadSource, /--ignored/)
  assert.match(uploadSource, /git', \['status', '--porcelain'\]/)

  const annotated = remoteTagCommitSha(`${head}\trefs/tags/v0.3.8^{}\n`, `${tagObject}\trefs/tags/v0.3.8\n`)
  assert.equal(annotated, head)
  assert.equal(remoteTagCommitSha('', `${head}\trefs/tags/v0.3.8\n`), head)
  assert.equal(remoteTagCommitSha('', ''), null)

  const calls = []
  const matched = await publishVersionedMacRelease({
    tag: 'v0.3.8',
    files,
    release: { exists: false, draft: false },
    tagOnRemote: true,
    version: '0.3.8',
    head,
    remoteSha: annotated,
    dirty: false,
    exec: async (_command, args) => ghDraftExec(calls, args),
  })
  assert.equal(matched.ok, true)
  assert.equal(matched.draft, true)
  assert.equal(releaseCommitGuard({ tag: 'v0.3.8', version: '0.3.8', head, remoteSha: annotated, dirty: false }).ok, true)
  assert.equal(expectedReleaseTag('0.3.8'), 'v0.3.8')
  assert.ok(calls.some((args) => args[1] === 'upload'))

  const mismatchCalls = []
  const mismatch = await publishVersionedMacRelease({
    tag: 'v0.3.8',
    files,
    release: { exists: true, draft: true },
    tagOnRemote: true,
    head,
    remoteSha: other,
    dirty: false,
    exec: async () => {
      mismatchCalls.push('ran')
      throw new Error('gh should not run')
    },
  })
  assert.equal(mismatch.ok, false)
  assert.ok(mismatch.error.includes(head))
  assert.ok(mismatch.error.includes(other))
  assert.match(mismatch.error, /draft was not changed/)
  assert.deepEqual(mismatch.commands, [])
  assert.deepEqual(mismatchCalls, [])

  const dirtyCalls = []
  const dirty = await publishVersionedMacRelease({
    tag: 'v0.3.8',
    files,
    release: { exists: true, draft: true },
    tagOnRemote: true,
    head,
    remoteSha: head,
    dirty: true,
    exec: async () => {
      dirtyCalls.push('ran')
      throw new Error('gh should not run')
    },
  })
  assert.equal(dirty.ok, false)
  assert.ok(dirty.error.includes(head))
  assert.match(dirty.error, /untracked files that are not ignored/)
  assert.match(dirty.error, /draft was not changed/)
  assert.deepEqual(dirty.commands, [])
  assert.deepEqual(dirtyCalls, [])

  const wrongTagCalls = []
  const wrongTag = await publishVersionedMacRelease({
    tag: 'v0.3.7',
    files,
    release: { exists: true, draft: true },
    tagOnRemote: true,
    version: '0.3.8',
    head,
    remoteSha: head,
    dirty: false,
    exec: async () => {
      wrongTagCalls.push('ran')
      throw new Error('gh should not run')
    },
  })
  assert.equal(wrongTag.ok, false)
  assert.match(wrongTag.error, /package\.json version 0\.3\.8/)
  assert.match(wrongTag.error, /v0\.3\.8/)
  assert.ok(wrongTag.error.includes('v0.3.7'))
  assert.match(wrongTag.error, /draft was not changed/)
  assert.deepEqual(wrongTag.commands, [])
  assert.deepEqual(wrongTagCalls, [])

  assert.equal(worktreeDirty(''), false)
  assert.equal(worktreeDirty(' M package.json\n'), true)
  assert.equal(worktreeDirty('?? notes.txt\n'), true)
  for (const file of [
    'release/Font-Buttler-0.3.8-arm64.dmg',
    'dist/index.html',
    'electron/server.bundle.mjs',
    'electron/font-analysis-worker.mjs',
    'electron/finder-services.node',
    'electron/finder-sync-receiver.node',
    'electron/session-fonts.node',
    'electron/favicon-16.png',
    'electron/app-icons/classic.png',
    'vendor/python/bin/python3',
  ]) {
    execFileSync('git', ['check-ignore', '-q', file], { cwd: new URL('..', import.meta.url) })
  }
})

test('a test-feed pack stamps extraMetadata and does not change a normal pack', () => {
  const build = pkg().build
  const plain = applyTestFeedMetadata(build, {})
  assert.equal(plain.error, null)
  assert.equal(plain.build.extraMetadata, undefined)
  const marked = applyTestFeedMetadata(build, { [TEST_FEED_BUILD_ENV]: '1' })
  assert.equal(marked.error, null)
  assert.equal(marked.build.extraMetadata.fontButlerTestFeed, true)
  assert.equal(marked.build.extraMetadata.version, undefined)
  assert.equal(marked.build.mac.entitlements, TEST_FEED_ENTITLEMENTS)
  assert.equal(marked.build.mac.entitlementsInherit, TEST_FEED_ENTITLEMENTS)
  assert.equal(build.mac.entitlements, 'build/entitlements.mac.plist')
  const higher = applyTestFeedMetadata(build, {
    [TEST_FEED_BUILD_ENV]: '1',
    [TEST_FEED_VERSION_ENV]: 'v0.9.0',
  })
  assert.equal(higher.build.extraMetadata.version, '0.9.0')
  assert.equal(higher.build.extraMetadata.fontButlerTestFeed, true)
  const stray = applyTestFeedMetadata(build, { [TEST_FEED_VERSION_ENV]: '0.9.0' })
  assert.equal(stray.build.extraMetadata, undefined)
  assert.deepEqual(build.mac.extendInfo.CFBundleURLTypes[0].CFBundleURLSchemes, ['font-butler'])
  assert.deepEqual(marked.build.mac.extendInfo.CFBundleURLTypes[0].CFBundleURLSchemes, ['font-butler'])
  assert.deepEqual(build.mac.extendInfo.CFBundleURLTypes[0].CFBundleURLSchemes, ['font-butler'])
  assert.deepEqual(marked.build.mac.extendInfo.NSServices, build.mac.extendInfo.NSServices)
  const bad = applyTestFeedMetadata(build, { [TEST_FEED_BUILD_ENV]: '1', [TEST_FEED_VERSION_ENV]: 'latest' })
  assert.match(bad.error, /FONT_BUTLER_TEST_VERSION/)
  assert.match(readRepo('scripts/mac-pack.mjs'), /applyTestFeedMetadata/)
})

test('publish refuses a test-feed environment and a zip or app that carries the marker', async () => {
  assert.deepEqual(testFeedPublishEnvFailures({}), [])
  assert.deepEqual(testFeedPublishEnvFailures({ [TEST_FEED_BUILD_ENV]: '' }), [])
  assert.deepEqual(testFeedPublishEnvFailures({ [TEST_FEED_BUILD_ENV]: '1' }), [TEST_FEED_ENV_REFUSAL])

  const empty = mkdtempSync(path.join(tmpdir(), 'font-butler-test-feed-env-'))
  const envRefusal = await assertNotarizedMacRelease(empty, '0.3.8', { [TEST_FEED_BUILD_ENV]: '1' })
  assert.ok(envRefusal.includes(TEST_FEED_ENV_REFUSAL))
  rmSync(empty, { recursive: true, force: true })

  const root = mkdtempSync(path.join(tmpdir(), 'font-butler-test-feed-zip-'))
  const src = path.join(root, 'pack')
  const app = path.join(root, 'release', 'mac-arm64', 'Font Buttler.app')
  mkdirSync(src)
  mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(
    path.join(src, 'package.json'),
    JSON.stringify({ name: 'font-butler', version: '0.3.8', fontButlerTestFeed: true }),
  )
  const asarPath = path.join(app, 'Contents', 'Resources', 'app.asar')
  const asar = await import('@electron/asar')
  await asar.createPackage(src, asarPath)
  assert.equal(readAppTestFeedMarker(app), true)
  const zipPath = path.join(root, 'release', 'Font-Buttler-0.3.8-arm64.zip')
  execFileSync('python3', [
    '-c',
    'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2], "Font Buttler.app/Contents/Resources/app.asar"); z.close()',
    zipPath,
    asarPath,
  ])
  assert.equal(zipHasTestFeedMarker(zipPath), true)
  const marked = await assertNotarizedMacRelease(root, '0.3.8', {})
  assert.ok(marked.includes(TEST_FEED_MARKER_REFUSAL))
  assert.equal(marked.includes(TEST_FEED_ENV_REFUSAL), false)
  rmSync(root, { recursive: true, force: true })
})

test('publish fails when the release zip app package marker cannot be read', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'font-butler-test-feed-null-'))
  const src = path.join(root, 'pack')
  const app = path.join(root, 'release', 'mac-arm64', 'Font Buttler.app')
  mkdirSync(src)
  mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'font-butler', version: '0.3.8' }))
  const asar = await import('@electron/asar')
  await asar.createPackage(src, path.join(app, 'Contents', 'Resources', 'app.asar'))
  assert.equal(readAppTestFeedMarker(app), false)
  const broken = path.join(root, 'broken.asar')
  writeFileSync(broken, 'not-an-asar')
  const zipPath = path.join(root, 'release', 'Font-Buttler-0.3.8-arm64.zip')
  execFileSync('python3', [
    '-c',
    'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2], "Font Buttler.app/Contents/Resources/app.asar"); z.close()',
    zipPath,
    broken,
  ])
  assert.equal(readZipAppTestFeedMarker(zipPath), null)
  assert.deepEqual(testFeedArchiveFailures({ zip: zipPath, appPaths: [app] }), [TEST_FEED_MARKER_UNREADABLE])
  const failures = await assertNotarizedMacRelease(root, '0.3.8', {})
  assert.ok(failures.includes(TEST_FEED_MARKER_UNREADABLE))
  assert.equal(failures.includes(TEST_FEED_MARKER_REFUSAL), false)
  rmSync(root, { recursive: true, force: true })
})

test('release asset names follow FONT_BUTLER_TEST_VERSION on a marked build', async () => {
  assert.equal(releaseAssetVersion('0.3.9', {}), '0.3.9')
  assert.equal(releaseAssetVersion('0.3.9', { [TEST_FEED_VERSION_ENV]: '0.9.0' }), '0.3.9')
  assert.equal(
    releaseAssetVersion('0.3.9', { [TEST_FEED_BUILD_ENV]: '1', [TEST_FEED_VERSION_ENV]: 'v0.9.0' }),
    '0.9.0',
  )
  assert.equal(
    macReleaseAssetNames('0.9.0').zip,
    'Font-Buttler-0.9.0-arm64.zip',
  )
  const root = mkdtempSync(path.join(tmpdir(), 'font-butler-test-version-'))
  try {
    writeVersionedRelease(root, '0.9.0')
    const failures = await assertNotarizedMacRelease(root, '0.3.9', {
      [TEST_FEED_BUILD_ENV]: '1',
      [TEST_FEED_VERSION_ENV]: '0.9.0',
    })
    assert.equal(failures.some((failure) => failure.includes('0.3.9')), false)
    assert.equal(failures.some((failure) => failure.includes('Missing release/')), false)
    assert.ok(failures.includes(TEST_FEED_ENV_REFUSAL))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the packaged Electron marker gate fails closed on true, null, and a dead probe', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'font-butler-marker-probe-'))
  const app = path.join(root, 'Font Buttler.app')
  const binary = path.join(app, 'Contents', 'MacOS', 'Font Buttler')
  mkdirSync(path.dirname(binary), { recursive: true })
  writeFileSync(binary, '')
  const probe = (stdout, status = 0, extra = {}) => () => ({ status, stdout, stderr: '', ...extra })
  try {
    assert.deepEqual(packagedElectronMarkerFailures(app, { spawnImpl: probe('{"marker":false}\n') }), [])
    assert.deepEqual(packagedElectronMarkerFailures(app, { spawnImpl: probe('{"marker":true}') }), [
      TEST_FEED_MARKER_REFUSAL,
    ])
    assert.deepEqual(packagedElectronMarkerFailures(app, { spawnImpl: probe('{"marker":null}') }), [
      TEST_FEED_MARKER_UNREADABLE,
    ])
    assert.deepEqual(
      packagedElectronMarkerFailures(app, { spawnImpl: probe('', 1, { error: new Error('spawn ENOENT') }) }),
      [TEST_FEED_MARKER_PROBE_FAILURE],
    )
    assert.match(TEST_FEED_MARKER_PROBE_FAILURE, /RunAsNode/)
    assert.match(TEST_FEED_MARKER_PROBE_FAILURE, /Do not skip it/)
    assert.deepEqual(packagedElectronMarkerFailures(path.join(root, 'missing')), [])
    const release = mkdtempSync(path.join(tmpdir(), 'font-butler-marker-probe-release-'))
    try {
      writeVersionedRelease(release, '0.3.8')
      const releaseApp = path.join(release, 'release', 'mac-arm64', 'Font Buttler.app')
      const releaseBinary = path.join(releaseApp, 'Contents', 'MacOS', 'Font Buttler')
      mkdirSync(path.dirname(releaseBinary), { recursive: true })
      writeFileSync(releaseBinary, '')
      let calls = 0
      const failures = await assertNotarizedMacRelease(release, '0.3.8', {}, (command, args, options) => {
        calls += 1
        assert.equal(command, releaseBinary)
        assert.equal(args[0], '--input-type=module')
        assert.match(args[2], /readAppTestFeedMarker/)
        assert.match(args[2], /original-fs/)
        assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1')
        assert.equal(options.env.FONT_BUTLER_MARKER_APP, releaseApp)
        return { status: 0, stdout: '{"marker":false}\n', stderr: '' }
      })
      assert.equal(calls, 1)
      assert.equal(failures.includes(TEST_FEED_MARKER_PROBE_FAILURE), false)
      assert.equal(failures.includes(TEST_FEED_MARKER_REFUSAL), false)
    } finally {
      rmSync(release, { recursive: true, force: true })
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

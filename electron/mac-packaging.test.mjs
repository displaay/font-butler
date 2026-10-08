import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ADHOC_ENTITLEMENTS,
  DEVELOPER_ID_IDENTITY,
  NOTARY_KEYCHAIN_PROFILE,
  applyNotaryEnv,
  developerIdInKeychainOutput,
  electronBuilderArgs,
  planMacPack,
  releaseConfigErrors,
} from '../scripts/mac-signing.mjs'

const require = createRequire(import.meta.url)

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
  assert.equal(parsed.build.mac.entitlements, 'build/entitlements.mac.plist')
  assert.equal(parsed.build.mac.entitlementsInherit, 'build/entitlements.mac.plist')
  assert.equal(parsed.build.dmg, undefined)
  assert.equal(parsed.build.afterPack, './scripts/strip-mac-xattrs.mjs')
  assert.equal(parsed.build.afterAllArtifactBuild, './scripts/strip-mac-xattrs.mjs')
  assert.match(parsed.scripts.dist, /COPYFILE_DISABLE=1/)
  assert.match(parsed.scripts.dist, /node scripts\/mac-pack\.mjs/)
  assert.doesNotMatch(parsed.scripts.dist, /--release/)
  assert.match(parsed.scripts['release:mac'], /mac-pack\.mjs --release/)
  assert.match(parsed.scripts['bundle:python'], /COPYFILE_DISABLE=1/)
  assert.doesNotMatch(parsed.scripts.dist, /CSC_IDENTITY_AUTO_DISCOVERY=false/)
  assert.doesNotMatch(parsed.scripts['release:mac'], /CSC_IDENTITY_AUTO_DISCOVERY=false/)
  assert.match(readRepo('scripts/strip-mac-xattrs.mjs'), /compileFinderServicesAddon/)
  assert.match(readRepo('scripts/mac-pack.mjs'), /find-identity/)
})

test('electron-builder 26 accepts the mac signing config', async () => {
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js')
  await validateConfiguration(pkg().build, { isEnabled: false })
})

test('electron-builder CLI keeps the Developer ID identity and the ad-hoc fallback', () => {
  const { configureBuildCommand, createYargs, normalizeOptions } = require('electron-builder/out/builder.js')
  function parsedConfig(args) {
    const argv = configureBuildCommand(createYargs()).parseSync(args)
    return normalizeOptions(argv).config.mac
  }
  const release = planMacPack({
    platform: 'darwin',
    release: true,
    env: {},
    developerIdPresent: true,
  })
  const signed = parsedConfig(electronBuilderArgs(release))
  assert.equal(signed.identity, DEVELOPER_ID_IDENTITY)
  assert.equal(signed.forceCodeSigning, 'true')

  const adHoc = planMacPack({
    platform: 'darwin',
    release: false,
    env: {},
    developerIdPresent: false,
  })
  const unsigned = parsedConfig(electronBuilderArgs(adHoc))
  assert.equal(unsigned.identity, '-')
  assert.equal(unsigned.entitlements, ADHOC_ENTITLEMENTS)
  assert.equal(unsigned.entitlementsInherit, ADHOC_ENTITLEMENTS)
  assert.equal(unsigned.forceCodeSigning, undefined)
})

test('Developer ID entitlements cover Electron hardened runtime without disabling library validation', () => {
  const entitlements = readRepo('build/entitlements.mac.plist')
  const adhoc = readRepo('build/entitlements.mac.adhoc.plist')
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/)
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/)
  assert.doesNotMatch(entitlements, /com\.apple\.security\.cs\.disable-library-validation/)
  assert.match(adhoc, /com\.apple\.security\.cs\.disable-library-validation/)
  assert.equal(ADHOC_ENTITLEMENTS, 'build/entitlements.mac.adhoc.plist')
})

test('tag release workflow packages on macOS and publishes the updater feed', () => {
  const workflow = readRepo('.github/workflows/release.yml')
  const ci = readRepo('.github/workflows/ci.yml')
  assert.match(workflow, /tags:\s*\n\s*- "v\*"/)
  assert.match(workflow, /runs-on: macos-latest/)
  assert.match(workflow, /npm run dist/)
  assert.match(workflow, /softprops\/action-gh-release@v2/)
  assert.match(workflow, /latest-mac\.yml/)
  assert.match(workflow, /draft: false/)
  assert.match(workflow, /prerelease: false/)
  assert.doesNotMatch(workflow, /CSC_IDENTITY_AUTO_DISCOVERY=false/)
  assert.match(ci, /github\.ref_type != 'tag'/)
})

test('release:mac forces Developer ID signing and the notary profile', () => {
  const plan = planMacPack({
    platform: 'darwin',
    release: true,
    env: {},
    developerIdPresent: true,
  })
  assert.equal(plan.mode, 'release')
  assert.equal(plan.identity, DEVELOPER_ID_IDENTITY)
  assert.equal(plan.forceCodeSigning, true)
  assert.equal(plan.keychainProfile, NOTARY_KEYCHAIN_PROFILE)
  assert.match(plan.summary, /notarizing/)
  const args = electronBuilderArgs(plan)
  assert.ok(args.includes(`-c.mac.identity=${DEVELOPER_ID_IDENTITY}`))
  assert.ok(args.includes('-c.mac.forceCodeSigning=true'))
  assert.equal(args.includes('-c.mac.hardenedRuntime=false'), false)
  const env = applyNotaryEnv(
    {
      APPLE_ID: 'someone@example.com',
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
    developerIdPresent: false,
  })
  assert.equal(plan.keychainProfile, 'custom-profile')
  assert.equal(plan.keychain, '/Library/Keychains/login.keychain-db')
  const env = applyNotaryEnv({}, plan)
  assert.equal(env.APPLE_KEYCHAIN_PROFILE, 'custom-profile')
  assert.equal(env.APPLE_KEYCHAIN, '/Library/Keychains/login.keychain-db')
})

test('release:mac refuses to run off macOS', () => {
  const plan = planMacPack({
    platform: 'linux',
    release: true,
    env: { APPLE_KEYCHAIN_PROFILE: NOTARY_KEYCHAIN_PROFILE },
    developerIdPresent: false,
  })
  assert.match(plan.error, /macOS/)
  assert.equal(plan.identity, undefined)
})

test('dist without the certificate ad-hoc signs and does not notarize', () => {
  const plan = planMacPack({
    platform: 'darwin',
    release: false,
    env: { APPLE_KEYCHAIN_PROFILE: NOTARY_KEYCHAIN_PROFILE, APPLE_ID: 'daniel@quisek.com' },
    developerIdPresent: false,
  })
  assert.equal(plan.mode, 'ad-hoc')
  assert.equal(plan.identity, '-')
  assert.equal(plan.forceCodeSigning, false)
  assert.equal(plan.keychainProfile, null)
  assert.equal(plan.adhocEntitlements, ADHOC_ENTITLEMENTS)
  const args = electronBuilderArgs(plan)
  assert.ok(args.includes('-c.mac.identity=-'))
  assert.ok(args.includes(`-c.mac.entitlements=${ADHOC_ENTITLEMENTS}`))
  assert.ok(args.includes(`-c.mac.entitlementsInherit=${ADHOC_ENTITLEMENTS}`))
  const env = applyNotaryEnv({ APPLE_KEYCHAIN_PROFILE: NOTARY_KEYCHAIN_PROFILE, APPLE_TEAM_ID: 'A7WWML89LQ' }, plan)
  assert.equal(env.APPLE_KEYCHAIN_PROFILE, undefined)
  assert.equal(env.APPLE_TEAM_ID, undefined)
})

test('dist with the certificate notarizes only when the keychain profile is set', () => {
  const absent = planMacPack({
    platform: 'darwin',
    release: false,
    env: { APPLE_ID: 'daniel@quisek.com', APPLE_APP_SPECIFIC_PASSWORD: 'secret', APPLE_TEAM_ID: 'A7WWML89LQ' },
    developerIdPresent: true,
  })
  assert.equal(absent.mode, 'developer-id')
  assert.equal(absent.identity, DEVELOPER_ID_IDENTITY)
  assert.equal(absent.forceCodeSigning, false)
  assert.equal(absent.keychainProfile, null)
  const stripped = applyNotaryEnv(
    { APPLE_ID: 'daniel@quisek.com', APPLE_APP_SPECIFIC_PASSWORD: 'secret' },
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
  assert.equal(present.keychainProfile, NOTARY_KEYCHAIN_PROFILE)
  assert.equal(
    developerIdInKeychainOutput(`  1) ABCD "Developer ID Application: ${DEVELOPER_ID_IDENTITY}"`),
    true,
  )
  assert.equal(
    developerIdInKeychainOutput('  1) ABCD "Apple Development: DANIEL QUISEK (A7WWML89LQ)"'),
    false,
  )
})

test('a non-mac dist does not pretend to notarize', () => {
  const plan = planMacPack({
    platform: 'linux',
    release: false,
    env: { APPLE_KEYCHAIN_PROFILE: NOTARY_KEYCHAIN_PROFILE },
    developerIdPresent: false,
  })
  assert.equal(plan.mode, 'skip-platform')
  assert.equal(plan.keychainProfile, null)
  assert.equal(plan.forceCodeSigning, false)
  const env = applyNotaryEnv({ APPLE_KEYCHAIN_PROFILE: NOTARY_KEYCHAIN_PROFILE }, plan)
  assert.equal(env.APPLE_KEYCHAIN_PROFILE, undefined)
})

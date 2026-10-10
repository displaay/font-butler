/**
 * Decides how a macOS pack is signed.
 *
 * The electron-builder config pins identity `DANIEL QUISEK (A7WWML89LQ)` (no
 * `Developer ID Application:` prefix — electron-builder adds that). Notarization
 * is electron-builder 26's built-in step (`mac.notarize: true`), which calls
 * `@electron/notarize` only when `APPLE_KEYCHAIN_PROFILE` is set, then staples
 * the .app before the zip and dmg are built. A set profile also signs and
 * staples the dmg. This module does not store passwords, Apple ID emails, or API keys.
 */

export const DEVELOPER_ID_IDENTITY = 'DANIEL QUISEK (A7WWML89LQ)'
export const NOTARY_KEYCHAIN_PROFILE = 'font-butler-notary'
export const ADHOC_ENTITLEMENTS = 'build/entitlements.mac.adhoc.plist'
export const TEST_FEED_BUILD_ENV = 'FONT_BUTLER_TEST_FEED_BUILD'
export const TEST_FEED_VERSION_ENV = 'FONT_BUTLER_TEST_VERSION'
export const PRODUCTION_APP_ID = 'app.fontbutler.desktop'
export const TEST_FEED_APP_ID = 'app.fontbutler.desktop.test'
export const TEST_FEED_PRODUCT_NAME = 'Font Buttler Test'

const NOTARY_ENV_KEYS = [
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_KEYCHAIN',
  'APPLE_KEYCHAIN_PROFILE',
]

export function developerIdInKeychainOutput(output) {
  return output.includes(`Developer ID Application: ${DEVELOPER_ID_IDENTITY}`)
}

function missingIdentityError(release) {
  const command = release ? 'npm run release:mac' : 'A build with APPLE_KEYCHAIN_PROFILE set'
  return `${command} needs Developer ID identity "${DEVELOPER_ID_IDENTITY}" in this keychain. Refusing to fall back to ad-hoc signing.`
}

/**
 * @param {{ platform: string, release: boolean, env: NodeJS.ProcessEnv, developerIdPresent: boolean }} input
 */
export function planMacPack({ platform, release, env, developerIdPresent }) {
  const requestedProfile = (env.APPLE_KEYCHAIN_PROFILE || '').trim()
  const requestedKeychain = (env.APPLE_KEYCHAIN || '').trim()
  const notarize = release || Boolean(requestedProfile)

  if (notarize && platform !== 'darwin') {
    return {
      error: release
        ? 'npm run release:mac only runs on macOS. It needs the Developer ID certificate and the notarytool keychain profile on this Mac.'
        : 'APPLE_KEYCHAIN_PROFILE is set, but this is not macOS. Refusing to pack an unsigned build that could be published.',
    }
  }

  if (notarize && !developerIdPresent) {
    return { error: missingIdentityError(release) }
  }

  if (notarize) {
    const keychainProfile = requestedProfile || NOTARY_KEYCHAIN_PROFILE
    return {
      mode: release ? 'release' : 'notarize',
      identity: DEVELOPER_ID_IDENTITY,
      forceCodeSigning: true,
      adhocEntitlements: null,
      signDmg: true,
      keychainProfile,
      keychain: requestedKeychain || null,
      summary: `Signing with Developer ID identity "${DEVELOPER_ID_IDENTITY}" and notarizing with keychain profile "${keychainProfile}". The DMG is signed and stapled. Signing or notarization failure stops the build.`,
    }
  }

  if (platform !== 'darwin') {
    return {
      mode: 'skip-platform',
      identity: DEVELOPER_ID_IDENTITY,
      forceCodeSigning: false,
      adhocEntitlements: null,
      signDmg: false,
      keychainProfile: null,
      keychain: null,
      summary:
        'This is not macOS, so electron-builder skips code signing and notarization. A local npm run build does not sign.',
    }
  }

  if (!developerIdPresent) {
    return {
      mode: 'ad-hoc',
      identity: '-',
      forceCodeSigning: false,
      adhocEntitlements: ADHOC_ENTITLEMENTS,
      signDmg: false,
      keychainProfile: null,
      keychain: null,
      summary: `Developer ID identity "${DEVELOPER_ID_IDENTITY}" is not in the keychain. Ad-hoc signing this local build so it still launches. Notarization is skipped. This build must not be published.`,
    }
  }

  return {
    mode: 'developer-id',
    identity: DEVELOPER_ID_IDENTITY,
    forceCodeSigning: false,
    adhocEntitlements: null,
    signDmg: false,
    keychainProfile: null,
    keychain: null,
    summary: `Signing with Developer ID identity "${DEVELOPER_ID_IDENTITY}". APPLE_KEYCHAIN_PROFILE is unset, so notarization is skipped. This build must not be published.`,
  }
}

export function testFeedBuildRequested(env) {
  return String(env?.[TEST_FEED_BUILD_ENV] ?? '').trim() === '1'
}

/** Boolean true only for a test-feed pack. Other env vars leave it false. */
export function buildIdentityDocument(env) {
  return { testBuild: testFeedBuildRequested(env) }
}

/**
 * Stamp the logout-probe gate into the packaged app as
 * `Contents/Resources/build-identity.json`. The repo file stays `testBuild: false`.
 */
export function applyBuildIdentityResource(build, env, identityFile) {
  const extraResources = Array.isArray(build?.extraResources) ? [...build.extraResources] : []
  extraResources.push({ from: identityFile, to: 'build-identity.json' })
  return {
    build: { ...build, extraResources },
    document: buildIdentityDocument(env),
  }
}

/**
 * Stamp `fontButlerTestFeed` into the packaged package.json via electron-builder
 * `extraMetadata`. `FONT_BUTLER_TEST_VERSION` sets `extraMetadata.version` so a
 * higher test build does not require a committed version bump. A test build also
 * gets its own bundle id and product name so TCC permissions stay off the real app.
 * All of this applies only when `FONT_BUTLER_TEST_FEED_BUILD=1`.
 */
export function applyTestFeedMetadata(build, env) {
  if (!testFeedBuildRequested(env)) return { build, error: null }
  const extraMetadata = { ...(build?.extraMetadata ?? {}), fontButlerTestFeed: true }
  const rawVersion = String(env?.[TEST_FEED_VERSION_ENV] ?? '').trim()
  if (rawVersion) {
    const version = rawVersion.replace(/^v/i, '')
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
      return {
        build,
        error: `FONT_BUTLER_TEST_VERSION must be a semver version, not "${rawVersion}".`,
      }
    }
    extraMetadata.version = version
  }
  return {
    build: {
      ...build,
      appId: TEST_FEED_APP_ID,
      productName: TEST_FEED_PRODUCT_NAME,
      extraMetadata,
    },
    error: null,
  }
}

/** Full electron-builder config. Booleans stay booleans: `-c.dmg.sign=true` is the string "true", and dmg signing checks `=== true`. */
export function packConfig(build, plan) {
  const mac = {
    ...build.mac,
    identity: plan.identity,
    forceCodeSigning: plan.forceCodeSigning,
  }
  if (plan.adhocEntitlements) {
    mac.entitlements = plan.adhocEntitlements
    mac.entitlementsInherit = plan.adhocEntitlements
  }
  const config = { ...build, mac }
  if (plan.signDmg) config.dmg = { ...(build.dmg ?? {}), sign: true }
  return config
}

export function electronBuilderArgs(configPath) {
  return ['--mac', '--publish', 'never', '--config', configPath]
}

/** Notarize only via the keychain profile. Other Apple credential env vars are removed so a partial APPLE_ID cannot fail the pack or show up in the pack environment. */
export function applyNotaryEnv(baseEnv, plan) {
  const env = { ...baseEnv }
  if (!env.COPYFILE_DISABLE) env.COPYFILE_DISABLE = '1'
  for (const key of NOTARY_ENV_KEYS) delete env[key]
  if (plan.keychainProfile) {
    env.APPLE_KEYCHAIN_PROFILE = plan.keychainProfile
    if (plan.keychain) env.APPLE_KEYCHAIN = plan.keychain
  }
  return env
}

export function releaseConfigErrors(pkg) {
  const mac = pkg?.build?.mac
  const errors = []
  if (mac?.identity !== DEVELOPER_ID_IDENTITY) {
    errors.push(`mac.identity must be ${DEVELOPER_ID_IDENTITY}`)
  }
  if (mac?.hardenedRuntime !== true) errors.push('mac.hardenedRuntime must be true')
  if (mac?.notarize !== true) errors.push('mac.notarize must be true')
  if (mac?.type === 'development') errors.push('mac.type must stay distribution so get-task-allow is not injected')
  if (mac?.entitlements !== 'build/entitlements.mac.plist') {
    errors.push('mac.entitlements must be build/entitlements.mac.plist')
  }
  if (mac?.entitlementsInherit !== 'build/entitlements.mac.plist') {
    errors.push('mac.entitlementsInherit must be build/entitlements.mac.plist')
  }
  if (mac?.signIgnore != null) errors.push('mac.signIgnore must stay unset so every nested binary is signed')
  if (pkg?.build?.dmg?.sign === true) {
    errors.push('package.json must leave dmg.sign unset; only the notarized pack config sets it')
  }
  if (!pkg?.scripts?.['release:mac']?.includes('mac-pack.mjs --release')) {
    errors.push('release:mac must run scripts/mac-pack.mjs --release')
  }
  if (!pkg?.scripts?.['publish:mac']?.includes('upload-mac-release.mjs')) {
    errors.push('publish:mac must run scripts/upload-mac-release.mjs')
  }
  if (pkg?.scripts?.dist?.includes('CSC_IDENTITY_AUTO_DISCOVERY=false')) {
    errors.push('dist must not set CSC_IDENTITY_AUTO_DISCOVERY=false')
  }
  if (pkg?.scripts?.['release:mac']?.includes('CSC_IDENTITY_AUTO_DISCOVERY=false')) {
    errors.push('release:mac must not set CSC_IDENTITY_AUTO_DISCOVERY=false')
  }
  for (const name of ['dist', 'release:mac']) {
    if (!pkg?.scripts?.[name]?.includes('--publish') && !pkg?.scripts?.[name]?.includes('mac-pack.mjs')) {
      errors.push(`${name} must pack through scripts/mac-pack.mjs`)
    }
  }
  return errors
}

/**
 * Decides how a macOS pack is signed.
 *
 * The electron-builder config pins identity `DANIEL QUISEK (A7WWML89LQ)` (no
 * `Developer ID Application:` prefix — electron-builder adds that). Notarization
 * is electron-builder 26's built-in step (`mac.notarize: true`), which calls
 * `@electron/notarize` only when `APPLE_KEYCHAIN_PROFILE` is set, then staples
 * the .app. This module does not store passwords or API keys.
 */

export const DEVELOPER_ID_IDENTITY = 'DANIEL QUISEK (A7WWML89LQ)'
export const NOTARY_KEYCHAIN_PROFILE = 'font-butler-notary'
export const ADHOC_ENTITLEMENTS = 'build/entitlements.mac.adhoc.plist'

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

/**
 * @param {{ platform: string, release: boolean, env: NodeJS.ProcessEnv, developerIdPresent: boolean }} input
 */
export function planMacPack({ platform, release, env, developerIdPresent }) {
  const requestedProfile = (env.APPLE_KEYCHAIN_PROFILE || '').trim()
  const requestedKeychain = (env.APPLE_KEYCHAIN || '').trim()

  if (release) {
    if (platform !== 'darwin') {
      return {
        error:
          'npm run release:mac only runs on macOS. It needs the Developer ID certificate and the notarytool keychain profile on this Mac.',
      }
    }
    const keychainProfile = requestedProfile || NOTARY_KEYCHAIN_PROFILE
    return {
      mode: 'release',
      identity: DEVELOPER_ID_IDENTITY,
      forceCodeSigning: true,
      adhocEntitlements: null,
      keychainProfile,
      keychain: requestedKeychain || null,
      summary: `Signing with Developer ID identity "${DEVELOPER_ID_IDENTITY}" and notarizing with keychain profile "${keychainProfile}".`,
    }
  }

  if (platform !== 'darwin') {
    return {
      mode: 'skip-platform',
      identity: DEVELOPER_ID_IDENTITY,
      forceCodeSigning: false,
      adhocEntitlements: null,
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
      keychainProfile: null,
      keychain: null,
      summary: `Developer ID identity "${DEVELOPER_ID_IDENTITY}" is not in the keychain. Ad-hoc signing this build so it still launches. Notarization is skipped.`,
    }
  }

  if (!requestedProfile) {
    return {
      mode: 'developer-id',
      identity: DEVELOPER_ID_IDENTITY,
      forceCodeSigning: false,
      adhocEntitlements: null,
      keychainProfile: null,
      keychain: null,
      summary: `Signing with Developer ID identity "${DEVELOPER_ID_IDENTITY}". APPLE_KEYCHAIN_PROFILE is unset, so notarization is skipped.`,
    }
  }

  return {
    mode: 'developer-id',
    identity: DEVELOPER_ID_IDENTITY,
    forceCodeSigning: false,
    adhocEntitlements: null,
    keychainProfile: requestedProfile,
    keychain: requestedKeychain || null,
    summary: `Signing with Developer ID identity "${DEVELOPER_ID_IDENTITY}" and notarizing with keychain profile "${requestedProfile}".`,
  }
}

export function electronBuilderArgs(plan) {
  const args = ['--mac', '--publish', 'never', `-c.mac.identity=${plan.identity}`]
  // electron-builder 26 leaves this CLI value as the string "true". The
  // forceCodeSigning getter treats any non-empty value as on. Do not pass
  // hardenedRuntime here: the string "false" would not turn it off.
  if (plan.forceCodeSigning) args.push('-c.mac.forceCodeSigning=true')
  if (plan.adhocEntitlements) {
    args.push(`-c.mac.entitlements=${plan.adhocEntitlements}`)
    args.push(`-c.mac.entitlementsInherit=${plan.adhocEntitlements}`)
  }
  return args
}

/** Notarize only via the keychain profile. Other Apple credential env vars are removed so a partial APPLE_ID cannot fail the pack. */
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
  if (mac?.entitlements !== 'build/entitlements.mac.plist') {
    errors.push('mac.entitlements must be build/entitlements.mac.plist')
  }
  if (mac?.entitlementsInherit !== 'build/entitlements.mac.plist') {
    errors.push('mac.entitlementsInherit must be build/entitlements.mac.plist')
  }
  if (pkg?.build?.dmg?.sign === true) {
    errors.push('dmg.sign must stay unset so the disk image is not signed separately')
  }
  if (!pkg?.scripts?.['release:mac']?.includes('mac-pack.mjs --release')) {
    errors.push('release:mac must run scripts/mac-pack.mjs --release')
  }
  if (pkg?.scripts?.dist?.includes('CSC_IDENTITY_AUTO_DISCOVERY=false')) {
    errors.push('dist must not set CSC_IDENTITY_AUTO_DISCOVERY=false')
  }
  if (pkg?.scripts?.['release:mac']?.includes('CSC_IDENTITY_AUTO_DISCOVERY=false')) {
    errors.push('release:mac must not set CSC_IDENTITY_AUTO_DISCOVERY=false')
  }
  return errors
}

import { spawnSync as nodeSpawnSync } from 'node:child_process'
import {
  existsSync as nodeExistsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync as nodeReadFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEVELOPER_ID_TEAM, readAppTestFeedMarker } from '../electron/app-update-install.mjs'
import {
  FINDER_SYNC_AGENT_APP_NAME,
  FINDER_SYNC_AGENT_EXECUTABLE,
  finderSyncAgentBundleProgram,
  finderSyncAgentInfoPlist,
  finderSyncAgentLabel,
  finderSyncAgentLaunchAgentPlist,
  finderSyncAgentMachServiceKeys,
  finderSyncAgentPlistName,
  finderSyncAppGroup,
  finderSyncMachService,
} from '../electron/finder-sync.mjs'
import { DEVELOPER_ID_IDENTITY } from './mac-signing.mjs'
import { finderSyncCodesignIdentity, plistString } from './build-finder-sync.mjs'
import { compileMachOSlices, strayMachOFiles } from './macho-slices.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(repoRoot, 'macos/FinderSyncAgent/FinderSyncAgent.mm')

export function finderSyncAgentAppPath(appBundle) {
  return path.join(appBundle, 'Contents', 'Helpers', FINDER_SYNC_AGENT_APP_NAME)
}

export function finderSyncAgentExecutablePath(appBundle) {
  return path.join(finderSyncAgentAppPath(appBundle), 'Contents', 'MacOS', FINDER_SYNC_AGENT_EXECUTABLE)
}

export function finderSyncAgentPlistPath(appBundle, testFeed) {
  return path.join(appBundle, 'Contents', 'Library', 'LaunchAgents', finderSyncAgentPlistName(testFeed))
}

function agentCompileArgs(src, out, archArgs) {
  return [
    '-std=c++17',
    '-ObjC++',
    '-fobjc-arc',
    '-mmacosx-version-min=11.0',
    ...archArgs,
    '-framework',
    'Cocoa',
    '-framework',
    'Security',
    '-o',
    out,
    src,
  ]
}

export function compileFinderSyncAgent({
  repo = repoRoot,
  out,
  arch = process.arch,
  clang = process.env.FONT_BUTLER_CLANG || 'clang++',
  spawnSync = nodeSpawnSync,
} = {}) {
  if (process.platform !== 'darwin') {
    return { ok: false, skipped: true, reason: 'Finder Sync agent compiles only on macOS' }
  }
  const src = path.join(repo, 'macos/FinderSyncAgent/FinderSyncAgent.mm')
  if (!nodeExistsSync(src)) return { ok: false, skipped: false, reason: `Missing ${src}` }
  if (!out) return { ok: false, skipped: false, reason: 'Missing agent output path' }
  return compileMachOSlices({
    out,
    arch,
    clang,
    spawnSync,
    argsFor: (sliceOut, archArgs) => agentCompileArgs(src, sliceOut, archArgs),
  })
}

/** Application group only. The helper does not get the app's allow-jit entitlement. */
export function finderSyncAgentEntitlementsPlist(testFeed) {
  const group = finderSyncAppGroup(testFeed)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.application-groups</key>
    <array>
      <string>${group}</string>
    </array>
  </dict>
</plist>
`
}

/**
 * Put this flavour's helper and LaunchAgent plist in the app. The other
 * flavour's plist is removed so a test app cannot register the release service.
 * electron-builder signs the nested helper with entitlementsInherit, which
 * carries this build's application group. The Info.plist identifier is what
 * codesign keeps when it re-signs the nested app.
 */
export function installFinderSyncAgent({
  appBundle,
  testFeed = false,
  version = '1.0',
  arch,
  clang,
  spawnSync,
} = {}) {
  if (process.platform !== 'darwin') {
    return { ok: false, skipped: true, reason: 'Finder Sync agent compiles only on macOS' }
  }
  if (!appBundle) return { ok: false, skipped: false, reason: 'Missing app bundle' }
  const executable = finderSyncAgentExecutablePath(appBundle)
  const compiled = compileFinderSyncAgent({ out: executable, arch, clang, spawnSync })
  if (!compiled.ok) return compiled
  const stray = strayMachOFiles(finderSyncAgentAppPath(appBundle), { allow: [executable] })
  if (stray.length) {
    return { ok: false, skipped: false, reason: `Stray Mach-O in the Finder Sync agent: ${stray.join(', ')}` }
  }
  const contents = path.join(finderSyncAgentAppPath(appBundle), 'Contents')
  mkdirSync(contents, { recursive: true })
  writeFileSync(path.join(contents, 'Info.plist'), finderSyncAgentInfoPlist({ testFeed, version }))
  const plistPath = finderSyncAgentPlistPath(appBundle, testFeed)
  mkdirSync(path.dirname(plistPath), { recursive: true })
  writeFileSync(plistPath, finderSyncAgentLaunchAgentPlist(testFeed))
  const other = finderSyncAgentPlistPath(appBundle, !testFeed)
  if (nodeExistsSync(other)) rmSync(other)
  return {
    ok: true,
    skipped: false,
    executable,
    plistPath,
    label: finderSyncAgentLabel(testFeed),
    service: finderSyncMachService(testFeed),
  }
}

/**
 * Sign the helper with the application group and the hardened runtime, and
 * without allow-jit. electron-builder skips this nested app so it does not
 * replace this signature with entitlementsInherit.
 */
export function signFinderSyncAgent({
  appBundle,
  identity,
  testFeed = false,
  keychain,
  spawnSync = nodeSpawnSync,
} = {}) {
  const signIdentity = finderSyncCodesignIdentity(identity)
  if (!signIdentity) return { ok: false, reason: 'No signing identity for the Finder Sync agent.' }
  const helperApp = finderSyncAgentAppPath(appBundle)
  if (!nodeExistsSync(helperApp)) return { ok: false, reason: 'The Finder Sync agent app is missing.' }
  const temporary = mkdtempSync(path.join(tmpdir(), 'font-butler-finder-sync-agent-entitlements-'))
  const entitlementsFile = path.join(temporary, 'entitlements.plist')
  writeFileSync(entitlementsFile, finderSyncAgentEntitlementsPlist(testFeed))
  const args = ['--force', '--sign', signIdentity, '--entitlements', entitlementsFile, '--options', 'runtime']
  if (signIdentity !== '-') args.push('--timestamp')
  if (keychain) args.push('--keychain', keychain)
  args.push(helperApp)
  try {
    const result = spawnSync('codesign', args, { encoding: 'utf8' })
    if ((result?.status ?? 1) !== 0) {
      const detail = [result?.stderr, result?.stdout, result?.error?.message].filter(Boolean).join('\n')
      return { ok: false, reason: detail || 'codesign failed for the Finder Sync agent' }
    }
    return { ok: true, identity: signIdentity }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

export function finderSyncAgentFailures({
  present = false,
  otherPresent = false,
  plist = '',
  infoPlist = '',
  executablePresent = false,
  programMatches = false,
  testFeed = false,
  codesignDisplay = '',
  codesignVerifyStatus = 1,
  entitlementText = '',
  requireDeveloperId = false,
  teamId = DEVELOPER_ID_TEAM,
} = {}) {
  const failures = []
  const label = finderSyncAgentLabel(testFeed)
  const service = finderSyncMachService(testFeed)
  const otherService = finderSyncMachService(!testFeed)
  if (!present) {
    failures.push(`The Finder Sync LaunchAgent plist ${finderSyncAgentPlistName(testFeed)} is missing.`)
    return failures
  }
  if (otherPresent) {
    failures.push(`The other Finder Sync LaunchAgent plist ${finderSyncAgentPlistName(!testFeed)} is packed in this app.`)
  }
  if (plistString(plist, 'Label') !== label) {
    failures.push(`The Finder Sync agent label is ${plistString(plist, 'Label') || 'missing'}, expected ${label}.`)
  }
  if (plistString(plist, 'BundleProgram') !== finderSyncAgentBundleProgram()) {
    failures.push('The Finder Sync agent BundleProgram does not point at the helper executable.')
  }
  if (!programMatches || !executablePresent) {
    failures.push('The Finder Sync agent executable is missing from the app bundle.')
  }
  const services = finderSyncAgentMachServiceKeys(plist)
  if (services.length !== 1 || services[0] !== service) {
    failures.push(`The Finder Sync agent MachServices entry is ${services[0] || 'missing'}, expected ${service}.`)
  }
  if (services.includes(otherService) || plist.includes('KeepAlive') || !/<key>RunAtLoad<\/key>\s*<false\/>/.test(plist)) {
    failures.push('The Finder Sync agent plist must vend only this flavour, with RunAtLoad false and no KeepAlive.')
  }
  const associated = [...String(plist).matchAll(/<key>AssociatedBundleIdentifiers<\/key>\s*<array>([\s\S]*?)<\/array>/g)]
  const ids = associated[0] ? [...associated[0][1].matchAll(/<string>([^<]*)<\/string>/g)].map((match) => match[1]) : []
  if (ids.length !== 1 || ids[0] !== 'app.fontbutler.desktop') {
    failures.push('The Finder Sync agent must associate only app.fontbutler.desktop.')
  }
  if (plistString(infoPlist, 'CFBundleIdentifier') !== label) {
    failures.push(`The Finder Sync agent bundle id is ${plistString(infoPlist, 'CFBundleIdentifier') || 'missing'}, expected ${label}.`)
  }
  if (!/<key>LSBackgroundOnly<\/key>\s*<true\/>/.test(infoPlist)) {
    failures.push('The Finder Sync agent must be a background-only helper.')
  }
  if (/com\.apple\.security\.cs\.allow-jit/.test(entitlementText)) {
    failures.push('The Finder Sync agent must not have allow-jit.')
  }
  if (codesignVerifyStatus !== 0) {
    failures.push('codesign --verify --strict failed on the Finder Sync agent.')
  }
  if (!codesignDisplay.includes(`Identifier=${label}`)) {
    failures.push(`The Finder Sync agent identifier is not ${label}.`)
  }
  const group = finderSyncAppGroup(testFeed)
  const otherGroup = finderSyncAppGroup(!testFeed)
  const strings = [...String(entitlementText ?? '').matchAll(/<string>([^<]*)<\/string>/g)].map((match) => match[1])
  if (!strings.includes(group) || strings.includes(otherGroup)) {
    failures.push(`The Finder Sync agent application group is missing ${group}.`)
  }
  if (requireDeveloperId) {
    if (/Signature=adhoc/i.test(codesignDisplay)) failures.push('The Finder Sync agent is ad-hoc signed.')
    if (!codesignDisplay.includes(`Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}`)) {
      failures.push(`The Finder Sync agent is not signed with Developer ID identity "${DEVELOPER_ID_IDENTITY}".`)
    }
    const team = codesignDisplay.match(/TeamIdentifier=([^\s]+)/)?.[1] ?? ''
    if (team !== teamId) failures.push(`The Finder Sync agent team ID is not ${teamId}.`)
    if (!/flags=0x[0-9a-fA-F]+\([^)\n]*\bruntime\b/.test(codesignDisplay)) {
      failures.push('The Finder Sync agent is not signed with the hardened runtime.')
    }
  }
  return failures
}

export function verifyFinderSyncAgent({
  appBundle,
  testFeed = false,
  requireDeveloperId = false,
  existsSync = nodeExistsSync,
  readFileSync = nodeReadFileSync,
  spawnSync = nodeSpawnSync,
} = {}) {
  const plistPath = appBundle ? finderSyncAgentPlistPath(appBundle, testFeed) : ''
  const otherPath = appBundle ? finderSyncAgentPlistPath(appBundle, !testFeed) : ''
  const infoPath = appBundle ? path.join(finderSyncAgentAppPath(appBundle), 'Contents', 'Info.plist') : ''
  const executable = appBundle ? finderSyncAgentExecutablePath(appBundle) : ''
  const present = Boolean(plistPath && existsSync(plistPath))
  let plist = ''
  let infoPlist = ''
  let codesignDisplay = ''
  let codesignVerifyStatus = 1
  let entitlementText = ''
  if (present) {
    try {
      plist = readFileSync(plistPath, 'utf8')
    } catch {
      plist = ''
    }
    try {
      infoPlist = readFileSync(infoPath, 'utf8')
    } catch {
      infoPlist = ''
    }
    const helperApp = appBundle ? finderSyncAgentAppPath(appBundle) : ''
    const display = spawnSync('codesign', ['-dv', '--verbose=4', helperApp], { encoding: 'utf8' })
    codesignDisplay = `${display?.stdout ?? ''}\n${display?.stderr ?? ''}`
    const verify = spawnSync('codesign', ['--verify', '--strict', '--verbose=2', helperApp], { encoding: 'utf8' })
    codesignVerifyStatus = verify?.status ?? 1
    const entitlements = spawnSync('codesign', ['-d', '--entitlements', ':-', helperApp], { encoding: 'utf8' })
    entitlementText = `${entitlements?.stdout ?? ''}\n${entitlements?.stderr ?? ''}`
  }
  const program = plistString(plist, 'BundleProgram')
  const failures = finderSyncAgentFailures({
    present,
    otherPresent: Boolean(otherPath && existsSync(otherPath)),
    plist,
    infoPlist,
    executablePresent: Boolean(executable && existsSync(executable)),
    programMatches: Boolean(appBundle && program && existsSync(path.join(appBundle, program))),
    testFeed,
    codesignDisplay,
    codesignVerifyStatus,
    entitlementText,
    requireDeveloperId,
  })
  return { ok: failures.length === 0, failures }
}

export function finderSyncAgentReleaseFailures(appPath, { readFile = nodeReadFileSync, exists = nodeExistsSync, runCommand } = {}) {
  const testFeed = readAppTestFeedMarker(appPath) === true
  const helperApp = finderSyncAgentAppPath(appPath)
  const display = runCommand ? runCommand('codesign', ['-dv', '--verbose=4', helperApp]) : { status: 1, output: '' }
  const verify = runCommand
    ? runCommand('codesign', ['--verify', '--strict', '--verbose=2', helperApp])
    : { status: 1, output: '' }
  const entitlements = runCommand
    ? runCommand('codesign', ['-d', '--entitlements', ':-', helperApp])
    : { status: 1, output: '' }
  let plist = ''
  let infoPlist = ''
  const flavourPlist = finderSyncAgentPlistPath(appPath, testFeed)
  try {
    plist = readFile(flavourPlist, 'utf8')
  } catch {
    plist = ''
  }
  try {
    infoPlist = readFile(path.join(helperApp, 'Contents', 'Info.plist'), 'utf8')
  } catch {
    infoPlist = ''
  }
  const program = plistString(plist, 'BundleProgram')
  return finderSyncAgentFailures({
    present: exists(flavourPlist),
    otherPresent: exists(finderSyncAgentPlistPath(appPath, !testFeed)),
    plist,
    infoPlist,
    executablePresent: exists(finderSyncAgentExecutablePath(appPath)),
    programMatches: Boolean(program && exists(path.join(appPath, program))),
    testFeed,
    codesignDisplay: display.output ?? '',
    codesignVerifyStatus: verify.status ?? 1,
    entitlementText: entitlements.output ?? '',
    requireDeveloperId: true,
  })
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  if (process.platform !== 'darwin') {
    console.log('Finder Sync agent compiles only on macOS')
    process.exit(0)
  }
  const temp = mkdtempSync(path.join(tmpdir(), 'font-butler-agent-'))
  try {
    const result = compileFinderSyncAgent({ out: path.join(temp, FINDER_SYNC_AGENT_EXECUTABLE) })
    if (!result.ok) {
      console.error(result.reason)
      process.exit(1)
    }
    console.log(`Compiled ${sourcePath}`)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

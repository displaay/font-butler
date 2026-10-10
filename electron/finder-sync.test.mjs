import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { DEVELOPER_ID_TEAM } from './app-update-install.mjs'
import { FINDER_INSTALL, FINDER_INSTALL_AS, FINDER_LINK_TO } from './finder-install.mjs'
import {
  FINDER_SYNC_APP_GROUP_ENTITLEMENT,
  FINDER_SYNC_BUNDLE_ID,
  FINDER_SYNC_ENTITLEMENT,
  FINDER_SYNC_EXECUTABLE,
  FINDER_SYNC_EXTENSION_POINT,
  FINDER_SYNC_MAX_BYTES,
  FINDER_SYNC_MAX_FILES,
  FINDER_SYNC_PRINCIPAL_CLASS,
  FINDER_SYNC_SETTINGS_URL,
  FINDER_SYNC_SHARED_ROOT,
  FINDER_SYNC_SYSTEM_FONTS_ROOT,
  FINDER_SYNC_TEAM_ID,
  FINDER_SYNC_TEST_BUNDLE_ID,
  FINDER_SYNC_AGENT_DISABLED,
  FINDER_SYNC_MISSING_APP,
  FINDER_SYNC_PENDING_ERROR_FILE,
  FINDER_SYNC_REQUEST_CAP,
  FINDER_SYNC_SOCKET_DIR,
  FINDER_SYNC_TOO_LARGE,
  FINDER_SYNC_TOO_MANY_FILES,
  FINDER_SYNC_TREE_TOO_DEEP,
  FINDER_SYNC_CHANGED_BEFORE_INSTALL,
  finderSyncAgentBundleProgram,
  finderSyncAgentCodeSigningRequirement,
  finderSyncAgentLabel,
  finderSyncAgentLaunchAgentPlist,
  finderSyncAgentMachServiceKeys,
  finderSyncAgentPlistName,
  finderSyncAppGroup,
  finderSyncAppGroupIsTeamPrefixed,
  finderSyncAppexBundlePath,
  finderSyncBundleId,
  finderSyncClangArchArgs,
  finderSyncCodeSigningRequirement,
  finderSyncMachService,
  finderSyncMenuTitle,
  finderSyncParentCodeSigningRequirement,
  finderSyncSocketDirectoryName,
  finderSyncSocketName,
  finderSyncMonitorDirectories,
  finderSyncWireAction,
  fontMagicKind,
  formatFinderSyncRejections,
  isSafeFinderSyncPath,
  commitFinderSyncAgentRegistration,
  finderSyncRequestSeen,
  noteFinderSyncRequest,
  addFinderSyncPendingError,
  parsePluginkitFinderSync,
  planFinderSyncAgentRegistration,
  planFinderSyncRegistration,
  prepareFinderSyncSocket,
  readFinderSyncAgentRecord,
  readFinderSyncPendingErrors,
  routeFinderSyncError,
  refreshFinderSyncRegistration,
  revalidateFinderSyncHandles,
  validateFinderSyncSelection,
} from './finder-sync.mjs'
import { compileFinderSyncReceiverAddon } from '../scripts/build-finder-sync-receiver.mjs'
import { compileMachOSlices, strayMachOFiles } from '../scripts/macho-slices.mjs'
import {
  compileFinderSyncAgent,
  finderSyncAgentEntitlementsPlist,
  finderSyncAgentFailures,
} from '../scripts/build-finder-sync-agent.mjs'
import { spawnSync } from 'node:child_process'
import { finderSyncReleaseFailures } from '../scripts/assert-notarized-mac-release.mjs'
import {
  entitlementKeysFromCodesign,
  entitlementTextListsGroup,
  finderSyncAppexFailures,
  finderSyncAppexPath,
  finderSyncCodesignIdentity,
  finderSyncCompileArgs,
  finderSyncEntitlementsPlist,
  finderSyncInfoPlist,
  finderSyncSignArgs,
  macosSwiftTarget,
  plistString,
  prepareFinderSyncAppex,
  signFinderSyncAppex,
  verifyFinderSyncAppex,
} from '../scripts/build-finder-sync.mjs'
import { DEVELOPER_ID_IDENTITY } from '../scripts/mac-signing.mjs'
import { runFinderSyncXpcRejectionTest } from '../scripts/test-finder-sync-xpc.mjs'

function readRepo(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

function fontStat(kind) {
  return {
    isSymbolicLink: () => kind === 'symlink',
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
  }
}

function ioFor(files, { reads = [] } = {}) {
  return {
    lstatSync(filePath) {
      if (!Object.prototype.hasOwnProperty.call(files, filePath)) {
        const error = new Error(`missing ${filePath}`)
        error.code = 'ENOENT'
        throw error
      }
      return files[filePath]
    },
    readPrefix(filePath) {
      reads.push(filePath)
      const header = files[filePath]?.header
      if (!header) throw new Error('unreadable')
      return header
    },
  }
}

const OTTO = Buffer.from('OTTO')
const TTF = Buffer.from([0x00, 0x01, 0x00, 0x00])
const TTC = Buffer.from('ttcf')
const WOFF2 = Buffer.from('wOF2')

function signedGroupKeys() {
  return [FINDER_SYNC_ENTITLEMENT, FINDER_SYNC_APP_GROUP_ENTITLEMENT]
}

test('Finder Sync handoff names one app group and one code-signing requirement per flavour', () => {
  assert.equal(FINDER_SYNC_TEAM_ID, DEVELOPER_ID_TEAM)
  assert.equal(finderSyncMenuTitle(FINDER_INSTALL, false), 'Install')
  assert.equal(finderSyncMenuTitle(FINDER_INSTALL_AS, true), 'Install as… (Test)')
  assert.equal(finderSyncWireAction('install'), FINDER_INSTALL)
  assert.equal(finderSyncWireAction('installAs'), FINDER_INSTALL_AS)
  assert.equal(finderSyncWireAction(FINDER_INSTALL_AS), FINDER_INSTALL_AS)
  assert.equal(finderSyncWireAction(FINDER_LINK_TO), null)
  assert.equal(finderSyncAppGroup(false), finderSyncMachService(false))
  assert.equal(finderSyncAppGroup(true), finderSyncMachService(true))
  assert.equal(finderSyncAppGroup(false), `${FINDER_SYNC_TEAM_ID}.group.${FINDER_SYNC_BUNDLE_ID}`)
  assert.equal(finderSyncAppGroup(true), `${FINDER_SYNC_TEAM_ID}.group.${FINDER_SYNC_TEST_BUNDLE_ID}`)
  assert.equal(finderSyncAppGroupIsTeamPrefixed(finderSyncAppGroup(false)), true)
  assert.equal(finderSyncAppGroupIsTeamPrefixed(finderSyncAppGroup(true)), true)
  assert.equal(finderSyncAppGroupIsTeamPrefixed(`group.${FINDER_SYNC_BUNDLE_ID}`), false)
  assert.notEqual(finderSyncAppGroup(false), finderSyncAppGroup(true))
  const appEntitlements = readRepo('build/entitlements.mac.plist')
  const appexEntitlements = readRepo('build/entitlements.finder-sync.plist')
  const releaseGroup = finderSyncAppGroup(false)
  assert.equal(entitlementTextListsGroup(appEntitlements, releaseGroup), true)
  assert.equal(entitlementTextListsGroup(appexEntitlements, releaseGroup), true)
  assert.equal(entitlementTextListsGroup(readRepo('build/entitlements.mac.adhoc.plist'), releaseGroup), true)
  assert.equal(entitlementTextListsGroup(readRepo('build/entitlements.mac.test-feed.plist'), finderSyncAppGroup(true)), true)
  assert.equal(entitlementTextListsGroup(readRepo('build/entitlements.mac.adhoc.test-feed.plist'), finderSyncAppGroup(true)), true)
  for (const plist of [appEntitlements, appexEntitlements]) {
    assert.doesNotMatch(plist, /<string>group\./)
    assert.doesNotMatch(plist, /temporary-exception|Group Containers/)
  }
  const releaseRequirement = finderSyncCodeSigningRequirement(false)
  const testRequirement = finderSyncCodeSigningRequirement(true)
  assert.equal(
    releaseRequirement,
    `anchor apple generic and certificate leaf[subject.OU] = "${FINDER_SYNC_TEAM_ID}" and identifier "${FINDER_SYNC_BUNDLE_ID}"`,
  )
  assert.equal(
    testRequirement,
    `anchor apple generic and certificate leaf[subject.OU] = "${FINDER_SYNC_TEAM_ID}" and identifier "${FINDER_SYNC_TEST_BUNDLE_ID}"`,
  )
  assert.equal(releaseRequirement.split('identifier').length, 2)
  assert.equal(testRequirement.split('identifier').length, 2)
  assert.equal(releaseRequirement.includes(FINDER_SYNC_TEST_BUNDLE_ID), false)
  assert.ok(testRequirement.includes(`identifier "${FINDER_SYNC_TEST_BUNDLE_ID}"`))
})

test('validateFinderSyncSelection accepts regular font files and refuses escapes', () => {
  assert.equal(fontMagicKind(OTTO), 'sfnt')
  assert.equal(fontMagicKind(TTF), 'sfnt')
  assert.equal(fontMagicKind(TTC), 'collection')
  assert.equal(fontMagicKind(WOFF2), 'woff2')
  assert.equal(isSafeFinderSyncPath('/Fonts/../etc/passwd.otf'), false)
  assert.equal(isSafeFinderSyncPath('Fonts/A.otf'), false)

  const reads = []
  const checked = validateFinderSyncSelection(
    [
      '/Fonts/A.otf',
      '/Fonts/A.otf',
      '/Fonts/B.ttf',
      '/Fonts/C.ttc',
      '/Fonts/D.woff2',
      '/Fonts/../secret.otf',
      'relative.otf',
      '/etc/passwd',
      '/Fonts/alias.otf',
      '/linked/E.otf',
      '/Fonts/Family',
      '/Fonts/notes.txt',
      '/missing.otf',
      '/Fonts/fake.otf',
    ],
    ioFor(
      {
        '/Fonts': fontStat('dir'),
        '/Fonts/A.otf': { ...fontStat('file'), header: OTTO },
        '/Fonts/B.ttf': { ...fontStat('file'), header: TTF },
        '/Fonts/C.ttc': { ...fontStat('file'), header: TTC },
        '/Fonts/D.woff2': { ...fontStat('file'), header: WOFF2 },
        '/Fonts/alias.otf': fontStat('symlink'),
        '/linked': fontStat('symlink'),
        '/Fonts/Family': fontStat('dir'),
        '/Fonts/notes.txt': { ...fontStat('file'), header: Buffer.from('NOTE') },
        '/Fonts/fake.otf': { ...fontStat('file'), header: Buffer.from('NOPE') },
      },
      { reads },
    ),
  )

  assert.deepEqual(checked.paths, [
    '/Fonts/A.otf',
    '/Fonts/B.ttf',
    '/Fonts/C.ttc',
    '/Fonts/D.woff2',
    '/Fonts/Family',
  ])
  for (const filePath of checked.paths) {
    assert.ok(
      ['/Fonts/A.otf', '/Fonts/B.ttf', '/Fonts/C.ttc', '/Fonts/D.woff2', '/Fonts/Family'].includes(filePath),
    )
  }
  assert.ok(checked.paths.length <= 5)
  assert.equal(checked.paths.includes('/etc/passwd'), false)
  assert.equal(checked.paths.includes('/linked/E.otf'), false)
  assert.equal(reads.includes('/Fonts/alias.otf'), false)
  assert.equal(reads.includes('/linked/E.otf'), false)
  assert.equal(reads.includes('/Fonts/Family'), false)
  const reasons = Object.fromEntries(checked.rejected.map((item) => [item.path, item.reason]))
  assert.match(reasons['/Fonts/alias.otf'], /Symlink/)
  assert.match(reasons['/linked/E.otf'], /Symlink/)
  assert.match(reasons['/Fonts/notes.txt'], /Not a font file/)
  assert.match(reasons['/Fonts/fake.otf'], /Not a font file/)
  assert.match(reasons['/missing.otf'], /File not found/)
  assert.match(reasons['/etc/passwd'], /File not found/)
  assert.match(formatFinderSyncRejections(checked.rejected), /\/Fonts\/alias\.otf: Symlink paths are not installed\./)
  const empty = validateFinderSyncSelection([], ioFor({}))
  assert.deepEqual(empty.paths, [])
  assert.deepEqual(empty.rejected, [])
  assert.equal(empty.limitError, null)

  const raced = validateFinderSyncSelection(['/Fonts/swapped.otf'], {
    lstatSync: () => fontStat('file'),
    readPrefix() {
      const error = new Error('symlink')
      error.code = 'ELOOP'
      throw error
    },
  })
  assert.deepEqual(raced.paths, [])
  assert.match(raced.rejected[0].reason, /Symlink/)
})

test('Finder Sync appex identity, plist, and swiftc command stay distinct for test builds', () => {
  assert.equal(finderSyncBundleId(false), FINDER_SYNC_BUNDLE_ID)
  assert.equal(finderSyncBundleId(true), FINDER_SYNC_TEST_BUNDLE_ID)
  assert.notEqual(FINDER_SYNC_BUNDLE_ID, FINDER_SYNC_TEST_BUNDLE_ID)
  const plist = finderSyncInfoPlist({
    bundleId: FINDER_SYNC_TEST_BUNDLE_ID,
    version: '0.9.0',
    testFeed: true,
  })
  assert.equal(plistString(plist, 'CFBundleIdentifier'), FINDER_SYNC_TEST_BUNDLE_ID)
  assert.equal(plistString(plist, 'FontButtlerURLScheme'), '')
  assert.doesNotMatch(plist, /FontButtlerURLScheme|font-butler/)
  assert.equal(plistString(plist, 'FontButtlerMachService'), finderSyncMachService(true))
  assert.equal(plistString(plist, 'FontButtlerInstallTitle'), 'Install (Test)')
  assert.equal(plistString(plist, 'FontButtlerInstallAsTitle'), 'Install as… (Test)')
  const releasePlist = finderSyncInfoPlist({ bundleId: FINDER_SYNC_BUNDLE_ID, version: '0.3.10' })
  assert.equal(plistString(releasePlist, 'FontButtlerURLScheme'), '')
  assert.equal(plistString(releasePlist, 'FontButtlerInstallTitle'), 'Install')
  assert.equal(plistString(plist, 'CFBundleExecutable'), FINDER_SYNC_EXECUTABLE)
  assert.equal(plistString(plist, 'NSExtensionPrincipalClass'), FINDER_SYNC_PRINCIPAL_CLASS)
  assert.equal(plistString(plist, 'NSExtensionPointIdentifier'), FINDER_SYNC_EXTENSION_POINT)
  assert.match(plist, /XPC!/)
  assert.equal(macosSwiftTarget('arm64'), 'arm64-apple-macosx11.0')
  assert.equal(macosSwiftTarget(3), 'arm64-apple-macosx11.0')
  assert.equal(macosSwiftTarget('x64'), 'x86_64-apple-macosx11.0')
  assert.equal(macosSwiftTarget('universal'), null)
  const args = finderSyncCompileArgs({
    sdk: '/sdk',
    target: 'arm64-apple-macosx11.0',
    source: 'FinderSync.swift',
    output: '/out/FontButtlerFinderSync',
  })
  assert.ok(args.includes('swiftc') === false)
  assert.ok(args.includes('-application-extension'))
  assert.ok(args.includes('_NSExtensionMain'))
  assert.ok(args.includes('FinderSync'))
  assert.equal(finderSyncCodesignIdentity('-'), '-')
  assert.equal(
    finderSyncCodesignIdentity(DEVELOPER_ID_IDENTITY),
    `Developer ID Application: ${DEVELOPER_ID_IDENTITY}`,
  )
  const entitlements = readRepo('build/entitlements.finder-sync.plist')
  assert.deepEqual(entitlementKeysFromCodesign(entitlements), signedGroupKeys())
  assert.equal(entitlementTextListsGroup(entitlements, finderSyncAppGroup(false)), true)
  assert.equal(entitlementTextListsGroup(entitlements, finderSyncAppGroup(true)), false)
  assert.doesNotMatch(entitlements, /allow-jit|get-task-allow|disable-library-validation/)
  const generated = finderSyncEntitlementsPlist(true)
  assert.equal(entitlementTextListsGroup(generated, finderSyncAppGroup(true)), true)
  assert.equal(entitlementTextListsGroup(generated, finderSyncAppGroup(false)), false)
})

test('Finder Sync monitors home, /Users/Shared, and /Volumes', () => {
  assert.equal(FINDER_SYNC_SHARED_ROOT, '/Users/Shared')
  assert.equal(FINDER_SYNC_SYSTEM_FONTS_ROOT, '/Library/Fonts')
  assert.deepEqual(finderSyncMonitorDirectories('/Users/ada'), ['/Users/ada', '/Users/Shared', '/Volumes'])
  assert.deepEqual(finderSyncMonitorDirectories('/'), ['/Users/Shared', '/Volumes'])
  assert.deepEqual(finderSyncMonitorDirectories('relative'), ['/Users/Shared', '/Volumes'])
  assert.deepEqual(finderSyncMonitorDirectories('/Users/Shared'), ['/Users/Shared', '/Volumes'])
  assert.equal(finderSyncMonitorDirectories('/Users/ada').includes('/Library/Fonts'), false)
  assert.equal(finderSyncMonitorDirectories('/Library/Fonts').includes('/Library/Fonts'), false)

  const bundleId = FINDER_SYNC_TEST_BUNDLE_ID
  const current = finderSyncAppexBundlePath('/Applications/Font Buttler Test/Font Buttler.app')
  const listed = (flag, pluginPath) =>
    `${flag}    ${bundleId}(0.3.10)\n            Path = ${pluginPath}\n`
  const disabled = parsePluginkitFinderSync(listed('-', current), bundleId)
  assert.equal(planFinderSyncRegistration({ currentAppex: current, record: disabled }).reason, 'disabled')
  const same = parsePluginkitFinderSync(listed('+', current), bundleId)
  assert.equal(planFinderSyncRegistration({ currentAppex: current, record: same }).action, 'none')
  const stalePath = finderSyncAppexBundlePath('/Applications/Font Buttler.app')
  const moved = parsePluginkitFinderSync(listed('+', stalePath), bundleId)
  assert.deepEqual(planFinderSyncRegistration({ currentAppex: current, record: moved }), {
    action: 'reregister',
    appex: current,
    reason: 'moved',
  })
  assert.equal(
    planFinderSyncRegistration({
      currentAppex: current,
      record: parsePluginkitFinderSync('', bundleId),
    }).reason,
    'not-registered',
  )

  const calls = []
  const refreshed = refreshFinderSyncRegistration({
    platform: 'darwin',
    packaged: true,
    appPath: '/Applications/Font Buttler Test/Font Buttler.app',
    testFeed: true,
    spawnSync(command, args) {
      calls.push([command, args])
      if (args.includes('-m')) {
        return { status: 0, stdout: listed('+', stalePath), stderr: '' }
      }
      return { status: 0, stdout: '', stderr: '' }
    },
  })
  assert.equal(refreshed.ok, true)
  assert.equal(refreshed.reason, 'moved')
  assert.deepEqual(calls[1][1], ['-a', current])
  assert.equal(calls.some((call) => call[1].includes('-e')), false)
  const leftDisabled = refreshFinderSyncRegistration({
    platform: 'darwin',
    packaged: true,
    appPath: '/Applications/Font Buttler Test/Font Buttler.app',
    testFeed: true,
    spawnSync() {
      return { status: 0, stdout: listed('-', stalePath), stderr: '' }
    },
  })
  assert.equal(leftDisabled.action, 'none')
  assert.equal(leftDisabled.reason, 'disabled')
  assert.equal(refreshFinderSyncRegistration({ platform: 'linux', packaged: true }).reason, 'skipped')
})

test('appex signing is inside-out and the release check requires sandbox, team, and Developer ID', () => {
  const calls = []
  const signed = signFinderSyncAppex({
    appexPath: '/App/Contents/PlugIns/Font Buttler Finder Sync.appex',
    identity: DEVELOPER_ID_IDENTITY,
    bundleId: FINDER_SYNC_BUNDLE_ID,
    entitlements: '/repo/build/entitlements.finder-sync.plist',
    spawnSync(command, args) {
      calls.push([command, args])
      return { status: 0, stdout: '', stderr: '' }
    },
  })
  assert.equal(signed.ok, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0][0], 'codesign')
  assert.match(calls[0][1].at(-1), /\/Contents\/MacOS\/FontButtlerFinderSync$/)
  assert.match(calls[1][1].at(-1), /\.appex$/)
  assert.ok(calls[0][1].includes('--timestamp'))
  assert.ok(calls[0][1].includes(`Developer ID Application: ${DEVELOPER_ID_IDENTITY}`))
  assert.ok(calls[0][1].includes('--identifier'))
  assert.ok(calls[0][1].includes(FINDER_SYNC_BUNDLE_ID))
  assert.equal(calls[1][1].includes('--identifier'), false)
  assert.deepEqual(
    finderSyncSignArgs({
      identity: '-',
      entitlements: 'entitlements.plist',
      bundleId: FINDER_SYNC_BUNDLE_ID,
      target: '/binary',
    }).includes('--timestamp'),
    false,
  )

  const display = `Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}\nTeamIdentifier=${DEVELOPER_ID_TEAM}\nflags=0x10000(runtime)`
  assert.deepEqual(
    finderSyncAppexFailures({
      present: true,
      bundleId: FINDER_SYNC_BUNDLE_ID,
      expectedBundleId: FINDER_SYNC_BUNDLE_ID,
      principalClass: FINDER_SYNC_PRINCIPAL_CLASS,
      extensionPoint: FINDER_SYNC_EXTENSION_POINT,
      codesignVerifyStatus: 0,
      codesignDisplay: display,
      entitlementKeys: signedGroupKeys(),
      requireDeveloperId: true,
    }),
    [],
  )
  const testId = finderSyncAppexFailures({
    present: true,
    bundleId: FINDER_SYNC_BUNDLE_ID,
    expectedBundleId: FINDER_SYNC_TEST_BUNDLE_ID,
    principalClass: FINDER_SYNC_PRINCIPAL_CLASS,
    extensionPoint: FINDER_SYNC_EXTENSION_POINT,
    codesignVerifyStatus: 0,
    codesignDisplay: display,
    entitlementKeys: signedGroupKeys(),
    requireDeveloperId: true,
  })
  assert.ok(testId.some((failure) => failure.includes(FINDER_SYNC_TEST_BUNDLE_ID)))
  const adHoc = finderSyncAppexFailures({
    present: true,
    bundleId: FINDER_SYNC_BUNDLE_ID,
    expectedBundleId: FINDER_SYNC_BUNDLE_ID,
    principalClass: FINDER_SYNC_PRINCIPAL_CLASS,
    extensionPoint: FINDER_SYNC_EXTENSION_POINT,
    codesignVerifyStatus: 0,
    codesignDisplay: 'Signature=adhoc\nTeamIdentifier=not',
    entitlementKeys: signedGroupKeys(),
    requireDeveloperId: true,
  })
  assert.ok(adHoc.some((failure) => /ad-hoc/.test(failure)))
  assert.ok(adHoc.some((failure) => /team ID/.test(failure)))
  const scheme = finderSyncAppexFailures({
    present: true,
    bundleId: FINDER_SYNC_BUNDLE_ID,
    expectedBundleId: FINDER_SYNC_BUNDLE_ID,
    principalClass: FINDER_SYNC_PRINCIPAL_CLASS,
    extensionPoint: FINDER_SYNC_EXTENSION_POINT,
    codesignVerifyStatus: 0,
    codesignDisplay: display,
    entitlementKeys: signedGroupKeys(),
    requireDeveloperId: true,
    urlScheme: 'font-butler',
  })
  assert.ok(scheme.some((failure) => /URL scheme/.test(failure)))
  const loose = finderSyncAppexFailures({
    present: true,
    bundleId: FINDER_SYNC_BUNDLE_ID,
    expectedBundleId: FINDER_SYNC_BUNDLE_ID,
    principalClass: FINDER_SYNC_PRINCIPAL_CLASS,
    extensionPoint: FINDER_SYNC_EXTENSION_POINT,
    codesignVerifyStatus: 0,
    codesignDisplay: display,
    entitlementKeys: [FINDER_SYNC_ENTITLEMENT, 'com.apple.security.cs.allow-jit'],
    requireDeveloperId: true,
  })
  assert.ok(loose.some((failure) => /application group/.test(failure)))
  assert.deepEqual(
    finderSyncAppexFailures({
      present: false,
      expectedBundleId: FINDER_SYNC_BUNDLE_ID,
      requireDeveloperId: true,
    }),
    ['The Finder Sync appex is missing from Contents/PlugIns.'],
  )

  const verified = verifyFinderSyncAppex({
    appexPath: '/App/Contents/PlugIns/Font Buttler Finder Sync.appex',
    expectedBundleId: FINDER_SYNC_TEST_BUNDLE_ID,
    requireDeveloperId: false,
    existsSync: () => true,
    readFileSync: () => finderSyncInfoPlist({ bundleId: FINDER_SYNC_TEST_BUNDLE_ID, version: '0.9.0', testFeed: true }),
    spawnSync(command, args) {
      if (args.includes('--verify')) return { status: 0, stdout: '', stderr: '' }
      if (args.includes('--entitlements')) {
        return {
          status: 0,
          stdout: `<key>${FINDER_SYNC_ENTITLEMENT}</key><true/><key>${FINDER_SYNC_APP_GROUP_ENTITLEMENT}</key><array><string>${finderSyncAppGroup(true)}</string></array>`,
          stderr: '',
        }
      }
      return { status: 0, stdout: '', stderr: 'Signature=adhoc' }
    },
  })
  assert.equal(verified.ok, true, verified.failures.join('\n'))
})

test('the release assert reads the appex bundle ID against the test-feed marker', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'font-butler-appex-'))
  try {
    const app = path.join(root, 'Font Buttler.app')
    mkdirSync(path.join(app, 'Contents', 'Resources', 'app'), { recursive: true })
    writeFileSync(
      path.join(app, 'Contents', 'Resources', 'app', 'package.json'),
      JSON.stringify({ fontButlerTestFeed: true }),
    )
    const appex = finderSyncAppexPath(app)
    mkdirSync(path.join(appex, 'Contents'), { recursive: true })
    writeFileSync(
      path.join(appex, 'Contents', 'Info.plist'),
      finderSyncInfoPlist({ bundleId: FINDER_SYNC_BUNDLE_ID, version: '0.3.10' }),
    )
    const failures = finderSyncReleaseFailures(app, {
      runCommand: () => ({
        status: 0,
        output: `Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}\nTeamIdentifier=${DEVELOPER_ID_TEAM}\n<key>${FINDER_SYNC_ENTITLEMENT}</key>`,
      }),
    })
    assert.ok(failures.some((failure) => failure.includes(FINDER_SYNC_TEST_BUNDLE_ID)))
    assert.equal(failures.some((failure) => /missing from Contents\/PlugIns/.test(failure)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }

  const assertScript = readRepo('scripts/assert-notarized-mac-release.mjs')
  assert.match(assertScript, /finderSyncReleaseFailures/)
  assert.match(assertScript, /finderSyncAgentReleaseFailures/)
  assert.match(assertScript, /prefixFailures\('DMG'/)
  assert.match(assertScript, /prefixFailures\('Update zip'/)
  assert.match(assertScript, /prefixFailures\('App'/)
})

test('Finder Sync sources hand off over XPC and the pack builds the appex', () => {
  const swift = readRepo('macos/FinderSync/FinderSync.swift')
  const receiver = readRepo('electron/finder-sync-receiver.mm')
  const agent = readRepo('macos/FinderSyncAgent/FinderSyncAgent.mm')
  const nativeTest = readRepo('electron/finder-sync-xpc-test.mm')
  const validator = readRepo('electron/finder-sync.mjs')
  assert.match(swift, /fileURLWithPath: "\/Volumes"/)
  assert.match(swift, /fileURLWithPath: "\/Users\/Shared"/)
  assert.match(swift, /homeDirectoryForCurrentUser/)
  assert.doesNotMatch(swift, /fileURLWithPath: "\/Library\/Fonts"/)
  assert.doesNotMatch(swift, /Group Containers/)
  assert.match(swift, /contextualMenuForItems/)
  assert.match(swift, /selectedItemURLs/)
  assert.match(swift, /allSatisfy\(isInstallSelection\)/)
  assert.match(swift, /hasDirectoryPath/)
  assert.match(swift, /"Install"/)
  assert.match(swift, /Install as…/)
  assert.match(swift, /FontButtlerInstallTitle/)
  assert.match(swift, /parentAppURL/)
  assert.match(swift, /NSXPCConnection/)
  assert.match(swift, /submitAction/)
  assert.match(swift, /statusWithReply/)
  assert.match(swift, /UUID\(\)\.uuidString/)
  assert.match(swift, /"installAs"/)
  assert.match(swift, /#available\(macOS 13\.0, \*\)/)
  assert.match(swift, /finderSyncMissingApp/)
  assert.match(swift, /finderSyncAgentDisabled/)
  assert.doesNotMatch(swift, /UNUserNotificationCenter/)
  assert.match(swift, /NSLog\(/)
  assert.doesNotMatch(swift, /NSAlert/)
  assert.ok(swift.includes(FINDER_SYNC_MISSING_APP))
  assert.doesNotMatch(swift, /addingTimeInterval\(10\)/)
  assert.doesNotMatch(swift, /appleEvent|withApplicationAt|AEEvent|NSAppleEventDescriptor/)
  assert.doesNotMatch(swift, /fileURLWithPath: "\/"/)
  const releaseRequirement = finderSyncCodeSigningRequirement(false).replaceAll('"', '\\"')
  const testRequirement = finderSyncCodeSigningRequirement(true).replaceAll('"', '\\"')
  const releaseAgentRequirement = finderSyncAgentCodeSigningRequirement(false).replaceAll('"', '\\"')
  const testAgentRequirement = finderSyncAgentCodeSigningRequirement(true).replaceAll('"', '\\"')
  assert.ok(agent.includes(releaseRequirement))
  assert.ok(agent.includes(testRequirement))
  assert.ok(agent.includes(finderSyncMachService(false)))
  assert.ok(agent.includes(finderSyncMachService(true)))
  assert.ok(agent.includes(finderSyncParentCodeSigningRequirement().replaceAll('"', '\\"')))
  assert.ok(agent.includes(finderSyncSocketName(false)))
  assert.ok(agent.includes(finderSyncSocketName(true)))
  assert.ok(agent.includes(FINDER_SYNC_SOCKET_DIR))
  assert.equal(finderSyncSocketDirectoryName(), FINDER_SYNC_SOCKET_DIR)
  assert.match(agent, /initWithMachServiceName/)
  assert.match(agent, /setCodeSigningRequirement/)
  assert.match(agent, /pingWithReply/)
  assert.match(agent, /SecRequirementCreateWithString/)
  assert.match(agent, /kSecCSStrictValidate/)
  assert.match(agent, /LOCAL_PEERTOKEN/)
  assert.match(agent, /SecCodeCopyGuestWithAttributes/)
  assert.match(agent, /kSecGuestAttributeAudit/)
  assert.match(agent, /_CS_DARWIN_USER_TEMP_DIR/)
  assert.doesNotMatch(agent, /g_launchFailed/)
  assert.match(agent, /g_launchedApp = NO/)
  assert.doesNotMatch(agent, /UNUserNotificationCenter/)
  assert.match(agent, /NSLog\(@"Finder Sync:/)
  assert.match(agent, /finder-sync-pending-error\.json/)
  assert.match(agent, /g_testFeed \? @"Font Buttler Test" : @"Font Buttler"/)
  assert.doesNotMatch(readRepo('scripts/build-finder-sync-agent.mjs'), /UserNotifications/)
  assert.doesNotMatch(readRepo('scripts/build-finder-sync.mjs'), /UserNotifications/)
  assert.ok(agent.includes(FINDER_SYNC_MISSING_APP))
  assert.match(agent, /openApplicationAtURL/)
  assert.doesNotMatch(agent, /strcmp|kSecCodeInfoTeamIdentifier|kSecGuestAttributePid|LOCAL_PEERPID|getpid/)
  assert.ok(receiver.includes(releaseAgentRequirement))
  assert.ok(receiver.includes(testAgentRequirement))
  assert.ok(receiver.includes(finderSyncSocketName(false)))
  assert.ok(receiver.includes(finderSyncSocketName(true)))
  assert.ok(receiver.includes(FINDER_SYNC_SOCKET_DIR))
  assert.match(receiver, /SMAppService/)
  assert.match(receiver, /agentServiceWithPlistName/)
  assert.match(receiver, /LOCAL_PEERTOKEN/)
  assert.match(receiver, /SecRequirementCreateWithString/)
  assert.match(receiver, /kSecCSStrictValidate/)
  assert.match(receiver, /SecCodeCopyGuestWithAttributes/)
  assert.match(receiver, /kSecGuestAttributeAudit/)
  assert.match(receiver, /openSystemSettingsLoginItems/)
  assert.match(receiver, /unregisterAndReturnError/)
  assert.match(receiver, /registerAndReturnError/)
  assert.doesNotMatch(receiver, /umask\s*\(/)
  assert.match(receiver, /mkdir\(dirOut, 0700\)/)
  assert.match(receiver, /DirectoryIsUserPrivate/)
  assert.match(receiver, /TempDirIsUserPrivate/)
  assert.match(receiver, /S_ISSOCK/)
  assert.match(receiver, /st_uid != getuid/)
  assert.match(receiver, /agentServiceWithPlistName:CurrentAgentPlistName\(\)/)
  assert.doesNotMatch(receiver, /agentServiceWithPlistName:kRelease/)
  assert.doesNotMatch(receiver, /initWithMachServiceName|setCodeSigningRequirement/)
  assert.doesNotMatch(receiver, /LOCAL_PEERPID|kSecGuestAttributePid/)
  assert.ok(nativeTest.includes(releaseRequirement))
  assert.match(nativeTest, /SecCodeCopySelf/)
  assert.match(nativeTest, /kSecCSStrictValidate/)
  assert.match(nativeTest, /anonymousListener/)
  assert.doesNotMatch(receiver, /strcmp|kSecCodeInfoTeamIdentifier|kSecCodeInfoIdentifier|kSecCodeSignatureAdhoc/)
  assert.doesNotMatch(receiver, /kAEOpenDocuments|AEInstallEventHandler|kSecGuestAttributePid|getpid/)
  assert.doesNotMatch(nativeTest, /strcmp|kSecCodeInfoTeamIdentifier/)
  assert.doesNotMatch(swift, /\/Applications\/Font Buttler\.app/)
  assert.doesNotMatch(swift, /font-butler|FontButtlerURLScheme|URLComponents|CloudStorage|Mobile Documents|NSXPCListener|xpc_connection/)
  assert.doesNotMatch(swift, /CTFontManager|copyItem|removeItem|trashItem|NSAppleScript|\/api\/install/)
  assert.doesNotMatch(validator, /more files than the selection/)

  const main = readRepo('electron/main.mjs')
  assert.match(main, /enqueueValidatedFinderInstall/)
  assert.match(main, /validateFinderSyncSelection/)
  assert.match(main, /revalidateFinderSyncHandles/)
  assert.match(main, /O_NOFOLLOW/)
  assert.match(main, /finderSyncWireAction/)
  assert.match(main, /finder-sync-receiver\.node/)
  assert.match(main, /--finder-sync-agent-status/)
  assert.match(main, /agentStatus/)
  assert.match(main, /will-finish-launching/)
  assert.doesNotMatch(main, /acceptFinderSyncHandoff|claimFinderSyncPaths|setAsDefaultProtocolClient|removeAsDefaultProtocolClient|parseFinderLaunch|parseFinderInstallUrl|enqueueFinderHandoff/)
  assert.match(main, /refreshFinderSyncRegistration/)
  assert.match(main, /handles: checked\.handles/)
  assert.match(main, /open-finder-extensions/)
  assert.match(main, /open-finder-sync-login-items/)
  assert.match(main, /openLoginItems/)
  assert.match(main, /registerAgent/)
  assert.match(main, /unregisterAgent/)
  assert.match(main, /finderSyncRequestSeen/)
  assert.match(main, /noteFinderSyncRequest/)
  assert.match(main, /commitFinderSyncAgentRegistration/)
  assert.match(main, /appBundlePath/)
  assert.match(main, /routeFinderSyncError/)
  assert.match(main, /presentFinderSyncUserError/)
  assert.match(main, /consumeFinderSyncPendingErrors\(\)/)
  assert.match(main, /FINDER_SYNC_PENDING_ERROR_FILE/)
  assert.match(main, /dialog\.showErrorBox\('Font Buttler', route\.message\)/)
  assert.doesNotMatch(main, /UNUserNotificationCenter/)
  const readyHandler = main.slice(main.indexOf('app.whenReady()'))
  const bootstrapAt = readyHandler.indexOf('await bootstrapApi()')
  const consumeAt = readyHandler.indexOf('consumeFinderSyncPendingErrors()')
  assert.ok(bootstrapAt >= 0 && consumeAt > bootstrapAt)
  assert.doesNotMatch(main, /launchctl/)
  assert.doesNotMatch(main, /parseLaunchctlProgram/)
  assert.match(agent, /!ForwardErrorToApp\(message\)\) WritePendingFinderSyncError/)
  assert.match(receiver, /json\[@"error"\]/)
  assert.ok(swift.includes(FINDER_SYNC_AGENT_DISABLED))
  const enableHandler = main.slice(main.indexOf("ipcMain.handle('set-finder-sync-agent-enabled'"))
  const beforeSave = enableHandler.slice(0, enableHandler.indexOf('saveFinderSyncAgentRecord'))
  assert.match(beforeSave, /loadFinderSyncReceiver\(\)/)
  assert.match(beforeSave, /if \(!addon\) return false/)
  assert.match(main, /FINDER_SYNC_SETTINGS_URL/)
  assert.equal(
    FINDER_SYNC_SETTINGS_URL,
    'x-apple.systempreferences:com.apple.LoginItems-Settings.extension',
  )
  assert.match(main, /app\.on\('open-url', \(event\) => \{\s*event\.preventDefault\(\)\s*\}\)/)
  assert.match(main, /addon\.register\(\(action, filePaths\) => \{\s*enqueueFinderJob\(action, filePaths\)/s)
  assert.match(main, /runFinderInstall/)
  const preload = readRepo('electron/preload.cjs')
  assert.match(preload, /openFinderExtensions/)
  const settings = readRepo('src/components/SettingsDialog.tsx')
  const onboarding = readRepo('src/components/OnboardingDialog.tsx')
  assert.match(settings, /FinderSyncEnableButton/)
  assert.match(settings, /FINDER_SYNC_ENABLE_DESCRIPTION/)
  assert.match(onboarding, /FinderSyncEnableNote/)
  const pkg = JSON.parse(readRepo('package.json'))
  const titles = pkg.build.mac.extendInfo.NSServices.map((item) => item.NSMenuItem.default)
  assert.deepEqual(titles, ['Install', 'Install as…', 'Link to …'])
  assert.equal(pkg.build.afterSign, './scripts/verify-finder-sync-appex.mjs')
  const pack = readRepo('scripts/strip-mac-xattrs.mjs')
  assert.match(pack, /prepareFinderSyncAppex/)
  assert.match(pack, /signFinderSyncAppex/)
  assert.match(pack, /verifyFinderSyncAppex/)
  assert.match(pack, /compileFinderSyncReceiverAddon/)
  assert.match(pack, /installFinderSyncAgent/)
  const receiverBuild = compileFinderSyncReceiverAddon()
  const agentBuild = compileFinderSyncAgent()
  if (process.platform === 'darwin') {
    assert.equal(receiverBuild.skipped, false)
    assert.equal(agentBuild.skipped, false)
  } else {
    assert.equal(receiverBuild.ok, false)
    assert.equal(receiverBuild.skipped, true)
    assert.equal(agentBuild.ok, false)
    assert.equal(agentBuild.skipped, true)
  }
  const verifyHook = readRepo('scripts/verify-finder-sync-appex.mjs')
  assert.match(verifyHook, /export async function afterSign/)
  assert.match(verifyHook, /requireDeveloperId/)

  const prepared = prepareFinderSyncAppex()
  assert.equal(prepared.skipped, process.platform !== 'darwin')
  if (process.platform !== 'darwin') {
    assert.equal(prepared.ok, false)
    assert.match(prepared.reason, /macOS/)
  }
})

test('Finder Sync LaunchAgent plist is per flavour and the roundtrip check skips off macOS', () => {
  const releasePlist = finderSyncAgentLaunchAgentPlist(false)
  const testPlist = finderSyncAgentLaunchAgentPlist(true)
  assert.equal(finderSyncAgentMachServiceKeys(releasePlist).length, 1)
  assert.deepEqual(finderSyncAgentMachServiceKeys(releasePlist), [finderSyncMachService(false)])
  assert.deepEqual(finderSyncAgentMachServiceKeys(testPlist), [finderSyncMachService(true)])
  assert.equal(finderSyncAgentLabel(false), 'app.fontbutler.desktop.FinderSyncAgent')
  assert.equal(finderSyncAgentLabel(true), 'app.fontbutler.desktop.FinderSyncAgent.Test')
  assert.doesNotMatch(releasePlist, /FinderSync\.Test/)
  assert.match(releasePlist, /<key>RunAtLoad<\/key>\s*<false\/>/)
  assert.doesNotMatch(releasePlist, /KeepAlive/)
  assert.match(releasePlist, new RegExp(`<key>BundleProgram</key>\\s*<string>${finderSyncAgentBundleProgram()}</string>`))
  assert.notEqual(finderSyncAgentPlistName(false), finderSyncAgentPlistName(true))
  assert.notEqual(finderSyncSocketName(false), finderSyncSocketName(true))
  const signed = finderSyncAgentFailures({
    present: true,
    plist: releasePlist,
    infoPlist: `<key>CFBundleIdentifier</key><string>${finderSyncAgentLabel(false)}</string><key>LSBackgroundOnly</key><true/>`,
    executablePresent: true,
    programMatches: true,
    testFeed: false,
    codesignDisplay: `Identifier=${finderSyncAgentLabel(false)}\nAuthority=Developer ID Application: DANIEL QUISEK (A7WWML89LQ)\nTeamIdentifier=A7WWML89LQ\nflags=0x10000(runtime)`,
    codesignVerifyStatus: 0,
    entitlementText: `<string>${finderSyncAppGroup(false)}</string>`,
    requireDeveloperId: true,
  })
  assert.deepEqual(signed, [])
  const wrongFlavour = finderSyncAgentFailures({
    present: true,
    otherPresent: true,
    plist: testPlist,
    infoPlist: `<key>CFBundleIdentifier</key><string>${finderSyncAgentLabel(true)}</string><key>LSBackgroundOnly</key><true/>`,
    executablePresent: true,
    programMatches: true,
    testFeed: false,
    codesignDisplay: `Identifier=${finderSyncAgentLabel(false)}`,
    codesignVerifyStatus: 0,
    entitlementText: `<string>${finderSyncAppGroup(true)}</string>`,
    requireDeveloperId: false,
  })
  assert.ok(wrongFlavour.some((failure) => /other Finder Sync LaunchAgent/.test(failure)))
  const roundtrip = readRepo('scripts/finder-sync-roundtrip-check')
  assert.match(roundtrip, /--finder-sync-agent-status/)
  assert.match(roundtrip, /--sign', '-', '--identifier'/)
  assert.match(roundtrip, /ping ok/)
  assert.match(roundtrip, /submit ok/)
  assert.match(roundtrip, /FinderSync\.Wrong/)
  assert.match(roundtrip, /rejected: connection invalidated/)
  assert.match(roundtrip, /NSCocoaErrorDomain 4099/)
  assert.match(roundtrip, /process\.kill\(pid, 'SIGTERM'\)/)
  assert.match(roundtrip, /finderSyncSocketDirectoryName/)
  assert.match(roundtrip, /ad-hoc/)
  assert.doesNotMatch(finderSyncAgentEntitlementsPlist(false), /allow-jit/)
  assert.match(finderSyncAgentEntitlementsPlist(false), new RegExp(`<string>${finderSyncAppGroup(false)}</string>`))
  assert.doesNotMatch(finderSyncAgentEntitlementsPlist(true), new RegExp(`<string>${finderSyncAppGroup(false)}</string>`))
  assert.deepEqual(finderSyncClangArchArgs(3), [['-arch', 'arm64']])
  assert.deepEqual(finderSyncClangArchArgs('x64'), [['-arch', 'x86_64']])
  assert.deepEqual(finderSyncClangArchArgs('universal'), [['-arch', 'arm64'], ['-arch', 'x86_64']])
  const scriptPath = fileURLToPath(new URL('../scripts/finder-sync-roundtrip-check', import.meta.url))
  const ran = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' })
  if (process.platform !== 'darwin') {
    assert.equal(ran.status, 0)
    assert.match(ran.stdout, /skipped/)
  }
})

test('Finder Sync resolves /tmp and /var, caps the selection, and rechecks the open file', () => {
  const reads = []
  const trusted = validateFinderSyncSelection(
    ['/tmp/A.otf', '/var/B.ttf', '/tmp/elsewhere.otf', '/Fonts/link.otf'],
    {
      lstatSync(filePath) {
        const nodes = {
          '/tmp': fontStat('symlink'),
          '/private': fontStat('dir'),
          '/private/tmp': fontStat('dir'),
          '/private/tmp/A.otf': { ...fontStat('file'), header: OTTO, dev: 1, ino: 2, size: 8 },
          '/private/tmp/elsewhere.otf': fontStat('symlink'),
          '/var': fontStat('symlink'),
          '/private/var': fontStat('dir'),
          '/private/var/B.ttf': { ...fontStat('file'), header: TTF, dev: 1, ino: 3, size: 8 },
          '/Fonts': fontStat('dir'),
          '/Fonts/link.otf': fontStat('symlink'),
        }
        if (!nodes[filePath]) {
          const error = new Error('missing')
          error.code = 'ENOENT'
          throw error
        }
        return nodes[filePath]
      },
      readlinkSync(filePath) {
        if (filePath === '/tmp') return 'private/tmp'
        if (filePath === '/var') return 'private/var'
        if (filePath === '/tmp/elsewhere.otf') return '/etc/passwd'
        return 'nope'
      },
      readPrefix(filePath) {
        reads.push(filePath)
        if (filePath === '/private/tmp/A.otf') return OTTO
        if (filePath === '/private/var/B.ttf') return TTF
        throw new Error('unreadable')
      },
    },
  )
  assert.deepEqual(trusted.paths, ['/private/tmp/A.otf', '/private/var/B.ttf'])
  assert.equal(trusted.limitError, null)
  const reasons = Object.fromEntries(trusted.rejected.map((item) => [item.path, item.reason]))
  assert.match(reasons['/tmp/elsewhere.otf'], /Symlink/)
  assert.match(reasons['/Fonts/link.otf'], /Symlink/)

  const tooMany = validateFinderSyncSelection(
    Array.from({ length: FINDER_SYNC_MAX_FILES + 1 }, (_, index) => `/Fonts/${index}.otf`),
    ioFor({}),
  )
  assert.equal(tooMany.limitError, FINDER_SYNC_TOO_MANY_FILES)
  assert.deepEqual(tooMany.paths, [])

  const huge = validateFinderSyncSelection(['/Fonts/Huge.otf'], {
    lstatSync: () => ({ ...fontStat('file'), size: FINDER_SYNC_MAX_BYTES + 1 }),
    readPrefix: () => OTTO,
  })
  assert.equal(huge.limitError, FINDER_SYNC_TOO_LARGE)
  assert.deepEqual(huge.paths, [])

  const names = Array.from({ length: 3 }, (_, index) => `${index}.otf`)
  const folder = validateFinderSyncSelection(['/Fonts/Family'], {
    lstatSync(filePath) {
      if (filePath === '/Fonts' || filePath === '/Fonts/Family') return fontStat('dir')
      return { ...fontStat('file'), size: 10 }
    },
    readdirSync(filePath) {
      if (filePath === '/Fonts/Family') return names
      return []
    },
  })
  assert.deepEqual(folder.paths, ['/Fonts/Family'])
  assert.equal(folder.limitError, null)

  let currentIno = 7
  const handles = []
  const raced = validateFinderSyncSelection(['/Fonts/A.otf'], {
    lstatSync: () => fontStat('file'),
    openSync() {
      return 4
    },
    closeSync() {},
    fstatSync: () => ({ ...fontStat('file'), dev: 1, ino: currentIno, size: 4 }),
    readAt: () => OTTO,
  })
  assert.equal(raced.handles[0].ino, 7)
  handles.push(raced.handles[0])
  currentIno = 8
  const changed = revalidateFinderSyncHandles(handles, {
    fstatSync(fd) {
      return { ...fontStat('file'), dev: 1, ino: fd === 4 ? 7 : currentIno, size: 4 }
    },
    openSync() {
      return 5
    },
    closeSync() {},
    readAt: () => OTTO,
  })
  assert.equal(changed.ok, false)
  assert.equal(changed.reason, FINDER_SYNC_CHANGED_BEFORE_INSTALL)
  raced.close()
})

test('a stale socket is replaced only when this user owns it, then another bind works', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'font-butler-socket-'))
  const servers = []
  try {
    const sock = path.join(dir, 'fontbutler-finder-sync.sock')
    const server = net.createServer()
    servers.push(server)
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(sock, resolve)
    })
    const replaced = prepareFinderSyncSocket(sock, {
      lstatSync,
      unlinkSync,
      getuid: () => lstatSync(sock).uid,
    })
    assert.equal(replaced.ok, true)
    assert.equal(replaced.unlinked, true)
    assert.equal(replaced.reason, 'replaced')
    assert.throws(() => lstatSync(sock))
    const next = net.createServer()
    servers.push(next)
    await new Promise((resolve, reject) => {
      next.once('error', reject)
      next.listen(sock, resolve)
    })

    const file = path.join(dir, 'not-a-socket')
    writeFileSync(file, 'keep')
    const kept = prepareFinderSyncSocket(file, {
      lstatSync,
      unlinkSync,
      getuid: () => lstatSync(file).uid,
    })
    assert.equal(kept.unlinked, false)
    assert.equal(kept.reason, 'not-owned-socket')
    assert.equal(readFileSync(file, 'utf8'), 'keep')

    const link = path.join(dir, 'link.sock')
    symlinkSync(file, link)
    const linked = prepareFinderSyncSocket(link, {
      lstatSync,
      unlinkSync,
      getuid: () => lstatSync(file).uid,
    })
    assert.equal(linked.reason, 'symlink')
    assert.equal(linked.unlinked, false)
    assert.equal(lstatSync(link).isSymbolicLink(), true)

    let unlinked = false
    const foreign = prepareFinderSyncSocket(sock, {
      lstatSync: () => ({ isSymbolicLink: () => false, isSocket: () => true, uid: 1 }),
      unlinkSync: () => {
        unlinked = true
      },
      getuid: () => 2,
    })
    assert.equal(foreign.reason, 'not-owned-socket')
    assert.equal(unlinked, false)
  } finally {
    for (const server of servers) server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a second launch from the same bundle path does not register again', () => {
  const bundle = '/Applications/Font Buttler.app'
  const helper = `${bundle}/${finderSyncAgentBundleProgram()}`
  const calls = []
  let record = readFinderSyncAgentRecord('')
  const launch = (status) => {
    const committed = commitFinderSyncAgentRegistration({
      testFeed: false,
      currentBundle: bundle,
      helperPath: helper,
      version: '0.3.12',
      record,
      status,
      unregister() {
        calls.push('unregister')
      },
      register() {
        calls.push('register')
        return 'enabled'
      },
    })
    record = committed.record
    return committed
  }
  const first = launch('not-registered')
  assert.deepEqual(calls, ['register'])
  assert.equal(first.saved, true)
  assert.equal(record.appBundlePath, bundle)
  assert.equal(record.helperPath, helper)
  assert.equal(record.version, '0.3.12')
  assert.equal(record.enabled, true)
  calls.length = 0
  const second = launch('enabled')
  assert.deepEqual(calls, [])
  assert.equal(second.plan.action, 'keep')
  const approved = launch('requires-approval')
  assert.deepEqual(calls, [])
  assert.equal(approved.plan.action, 'keep')

  calls.length = 0
  const movedBundle = '/Applications/Font Buttler Moved.app'
  const moved = commitFinderSyncAgentRegistration({
    testFeed: false,
    currentBundle: movedBundle,
    helperPath: `${movedBundle}/${finderSyncAgentBundleProgram()}`,
    version: '0.3.12',
    record,
    status: 'enabled',
    unregister() {
      calls.push('unregister')
    },
    register() {
      calls.push('register')
      return 'requires-approval'
    },
  })
  assert.deepEqual(calls, ['unregister', 'register'])
  assert.equal(moved.plan.action, 'reregister')
  assert.equal(moved.plan.reason, 'moved')
  assert.equal(moved.plan.label, finderSyncAgentLabel(false))
  assert.equal(moved.plan.plist, finderSyncAgentPlistName(false))
  assert.equal(moved.record.appBundlePath, movedBundle)

  const optedOut = planFinderSyncAgentRegistration({
    testFeed: true,
    currentBundle: '/Applications/Font Buttler Test.app',
    recordedBundle: '',
    status: 'enabled',
    optedOut: true,
  })
  assert.equal(optedOut.action, 'unregister')
  assert.equal(optedOut.label, finderSyncAgentLabel(true))
  assert.equal(optedOut.plist, finderSyncAgentPlistName(true))
  assert.notEqual(optedOut.label, finderSyncAgentLabel(false))
  assert.notEqual(optedOut.plist, finderSyncAgentPlistName(false))

  const legacy = readFinderSyncAgentRecord('{"enabled":true,"program":"/Applications/Font Buttler.app/old-helper"}')
  assert.equal(legacy.appBundlePath, '')
  assert.equal(legacy.enabled, true)

  const seen = new Map()
  assert.equal(finderSyncRequestSeen(seen, 'click-1', 1_000), false)
  assert.equal(seen.has('click-1'), false)
  noteFinderSyncRequest(seen, 'click-1', 1_000)
  assert.equal(finderSyncRequestSeen(seen, 'click-1', 1_000 + 60_000), true)
  assert.equal(finderSyncRequestSeen(seen, 'click-1', 1_000 + 3 * 60_000), false)
  assert.equal(seen.has('click-1'), false)
  assert.equal(finderSyncRequestSeen(seen, '', 2_000), false)
  for (let index = 0; index < FINDER_SYNC_REQUEST_CAP; index += 1) {
    noteFinderSyncRequest(seen, `id-${index}`, 10_000 + index)
  }
  assert.equal(seen.size, FINDER_SYNC_REQUEST_CAP)
  noteFinderSyncRequest(seen, 'id-new', 20_000)
  assert.equal(seen.size, FINDER_SYNC_REQUEST_CAP)
  assert.equal(seen.has('id-0'), false)
  assert.equal(seen.has('id-new'), true)
  const before = seen.size
  assert.equal(finderSyncRequestSeen(seen, 'fresh', 20_000), false)
  assert.equal(seen.size, before)
})

test('Finder Sync errors use the app notification permission and a dialog when it is denied', () => {
  const message = FINDER_SYNC_MISSING_APP
  const granted = routeFinderSyncError({
    message,
    notificationsEnabled: true,
    permission: 'granted',
    alreadyShown: new Set(),
  })
  assert.equal(granted.shown, true)
  assert.equal(granted.channel, 'notification')
  assert.equal(granted.message, message)

  const denied = routeFinderSyncError({
    message,
    notificationsEnabled: true,
    permission: 'denied',
    alreadyShown: new Set(),
  })
  assert.equal(denied.shown, true)
  assert.equal(denied.channel, 'dialog')
  assert.equal(denied.message, message)

  const off = routeFinderSyncError({
    message: `  ${FINDER_SYNC_AGENT_DISABLED}  `,
    notificationsEnabled: false,
    permission: 'granted',
    alreadyShown: new Set(),
  })
  assert.equal(off.shown, true)
  assert.equal(off.channel, 'dialog')
  assert.equal(off.message, FINDER_SYNC_AGENT_DISABLED)

  const duplicate = routeFinderSyncError({
    message,
    notificationsEnabled: true,
    permission: 'granted',
    alreadyShown: new Set([message]),
  })
  assert.equal(duplicate.shown, false)
  assert.equal(duplicate.channel, 'duplicate')

  const empty = routeFinderSyncError({
    message: '   ',
    notificationsEnabled: true,
    permission: 'granted',
  })
  assert.equal(empty.shown, false)
  assert.equal(empty.channel, 'none')

  assert.equal(FINDER_SYNC_PENDING_ERROR_FILE, 'finder-sync-pending-error.json')
  const first = addFinderSyncPendingError('', message, 1_000)
  assert.equal(first.added, true)
  const again = addFinderSyncPendingError(first.text, message, 2_000)
  assert.equal(again.added, false)
  assert.equal(again.text, first.text)
  const pending = readFinderSyncPendingErrors(again.text)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].message, message)
  assert.equal(pending[0].at, 1_000)
  const secondMessage = addFinderSyncPendingError(again.text, FINDER_SYNC_AGENT_DISABLED, 3_000)
  assert.equal(secondMessage.added, true)
  const both = readFinderSyncPendingErrors(secondMessage.text)
  assert.deepEqual(
    both.map((item) => item.message),
    [message, FINDER_SYNC_AGENT_DISABLED],
  )
  const repeatedFile = JSON.stringify({
    errors: [
      { message, at: 1 },
      { message, at: 2 },
      { message: '  ', at: 3 },
    ],
  })
  assert.equal(readFinderSyncPendingErrors(repeatedFile).length, 1)
})

test('universal slices are compiled outside the bundle and stray Mach-O is reported', () => {
  const bundle = mkdtempSync(path.join(tmpdir(), 'font-butler-bundle-'))
  const out = path.join(bundle, 'Contents', 'MacOS', 'FontButtlerFinderSyncAgent')
  mkdirSync(path.dirname(out), { recursive: true })
  const agentBuild = readRepo('scripts/build-finder-sync-agent.mjs')
  const receiverBuild = readRepo('scripts/build-finder-sync-receiver.mjs')
  assert.doesNotMatch(agentBuild, /\$\{out\}\.slice/)
  assert.doesNotMatch(receiverBuild, /\$\{out\}\.slice/)
  assert.match(agentBuild, /strayMachOFiles/)
  assert.match(receiverBuild, /strayMachOFiles/)
  let scratch = ''
  try {
    const removed = []
    const clangOuts = []
    const compiled = compileMachOSlices({
      out,
      arch: 'universal',
      clang: 'clang++',
      argsFor: (sliceOut, archArgs) => ['-o', sliceOut, ...archArgs],
      spawnSync(command, args) {
        if (command === 'clang++') {
          const sliceOut = args[args.indexOf('-o') + 1]
          clangOuts.push(sliceOut)
          writeFileSync(sliceOut, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]))
        }
        if (command === 'lipo') {
          const dest = args[args.indexOf('-output') + 1]
          writeFileSync(dest, Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0]))
        }
        return { status: 0, stdout: '', stderr: '' }
      },
      rmSync(target, options) {
        removed.push(target)
        rmSync(target, options)
      },
      mkdtempSync(prefix) {
        scratch = mkdtempSync(prefix)
        return scratch
      },
    })
    assert.equal(compiled.ok, true)
    assert.equal(clangOuts.length, 2)
    for (const sliceOut of clangOuts) {
      assert.equal(sliceOut.startsWith(bundle), false)
      assert.equal(existsSync(sliceOut), false)
    }
    assert.equal(removed.length, 1)
    assert.equal(existsSync(scratch), false)
    assert.deepEqual(strayMachOFiles(bundle, { allow: [out] }), [])
    writeFileSync(`${out}.slice0`, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))
    const stray = strayMachOFiles(bundle, { allow: [out] })
    assert.equal(stray.length, 1)
    assert.match(stray[0], /\.slice0$/)
    unlinkSync(`${out}.slice0`)
    writeFileSync(path.join(bundle, 'Contents', 'MacOS', 'extra'), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]))
    const extra = strayMachOFiles(bundle, { allow: [out] })
    assert.equal(extra.length, 1)
    assert.match(extra[0], /extra$/)

    const failed = compileMachOSlices({
      out,
      arch: 'universal',
      clang: 'clang++',
      argsFor: (sliceOut) => ['-o', sliceOut],
      spawnSync(command) {
        if (command === 'clang++') return { status: 0, stdout: '', stderr: '' }
        return { status: 1, stdout: '', stderr: 'lipo failed' }
      },
      mkdtempSync(prefix) {
        scratch = mkdtempSync(prefix)
        return scratch
      },
    })
    assert.equal(failed.ok, false)
    assert.match(failed.reason, /lipo failed/)
    assert.equal(existsSync(scratch), false)
  } finally {
    rmSync(bundle, { recursive: true, force: true })
  }
})

test('a folder nested more than 10 levels is refused, and file names keep their spaces', () => {
  const names = new Map([['/Fonts/Deep', []]])
  let cursor = '/Fonts/Deep'
  for (let level = 0; level < 12; level += 1) {
    const child = `${cursor}/d${level}`
    names.set(cursor, [`d${level}`])
    names.set(child, [])
    cursor = child
  }
  const deep = validateFinderSyncSelection(['/Fonts/Deep'], {
    lstatSync(filePath) {
      if (filePath === '/Fonts' || filePath === '/Fonts/Deep' || names.has(filePath)) return fontStat('dir')
      const error = new Error('missing')
      error.code = 'ENOENT'
      throw error
    },
    readdirSync(filePath) {
      return names.get(filePath) ?? []
    },
    openSync() {
      return 7
    },
    closeSync() {},
    fstatSync() {
      return fontStat('dir')
    },
  })
  assert.equal(deep.limitError, null)
  assert.equal(deep.paths.length, 0)
  assert.equal(deep.rejected[0]?.reason, FINDER_SYNC_TREE_TOO_DEEP)

  const spaced = validateFinderSyncSelection(['/Fonts/A.otf '], {
    lstatSync() {
      const error = new Error('missing')
      error.code = 'ENOENT'
      throw error
    },
  })
  assert.equal(spaced.rejected[0]?.path, '/Fonts/A.otf ')
})

test('the native XPC rejection probe runs on macOS and is skipped elsewhere', () => {
  const result = runFinderSyncXpcRejectionTest()
  if (process.platform === 'darwin') {
    assert.equal(result.skipped, false)
    assert.equal(result.ok, true, result.reason)
  } else {
    assert.equal(result.ok, false)
    assert.equal(result.skipped, true)
  }
})

test('the release assert checks the stapled appex with a deep verify and spctl', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'font-butler-appex-spctl-'))
  try {
    const app = path.join(root, 'Font Buttler.app')
    mkdirSync(path.join(app, 'Contents', 'Resources', 'app'), { recursive: true })
    writeFileSync(path.join(app, 'Contents', 'Resources', 'app', 'package.json'), JSON.stringify({ name: 'font-butler' }))
    const appex = finderSyncAppexPath(app)
    mkdirSync(path.join(appex, 'Contents'), { recursive: true })
    writeFileSync(
      path.join(appex, 'Contents', 'Info.plist'),
      finderSyncInfoPlist({ bundleId: FINDER_SYNC_BUNDLE_ID, version: '0.3.10' }),
    )
    const calls = []
    const group = finderSyncAppGroup(false)
    const failures = finderSyncReleaseFailures(app, {
      runCommand(command, args) {
        calls.push([command, args])
        if (command === 'spctl') return { status: 0, output: 'source=Notarized Developer ID' }
        if (command === 'codesign' && args.includes('--entitlements')) {
          return {
            status: 0,
            output: `<key>${FINDER_SYNC_ENTITLEMENT}</key><key>${FINDER_SYNC_APP_GROUP_ENTITLEMENT}</key><string>${group}</string>`,
          }
        }
        return {
          status: 0,
          output: `Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}\nTeamIdentifier=${DEVELOPER_ID_TEAM}\nflags=0x10000(runtime)`,
        }
      },
    })
    assert.deepEqual(failures, [], failures.join('\n'))
    assert.ok(calls.some((call) => call[0] === 'codesign' && call[1].includes('--deep') && call[1].includes('--strict')))
    assert.ok(calls.some((call) => call[0] === 'spctl' && call[1].includes(appex)))

    const rejected = finderSyncReleaseFailures(app, {
      runCommand(command, args) {
        if (command === 'spctl') return { status: 1, output: 'rejected' }
        if (command === 'codesign' && args.includes('--verify')) return { status: 1, output: '' }
        if (command === 'codesign' && args.includes('--entitlements')) {
          return {
            status: 0,
            output: `<key>${FINDER_SYNC_ENTITLEMENT}</key><key>${FINDER_SYNC_APP_GROUP_ENTITLEMENT}</key><string>${finderSyncAppGroup(true)}</string>`,
          }
        }
        return {
          status: 0,
          output: `Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}\nTeamIdentifier=${DEVELOPER_ID_TEAM}\nflags=0x10000(runtime)`,
        }
      },
    })
    assert.ok(rejected.some((failure) => /--deep --strict/.test(failure)))
    assert.ok(rejected.some((failure) => /Notarized Developer ID/.test(failure)))
    assert.ok(rejected.some((failure) => failure.includes(group)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

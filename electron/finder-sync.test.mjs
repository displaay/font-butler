import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DEVELOPER_ID_TEAM } from './app-update-install.mjs'
import {
  FINDER_INSTALL,
  FINDER_INSTALL_AS,
  FINDER_LINK_TO,
  FINDER_PROTOCOL,
  FINDER_TEST_PROTOCOL,
  finderInstallUrl,
} from './finder-install.mjs'
import {
  FINDER_SYNC_BUNDLE_ID,
  FINDER_SYNC_ENTITLEMENT,
  FINDER_SYNC_EXECUTABLE,
  FINDER_SYNC_EXTENSION_POINT,
  FINDER_SYNC_PRINCIPAL_CLASS,
  FINDER_SYNC_SETTINGS_URL,
  FINDER_SYNC_TEST_BUNDLE_ID,
  finderSyncAppexBundlePath,
  finderSyncBundleId,
  finderSyncMenuTitle,
  finderSyncMonitorDirectories,
  finderSyncProtocol,
  fontMagicKind,
  formatFinderSyncRejections,
  isSafeFinderSyncPath,
  parseFinderSyncChannel,
  parsePluginkitFinderSync,
  planFinderSyncRegistration,
  refreshFinderSyncRegistration,
  validateFinderSyncSelection,
} from './finder-sync.mjs'
import { finderSyncReleaseFailures } from '../scripts/assert-notarized-mac-release.mjs'
import {
  entitlementKeysFromCodesign,
  finderSyncAppexFailures,
  finderSyncAppexPath,
  finderSyncCodesignIdentity,
  finderSyncCompileArgs,
  finderSyncInfoPlist,
  finderSyncSignArgs,
  macosSwiftTarget,
  plistString,
  prepareFinderSyncAppex,
  signFinderSyncAppex,
  verifyFinderSyncAppex,
} from '../scripts/build-finder-sync.mjs'
import { DEVELOPER_ID_IDENTITY } from '../scripts/mac-signing.mjs'

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

test('parseFinderSyncChannel keeps install and install-as paths and drops other actions', () => {
  const install = finderInstallUrl(FINDER_INSTALL, ['/Fonts/A.otf', '/Fonts/B.ttf'])
  assert.deepEqual(parseFinderSyncChannel(install), {
    action: FINDER_INSTALL,
    paths: ['/Fonts/A.otf', '/Fonts/B.ttf'],
  })
  const installAs = finderInstallUrl(FINDER_INSTALL_AS, ['/Fonts/Display.otf'])
  assert.deepEqual(parseFinderSyncChannel(installAs), {
    action: FINDER_INSTALL_AS,
    paths: ['/Fonts/Display.otf'],
  })
  assert.equal(parseFinderSyncChannel(finderInstallUrl(FINDER_LINK_TO, ['/Fonts/A.woff'])), null)
  assert.equal(parseFinderSyncChannel('https://example.test/finder/install?p=/Fonts/A.otf'), null)
  const testUrl = finderInstallUrl(FINDER_INSTALL, ['/Fonts/A.otf', '/Fonts/Family'], FINDER_TEST_PROTOCOL)
  assert.equal(parseFinderSyncChannel(testUrl), null)
  assert.deepEqual(parseFinderSyncChannel(testUrl, { testFeed: true }), {
    action: FINDER_INSTALL,
    paths: ['/Fonts/A.otf', '/Fonts/Family'],
  })
  assert.equal(parseFinderSyncChannel(install, { testFeed: true }), null)
  assert.equal(finderSyncProtocol(false), FINDER_PROTOCOL)
  assert.equal(finderSyncProtocol(true), FINDER_TEST_PROTOCOL)
  assert.equal(finderSyncMenuTitle(FINDER_INSTALL, false), 'Install')
  assert.equal(finderSyncMenuTitle(FINDER_INSTALL_AS, true), 'Install as… (Test)')
  assert.equal(parseFinderSyncChannel(''), null)
  const parsed = parseFinderSyncChannel(
    'font-butler://finder/install?p=%2FFonts%2FA.otf&p=%2FFonts%2FB.otf&extra=1',
  )
  assert.deepEqual(parsed, { action: FINDER_INSTALL, paths: ['/Fonts/A.otf', '/Fonts/B.otf'] })
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
  assert.deepEqual(validateFinderSyncSelection([], ioFor({})), { paths: [], rejected: [] })

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
  assert.equal(plistString(plist, 'FontButtlerURLScheme'), FINDER_TEST_PROTOCOL)
  assert.equal(plistString(plist, 'FontButtlerInstallTitle'), 'Install (Test)')
  assert.equal(plistString(plist, 'FontButtlerInstallAsTitle'), 'Install as… (Test)')
  const releasePlist = finderSyncInfoPlist({ bundleId: FINDER_SYNC_BUNDLE_ID, version: '0.3.10' })
  assert.equal(plistString(releasePlist, 'FontButtlerURLScheme'), FINDER_PROTOCOL)
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
  assert.deepEqual(entitlementKeysFromCodesign(entitlements), [FINDER_SYNC_ENTITLEMENT])
  assert.doesNotMatch(entitlements, /allow-jit|get-task-allow|disable-library-validation/)
})

test('Finder Sync monitors cloud roots and leaves a disabled or current extension alone', () => {
  const home = '/Users/ada'
  const directories = finderSyncMonitorDirectories({
    home,
    cloudChildren: ['Dropbox', '../Secret', 'OneDrive'],
    exists: (directory) => directory !== `${home}/Library/Mobile Documents/com~apple~CloudDocs`,
  })
  assert.deepEqual(directories, [
    '/',
    home,
    `${home}/Library/CloudStorage`,
    `${home}/Library/Mobile Documents`,
    `${home}/Library/CloudStorage/Dropbox`,
    `${home}/Library/CloudStorage/OneDrive`,
  ])
  assert.equal(directories.some((directory) => directory.includes('..')), false)
  assert.deepEqual(finderSyncMonitorDirectories({ home: 'relative' }), ['/'])

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

  const display = `Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}\nTeamIdentifier=${DEVELOPER_ID_TEAM}`
  assert.deepEqual(
    finderSyncAppexFailures({
      present: true,
      bundleId: FINDER_SYNC_BUNDLE_ID,
      expectedBundleId: FINDER_SYNC_BUNDLE_ID,
      principalClass: FINDER_SYNC_PRINCIPAL_CLASS,
      extensionPoint: FINDER_SYNC_EXTENSION_POINT,
      codesignVerifyStatus: 0,
      codesignDisplay: display,
      entitlementKeys: [FINDER_SYNC_ENTITLEMENT],
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
    entitlementKeys: [FINDER_SYNC_ENTITLEMENT],
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
    entitlementKeys: [FINDER_SYNC_ENTITLEMENT],
    requireDeveloperId: true,
  })
  assert.ok(adHoc.some((failure) => /ad-hoc/.test(failure)))
  assert.ok(adHoc.some((failure) => /team ID/.test(failure)))
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
  assert.ok(loose.some((failure) => /sandbox only/.test(failure)))
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
    readFileSync: () => finderSyncInfoPlist({ bundleId: FINDER_SYNC_TEST_BUNDLE_ID, version: '0.9.0' }),
    spawnSync(command, args) {
      if (args.includes('--verify')) return { status: 0, stdout: '', stderr: '' }
      if (args.includes('--entitlements')) {
        return { status: 0, stdout: `<key>${FINDER_SYNC_ENTITLEMENT}</key><true/>`, stderr: '' }
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
  assert.match(assertScript, /prefixFailures\('DMG'/)
  assert.match(assertScript, /prefixFailures\('Update zip'/)
  assert.match(assertScript, /prefixFailures\('App'/)
})

test('Finder Sync sources only hand off font selections and the pack builds the appex', () => {
  const swift = readRepo('macos/FinderSync/FinderSync.swift')
  assert.match(swift, /fileURLWithPath: "\/"/)
  assert.match(swift, /Library\/CloudStorage/)
  assert.match(swift, /Library\/Mobile Documents/)
  assert.match(swift, /com~apple~CloudDocs/)
  assert.match(swift, /contextualMenuForItems/)
  assert.match(swift, /selectedItemURLs/)
  assert.match(swift, /allSatisfy\(isInstallSelection\)/)
  assert.match(swift, /hasDirectoryPath/)
  assert.match(swift, /"Install"/)
  assert.match(swift, /Install as…/)
  assert.match(swift, /FontButtlerInstallTitle/)
  assert.match(swift, /FontButtlerURLScheme/)
  assert.match(swift, /font-butler/)
  assert.match(swift, /withApplicationAt/)
  assert.match(swift, /parentAppURL/)
  assert.doesNotMatch(swift, /\/Applications\/Font Buttler\.app/)
  assert.doesNotMatch(swift, /CTFontManager|copyItem|removeItem|trashItem|NSAppleScript|\/api\/install/)
  assert.match(swift, /FileManager\.default\.homeDirectoryForCurrentUser/)
  assert.match(swift, /contentsOfDirectory/)

  const main = readRepo('electron/main.mjs')
  assert.match(main, /enqueueValidatedFinderInstall/)
  assert.match(main, /validateFinderSyncSelection/)
  assert.match(main, /O_NOFOLLOW/)
  assert.match(main, /finderSyncProtocol/)
  assert.match(main, /removeAsDefaultProtocolClient/)
  assert.match(main, /refreshFinderSyncRegistration/)
  assert.match(main, /finderLaunchForThisApp/)
  assert.match(main, /enqueueFinderJob\(action, checked\.paths\)/)
  assert.match(main, /open-finder-extensions/)
  assert.match(main, /FINDER_SYNC_SETTINGS_URL/)
  assert.equal(
    FINDER_SYNC_SETTINGS_URL,
    'x-apple.systempreferences:com.apple.LoginItems-Settings.extension',
  )
  assert.match(main, /enqueueFinderHandoff\(finder, \{ strict: true \}\)/)
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

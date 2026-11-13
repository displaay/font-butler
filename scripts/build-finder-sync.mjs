import { spawnSync as nodeSpawnSync } from 'node:child_process'
import { existsSync as nodeExistsSync, mkdirSync, mkdtempSync, readFileSync as nodeReadFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FINDER_SYNC_APP_GROUP_ENTITLEMENT,
  FINDER_SYNC_ENTITLEMENT,
  FINDER_SYNC_EXECUTABLE,
  FINDER_SYNC_EXTENSION_POINT,
  FINDER_SYNC_PRINCIPAL_CLASS,
  finderSyncAppGroup,
  finderSyncAppexBundlePath,
  finderSyncBundleId,
  finderSyncMachService,
  finderSyncMenuTitle,
} from '../electron/finder-sync.mjs'
import { DEVELOPER_ID_TEAM } from '../electron/app-update-install.mjs'
import { DEVELOPER_ID_IDENTITY, testFeedBuildRequested } from './mac-signing.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(repoRoot, 'macos/FinderSync/FinderSync.swift')

export const FINDER_SYNC_ENTITLEMENTS = 'build/entitlements.finder-sync.plist'

export function finderSyncAppexPath(appBundle) {
  return finderSyncAppexBundlePath(appBundle)
}

export function macosSwiftTarget(arch) {
  const name = typeof arch === 'number' ? ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][arch] : arch
  if (name === 'universal') return null
  if (name === 'x64' || name === 'x86_64' || name === 'ia32') return 'x86_64-apple-macosx11.0'
  return 'arm64-apple-macosx11.0'
}

export function finderSyncCodesignIdentity(identity) {
  if (identity == null || identity === '') return null
  const value = String(identity).trim()
  if (!value) return null
  if (value === '-') return '-'
  if (value.includes('Developer ID Application:')) return value
  return `Developer ID Application: ${value}`
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function finderSyncInfoPlist({
  bundleId,
  version,
  executable = FINDER_SYNC_EXECUTABLE,
  testFeed = false,
}) {
  const installTitle = finderSyncMenuTitle('install', testFeed)
  const installAsTitle = finderSyncMenuTitle('install-as', testFeed)
  const compareTitle = finderSyncMenuTitle('compare', testFeed)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>Font Buttler</string>
    <key>CFBundleExecutable</key>
    <string>${xmlEscape(executable)}</string>
    <key>CFBundleIdentifier</key>
    <string>${xmlEscape(bundleId)}</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Font Buttler Finder Sync</string>
    <key>CFBundlePackageType</key>
    <string>XPC!</string>
    <key>CFBundleShortVersionString</key>
    <string>${xmlEscape(version)}</string>
    <key>CFBundleSupportedPlatforms</key>
    <array>
      <string>MacOSX</string>
    </array>
    <key>CFBundleVersion</key>
    <string>${xmlEscape(version)}</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>FontButtlerInstallTitle</key>
    <string>${xmlEscape(installTitle)}</string>
    <key>FontButtlerInstallAsTitle</key>
    <string>${xmlEscape(installAsTitle)}</string>
    <key>FontButtlerCompareTitle</key>
    <string>${xmlEscape(compareTitle)}</string>
    <key>FontButtlerMachService</key>
    <string>${xmlEscape(finderSyncMachService(testFeed))}</string>
    <key>NSExtension</key>
    <dict>
      <key>NSExtensionPointIdentifier</key>
      <string>${FINDER_SYNC_EXTENSION_POINT}</string>
      <key>NSExtensionPrincipalClass</key>
      <string>${FINDER_SYNC_PRINCIPAL_CLASS}</string>
    </dict>
  </dict>
</plist>
`
}

export function plistString(xml, key) {
  const match = String(xml ?? '').match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))
  return match?.[1] ?? ''
}

export function entitlementKeysFromCodesign(output) {
  const keys = []
  const re = /<key>([^<]+)<\/key>/g
  for (const match of String(output ?? '').matchAll(re)) keys.push(match[1])
  return keys
}

/**
 * Frontend and link flags for the Finder Sync appex.
 *
 * `-parse-as-library` is required. A single file passed to swiftc is
 * otherwise a top-level script: file-level lets such as `fontExtensions`
 * are initialised only when that script's main runs. The process entry
 * is `_NSExtensionMain`, so main never runs and the first contextual menu
 * crashes in `Set.contains`. Library mode initialises those lets on first
 * use. FinderSync.swift has no top-level statements, so nothing depended
 * on that script main. The other native targets are Objective-C++ via
 * clang++, not swiftc.
 */
export function finderSyncCompileArgs({ sdk, target, source, output }) {
  return [
    '-sdk',
    sdk,
    '-target',
    target,
    '-parse-as-library',
    '-O',
    '-framework',
    'Cocoa',
    '-framework',
    'FinderSync',
    '-application-extension',
    '-module-name',
    'FontButtlerFinderSyncModule',
    '-Xlinker',
    '-e',
    '-Xlinker',
    '_NSExtensionMain',
    source,
    '-o',
    output,
  ]
}

const TOP_LEVEL_ATTRIBUTE = String.raw`@[A-Za-z_][A-Za-z0-9_]*(?:\([^)\n]*\))?`
const TOP_LEVEL_MODIFIERS = String.raw`(?:private|fileprivate|internal|public|open|final|static|override|mutating|nonmutating|nonisolated|indirect|unowned|weak|lazy|required|convenience|dynamic|distributed)\s+`
const TOP_LEVEL_KEYWORD = String.raw`import|let|var|func|class|struct|enum|protocol|typealias|extension|actor|associatedtype`
const TOP_LEVEL_DECLARATION = new RegExp(
  `^(?:${TOP_LEVEL_ATTRIBUTE}\\s+)*(?:${TOP_LEVEL_MODIFIERS})*(?:${TOP_LEVEL_KEYWORD})\\b`,
)
const TOP_LEVEL_ATTRIBUTE_ONLY = new RegExp(`^(?:${TOP_LEVEL_ATTRIBUTE}\\s*)+$`)
const TOP_LEVEL_DIRECTIVE = /^#(?:if|else|elseif|endif|sourceLocation|available|warning|error)\b/
const TOP_LEVEL_STORED = new RegExp(
  `^(?:${TOP_LEVEL_ATTRIBUTE}\\s+)*(?:(?:private|fileprivate|internal|public|open|static|lazy|unowned|weak)\\s+)*(?:let|var)\\s+([A-Za-z_][A-Za-z0-9_]*)`,
)

function consumeSwiftString(text, start) {
  if (text.startsWith('"""', start)) {
    const end = text.indexOf('"""', start + 3)
    return end === -1 ? text.length : end + 3
  }
  let index = start + 1
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2
      continue
    }
    if (text[index] === '"') return index + 1
    index += 1
  }
  return text.length
}

/**
 * File-level stored lets and any top-level statements in a Swift file.
 * Statements would not run under `_NSExtensionMain`, and they do not
 * compile with `-parse-as-library`. Angle brackets are tracked only outside
 * braces, so a range such as `0..<12` inside a function does not swallow
 * the next file-level let.
 */
export function finderSyncTopLevelShape(source) {
  const text = String(source ?? '')
  const chunks = []
  let chunk = ''
  let brace = 0
  let paren = 0
  let bracket = 0
  let angle = 0
  let index = 0
  const flush = () => {
    const trimmed = chunk.trim()
    chunk = ''
    if (trimmed) chunks.push(trimmed)
  }
  while (index < text.length) {
    if (text.startsWith('//', index)) {
      if (brace === 0 && paren === 0 && bracket === 0 && angle === 0) flush()
      const end = text.indexOf('\n', index)
      index = end === -1 ? text.length : end + 1
      continue
    }
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
      continue
    }
    if (text[index] === '"') {
      const next = consumeSwiftString(text, index)
      chunk += text.slice(index, next)
      index = next
      continue
    }
    const ch = text[index]
    if (ch === '{') brace += 1
    else if (ch === '}') brace = Math.max(0, brace - 1)
    else if (ch === '(') paren += 1
    else if (ch === ')') paren = Math.max(0, paren - 1)
    else if (ch === '[') bracket += 1
    else if (ch === ']') bracket = Math.max(0, bracket - 1)
    else if (brace === 0 && ch === '<') angle += 1
    else if (brace === 0 && ch === '>' && angle > 0) angle -= 1
    chunk += ch
    if (ch === '\n' && brace === 0 && paren === 0 && bracket === 0 && angle === 0) flush()
    index += 1
  }
  flush()
  const storedGlobals = []
  const executable = []
  for (const item of chunks) {
    const stored = TOP_LEVEL_STORED.exec(item)
    if (stored) storedGlobals.push(stored[1])
    else if (!TOP_LEVEL_DECLARATION.test(item) && !TOP_LEVEL_ATTRIBUTE_ONLY.test(item) && !TOP_LEVEL_DIRECTIVE.test(item)) {
      executable.push(item)
    }
  }
  return { storedGlobals, executable }
}

function readPackageVersion(root) {
  return JSON.parse(nodeReadFileSync(path.join(root, 'package.json'), 'utf8')).version
}

/**
 * Compile the appex into the packed app. electron-builder skips Contents/PlugIns
 * when it signs, so the appex is signed afterwards, inside-out, before the
 * parent app seal. Off macOS this is skipped.
 */
export function prepareFinderSyncAppex({
  appBundle,
  arch = process.arch,
  env = process.env,
  version,
  repo = repoRoot,
  spawnSync = nodeSpawnSync,
  platform = process.platform,
} = {}) {
  if (platform !== 'darwin') {
    return { ok: false, skipped: true, reason: 'Finder Sync appex builds only on macOS, with Xcode swiftc.' }
  }
  const target = macosSwiftTarget(arch)
  if (!target) {
    return { ok: false, skipped: false, reason: 'Finder Sync appex does not build a universal binary.' }
  }
  const source = path.join(repo, 'macos/FinderSync/FinderSync.swift')
  if (!nodeExistsSync(source)) {
    return { ok: false, skipped: false, reason: `Missing ${source}` }
  }
  const testFeed = testFeedBuildRequested(env)
  const bundleId = finderSyncBundleId(testFeed)
  const shortVersion = version || readPackageVersion(repo)
  const appexPath = finderSyncAppexPath(appBundle)
  const contents = path.join(appexPath, 'Contents')
  const macosDir = path.join(contents, 'MacOS')
  const executable = path.join(macosDir, FINDER_SYNC_EXECUTABLE)
  mkdirSync(macosDir, { recursive: true })
  writeFileSync(
    path.join(contents, 'Info.plist'),
    finderSyncInfoPlist({ bundleId, version: shortVersion, testFeed }),
  )

  const sdk = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' })
  const sdkPath = String(sdk.stdout ?? '').trim()
  if ((sdk.status ?? 1) !== 0 || !sdkPath) {
    return {
      ok: false,
      skipped: false,
      reason:
        'xcrun could not find the macOS SDK. Install Xcode or the Command Line Tools on the macOS build machine.',
    }
  }
  const compiled = spawnSync(
    'xcrun',
    ['--sdk', 'macosx', 'swiftc', ...finderSyncCompileArgs({ sdk: sdkPath, target, source, output: executable })],
    { encoding: 'utf8' },
  )
  if ((compiled.status ?? 1) !== 0) {
    const detail = [compiled.stderr, compiled.stdout, compiled.error?.message].filter(Boolean).join('\n')
    return {
      ok: false,
      skipped: false,
      reason:
        detail ||
        'swiftc failed. The Finder Sync appex is compiled with Xcode swiftc on the macOS build machine.',
    }
  }
  return { ok: true, skipped: false, appexPath, bundleId, executable, testFeed }
}

export function finderSyncEntitlementsPlist(testFeed) {
  const group = finderSyncAppGroup(Boolean(testFeed))
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>${FINDER_SYNC_ENTITLEMENT}</key>
    <true/>
    <key>${FINDER_SYNC_APP_GROUP_ENTITLEMENT}</key>
    <array>
      <string>${xmlEscape(group)}</string>
    </array>
  </dict>
</plist>
`
}

export function entitlementTextListsGroup(text, group) {
  return String(text ?? '').includes(`<string>${group}</string>`)
}

export function finderSyncSignArgs({ identity, entitlements, bundleId, target, keychain }) {
  const args = ['--force', '--sign', identity, '--entitlements', entitlements, '--options', 'runtime']
  if (bundleId) args.push('--identifier', bundleId)
  if (identity !== '-') args.push('--timestamp')
  if (keychain) args.push('--keychain', keychain)
  args.push(target)
  return args
}

/**
 * Sign the Mach-O, then the .appex bundle. The parent app is signed later by
 * electron-builder, which does not re-sign Contents/PlugIns.
 */
export function signFinderSyncAppex({
  appexPath,
  identity,
  bundleId,
  entitlements,
  testFeed = false,
  keychain,
  spawnSync = nodeSpawnSync,
} = {}) {
  const signIdentity = finderSyncCodesignIdentity(identity)
  if (!signIdentity) return { ok: false, reason: 'No signing identity for the Finder Sync appex.' }
  let entitlementsFile = entitlements
  let temporary = null
  if (!entitlementsFile) {
    temporary = mkdtempSync(path.join(tmpdir(), 'font-butler-finder-sync-entitlements-'))
    entitlementsFile = path.join(temporary, 'entitlements.plist')
    writeFileSync(entitlementsFile, finderSyncEntitlementsPlist(testFeed))
  }
  const executable = path.join(appexPath, 'Contents', 'MacOS', FINDER_SYNC_EXECUTABLE)
  const targets = [
    { target: executable, bundleId },
    { target: appexPath, bundleId: null },
  ]
  try {
    for (const item of targets) {
      const result = spawnSync(
        'codesign',
        finderSyncSignArgs({
          identity: signIdentity,
          entitlements: entitlementsFile,
          bundleId: item.bundleId,
          target: item.target,
          keychain,
        }),
        { encoding: 'utf8' },
      )
      if ((result?.status ?? 1) !== 0) {
        const detail = [result?.stderr, result?.stdout, result?.error?.message].filter(Boolean).join('\n')
        return { ok: false, reason: detail || `codesign failed for ${item.target}` }
      }
    }
    return { ok: true, identity: signIdentity }
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
}

export function finderSyncAppexFailures({
  present = false,
  bundleId = '',
  expectedBundleId = '',
  principalClass = '',
  extensionPoint = '',
  codesignVerifyStatus = 1,
  codesignDisplay = '',
  entitlementKeys = [],
  requireDeveloperId = false,
  teamId = DEVELOPER_ID_TEAM,
  urlScheme = '',
  installTitle = '',
  expectedInstallTitle = '',
  installAsTitle = '',
  expectedInstallAsTitle = '',
  compareTitle = '',
  expectedCompareTitle = '',
  expectedAppGroup = '',
  entitlementText = '',
  machService = '',
  expectedMachService = '',
} = {}) {
  const failures = []
  if (!present) {
    failures.push('The Finder Sync appex is missing from Contents/PlugIns.')
    return failures
  }
  if (!expectedBundleId || bundleId !== expectedBundleId) {
    failures.push(
      `The Finder Sync appex bundle ID is ${bundleId || 'missing'}, expected ${expectedBundleId || 'a Font Buttler Finder Sync ID'}.`,
    )
  }
  if (principalClass !== FINDER_SYNC_PRINCIPAL_CLASS) {
    failures.push(`The Finder Sync appex principal class is not ${FINDER_SYNC_PRINCIPAL_CLASS}.`)
  }
  if (extensionPoint !== FINDER_SYNC_EXTENSION_POINT) {
    failures.push('The Finder Sync appex is not a Finder Sync extension.')
  }
  if (codesignVerifyStatus !== 0) {
    failures.push('codesign --verify --deep --strict failed on the Finder Sync appex.')
  }
  const keys = entitlementKeys ?? []
  const allowed = new Set([FINDER_SYNC_ENTITLEMENT, FINDER_SYNC_APP_GROUP_ENTITLEMENT])
  const groupKeys = keys.filter((key) => allowed.has(key))
  if (keys.length !== 2 || groupKeys.length !== 2) {
    failures.push('The Finder Sync appex entitlements must be the app sandbox and its application group.')
  }
  if (expectedAppGroup) {
    const strings = [...String(entitlementText ?? '').matchAll(/<string>([^<]*)<\/string>/g)].map((match) => match[1])
    if (strings.length !== 1 || strings[0] !== expectedAppGroup) {
      failures.push(
        `The Finder Sync appex application group is ${strings[0] || 'missing'}, expected ${expectedAppGroup}.`,
      )
    }
  }
  if (expectedMachService && machService !== expectedMachService) {
    failures.push(
      `The Finder Sync Mach service is ${machService || 'missing'}, expected ${expectedMachService}.`,
    )
  }
  if (urlScheme) {
    failures.push('The Finder Sync appex must not declare a URL scheme.')
  }
  if (expectedInstallTitle && installTitle !== expectedInstallTitle) {
    failures.push(`The Finder Sync menu title is ${installTitle || 'missing'}, expected ${expectedInstallTitle}.`)
  }
  if (expectedInstallAsTitle && installAsTitle !== expectedInstallAsTitle) {
    failures.push(
      `The Finder Sync Install as title is ${installAsTitle || 'missing'}, expected ${expectedInstallAsTitle}.`,
    )
  }
  if (expectedCompareTitle && compareTitle !== expectedCompareTitle) {
    failures.push(
      `The Finder Sync Compare title is ${compareTitle || 'missing'}, expected ${expectedCompareTitle}.`,
    )
  }
  // Notarization of this nested appex is the enclosing app's Notarized
  // Developer ID result. spctl -t exec rejects the appex ("does not seem to
  // be an app") and never prints that string. The appex has no staple of its
  // own; the ticket is on the app and the DMG. These checks are the appex
  // signature: Developer ID identity, team, and the hardened runtime.
  if (requireDeveloperId) {
    if (/Signature=adhoc/i.test(codesignDisplay)) failures.push('The Finder Sync appex is ad-hoc signed.')
    if (!codesignDisplay.includes(`Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}`)) {
      failures.push(
        `The Finder Sync appex is not signed with Developer ID identity "${DEVELOPER_ID_IDENTITY}".`,
      )
    }
    const team = codesignDisplay.match(/TeamIdentifier=([^\s]+)/)?.[1] ?? ''
    if (team !== teamId) failures.push(`The Finder Sync appex team ID is not ${teamId}.`)
    if (!/flags=0x[0-9a-fA-F]+\([^)\n]*\bruntime\b/.test(codesignDisplay)) {
      failures.push('The Finder Sync appex is not signed with the hardened runtime.')
    }
  }
  return failures
}

export function verifyFinderSyncAppex({
  appexPath,
  expectedBundleId,
  requireDeveloperId = false,
  expectedInstallTitle = '',
  expectedInstallAsTitle = '',
  expectedCompareTitle = '',
  spawnSync = nodeSpawnSync,
  readFileSync = nodeReadFileSync,
  existsSync = nodeExistsSync,
} = {}) {
  const present = Boolean(appexPath && existsSync(appexPath))
  let bundleId = ''
  let principalClass = ''
  let extensionPoint = ''
  let urlScheme = ''
  let installTitle = ''
  let installAsTitle = ''
  let compareTitle = ''
  let codesignDisplay = ''
  let codesignVerifyStatus = 1
  let entitlementKeys = []
  let entitlementText = ''
  let machService = ''
  if (present) {
    try {
      const plist = readFileSync(path.join(appexPath, 'Contents', 'Info.plist'), 'utf8')
      bundleId = plistString(plist, 'CFBundleIdentifier')
      principalClass = plistString(plist, 'NSExtensionPrincipalClass')
      extensionPoint = plistString(plist, 'NSExtensionPointIdentifier')
      urlScheme = plistString(plist, 'FontButtlerURLScheme')
      installTitle = plistString(plist, 'FontButtlerInstallTitle')
      installAsTitle = plistString(plist, 'FontButtlerInstallAsTitle')
      compareTitle = plistString(plist, 'FontButtlerCompareTitle')
      machService = plistString(plist, 'FontButtlerMachService')
    } catch {
      bundleId = ''
    }
    const display = spawnSync('codesign', ['-dv', '--verbose=4', appexPath], { encoding: 'utf8' })
    codesignDisplay = `${display?.stdout ?? ''}\n${display?.stderr ?? ''}`
    const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appexPath], {
      encoding: 'utf8',
    })
    codesignVerifyStatus = verify?.status ?? 1
    const entitlements = spawnSync('codesign', ['-d', '--entitlements', ':-', appexPath], { encoding: 'utf8' })
    entitlementText = `${entitlements?.stdout ?? ''}\n${entitlements?.stderr ?? ''}`
    entitlementKeys = entitlementKeysFromCodesign(entitlementText)
  }
  const expectedAppGroup =
    expectedBundleId === finderSyncBundleId(true)
      ? finderSyncAppGroup(true)
      : expectedBundleId === finderSyncBundleId(false)
        ? finderSyncAppGroup(false)
        : ''
  const failures = finderSyncAppexFailures({
    present,
    bundleId,
    expectedBundleId,
    principalClass,
    extensionPoint,
    codesignVerifyStatus,
    codesignDisplay,
    entitlementKeys,
    entitlementText,
    requireDeveloperId,
    urlScheme,
    installTitle,
    expectedInstallTitle,
    installAsTitle,
    expectedInstallAsTitle,
    compareTitle,
    expectedCompareTitle,
    expectedAppGroup,
    machService,
    expectedMachService: expectedAppGroup ? finderSyncMachService(expectedBundleId === finderSyncBundleId(true)) : '',
  })
  return { ok: failures.length === 0, failures }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  console.log(
    'The Finder Sync appex is compiled into the app during the macOS pack (afterPack), using Xcode swiftc on that Mac.',
  )
  if (process.platform !== 'darwin') process.exit(0)
  console.log(`Source: ${sourcePath}`)
}

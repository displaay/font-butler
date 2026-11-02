/**
 * Pure checks for scripts/finder-sync-mac-check.mjs.
 * Parsing and classification run on Linux. The command itself is macOS-only.
 */
import {
  FINDER_SYNC_MAX_BYTES,
  FINDER_SYNC_MAX_FILES,
  FINDER_SYNC_TOO_LARGE,
  FINDER_SYNC_TOO_MANY_FILES,
  FINDER_SYNC_TREE_TOO_DEEP,
  finderSyncAgentBundleId,
  finderSyncAppGroup,
  validateFinderSyncSelection,
} from '../electron/finder-sync.mjs'

export const FINDER_SYNC_REJECTION =
  /^(?:rejected: connection invalidated|rejected: NSCocoaErrorDomain 4099(?:\s|$))/

const CPU_NAMES = new Map([
  [0x01000007, 'x86_64'],
  [0x0100000c, 'arm64'],
])

export const AUTOMATED_CHECKS = [
  { id: 'appex-present', title: 'Finder Sync appex bundle is inside the app' },
  { id: 'appex-entry', title: 'swiftc entry point _NSExtensionMain is in the appex' },
  { id: 'appex-arch', title: 'appex architecture matches the app' },
  { id: 'receiver-present', title: 'finder-sync-receiver.node is in the bundle' },
  { id: 'helper-present', title: 'Finder Sync helper executable is in the bundle' },
  { id: 'no-stray-slices', title: 'no stray .slice Mach-O files in the bundle' },
  { id: 'agent-status', title: 'SMAppService status from --finder-sync-agent-status' },
  { id: 'app-entitlements', title: 'app entitlements: allow-jit, apple-events, and the team group' },
  { id: 'appex-group', title: 'appex entitlements use this build’s team-prefixed group' },
  { id: 'helper-runtime', title: 'helper has the hardened runtime and no allow-jit' },
  { id: 'helper-identifier', title: 'helper identifier matches this build' },
  { id: 'spctl-app', title: 'spctl reports Notarized Developer ID for the app' },
  { id: 'stapler-app', title: 'stapler validate passes for the app' },
  { id: 'spctl-appex', title: 'spctl reports Notarized Developer ID for the appex' },
  { id: 'stapler-appex', title: 'stapler validate passes for the appex' },
  { id: 'spctl-dmg', title: 'spctl reports Notarized Developer ID for the DMG app' },
  { id: 'stapler-dmg', title: 'stapler validate passes for the DMG app' },
  { id: 'spctl-zip', title: 'spctl reports Notarized Developer ID for the update zip app' },
  { id: 'stapler-zip', title: 'stapler validate passes for the update zip app' },
  { id: 'xpc-accept', title: 'Developer ID appex client receives ping ok' },
  { id: 'xpc-reject', title: 'ad-hoc and wrong-identifier clients are rejected' },
  { id: 'socket-submit', title: 'submit ok through the helper socket' },
  { id: 'xpc-anonymous', title: 'anonymous XPC listener rejects a foreign client' },
  { id: 'launchd-vend', title: 'launchd vends the Mach service (no invalid connection)' },
  { id: 'limit-files', title: 'more than 500 files is refused' },
  { id: 'limit-bytes', title: 'more than 2 GB is refused' },
  { id: 'limit-depth', title: 'more than 10 levels of nesting is refused' },
  { id: 'symlink-standard', title: '/tmp and /var resolve through the standard private symlinks' },
  { id: 'symlink-other', title: 'other symlinks are refused' },
]

export const MANUAL_MAC_CHECKS = [
  {
    id: 'menu-roots',
    action: 'Right-click a font in your home folder, in /Users/Shared, and on a volume under /Volumes.',
    expect: 'Install and Install as… appear. They do not come from monitoring /Library/Fonts.',
  },
  {
    id: 'file-provider',
    action: 'Right-click a font inside a signed-in Dropbox folder and an iCloud Drive folder.',
    expect: 'The Finder Sync menu is absent. Right-click > Services > Install still installs.',
  },
  {
    id: 'old-macos',
    action: 'On macOS 11 or 12, right-click a font.',
    expect: 'The Finder Sync menu is hidden. Services still install.',
  },
  {
    id: 'launch-from-quit',
    action: 'Quit Font Buttler, then use the Finder menu on one font.',
    expect: 'The app launches and the font still installs.',
  },
  {
    id: 'missing-app',
    action: 'Move or trash the app, click the Finder menu once, then open the app from its new location.',
    expect:
      'The missing-app message is shown once by the main app (notification if that permission is already granted, otherwise a dialog). A later click can show it again after the short window. The pending-error file is shown once on the next launch and then deleted.',
  },
  {
    id: 'two-apps',
    action: 'Install Font Buttler.app and Font Buttler Test.app and use each menu.',
    expect: 'Each menu stays on its own app. The test app does not unregister the release agent.',
  },
  {
    id: 'disable-extension',
    action: 'Turn the extension off in System Settings.',
    expect: 'The menu disappears and Finder does not crash.',
  },
  {
    id: 'move-app',
    action: 'Move the app, relaunch it, then relaunch Finder.',
    expect: 'The old path’s menu is gone. The menu is the one from the new app.',
  },
  {
    id: 'second-launch',
    action: 'Quit and open the same app again without moving it.',
    expect: 'It does not unregister or register the agent, and Background Items Added does not appear again.',
  },
]

export function linuxRefusalMessage() {
  return 'scripts/finder-sync-mac-check.mjs runs on macOS against a signed Font Buttler.app. On Linux it does not check the bundle.'
}

export function parseMacCheckArgs(argv) {
  const args = { app: '', dmg: '', zip: '', json: false, error: '' }
  const rest = [...argv]
  while (rest.length) {
    const token = rest.shift()
    if (token === '--json') {
      args.json = true
      continue
    }
    if (token === '--dmg' || token === '--zip') {
      const value = rest.shift()
      if (!value || value.startsWith('--')) {
        args.error = `${token} needs a path.`
        return args
      }
      args[token.slice(2)] = value
      continue
    }
    if (token.startsWith('--')) {
      args.error = `Unknown option ${token}.`
      return args
    }
    if (args.app) {
      args.error = 'Pass one app path.'
      return args
    }
    args.app = token
  }
  if (!args.app) args.error = 'Pass the path to a signed Font Buttler.app.'
  return args
}

export function parseAgentStatusOutput(text) {
  const line = String(text ?? '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith('finder-sync-agent-status '))
  if (!line) return null
  try {
    const parsed = JSON.parse(line.slice('finder-sync-agent-status '.length))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function machoArchs(buffer) {
  if (!buffer || buffer.length < 8) return []
  const magic = buffer.readUInt32BE(0)
  const leMagic = magic === 0xcffaedfe || magic === 0xbebafeca
  const read32 = (offset) => (leMagic ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset))
  if (magic === 0xfeedfacf || magic === 0xcffaedfe) {
    const name = CPU_NAMES.get(read32(4))
    return name ? [name] : []
  }
  if (magic === 0xcafebabe || magic === 0xbebafeca) {
    const count = read32(4)
    const archs = []
    for (let index = 0; index < count; index += 1) {
      const offset = 8 + index * 20
      if (offset + 4 > buffer.length) break
      const name = CPU_NAMES.get(read32(offset))
      if (name) archs.push(name)
    }
    return archs
  }
  return []
}

export function sameArchSet(left, right) {
  const a = [...new Set(left ?? [])].sort()
  const b = [...new Set(right ?? [])].sort()
  return a.length > 0 && a.length === b.length && a.every((item, index) => item === b[index])
}

export function nmListsExtensionMain(text) {
  return /(^|\s)_NSExtensionMain(\s|$)/m.test(String(text ?? ''))
}

export function straySliceNames(paths) {
  return (paths ?? []).filter((file) => /\.slice\d+$/.test(String(file)))
}

export function entitlementsHaveKey(text, key) {
  return new RegExp(`<key>${key.replaceAll('.', '\\.')}</key>`).test(String(text ?? ''))
}

export function entitlementGroupStrings(text) {
  return [...String(text ?? '').matchAll(/<string>([^<]*)<\/string>/g)].map((match) => match[1])
}

export function hardenedRuntime(display) {
  return /flags=0x[0-9a-fA-F]+\([^)\n]*\bruntime\b/.test(String(display ?? ''))
}

export function spctlNotarized(output, status) {
  return status === 0 && /Notarized Developer ID/.test(String(output ?? ''))
}

export function staplerAccepted(status) {
  return status === 0
}

function pass(id, reason) {
  return { id, state: 'pass', reason }
}

function fail(id, reason) {
  return { id, state: 'fail', reason }
}

function skip(id, reason) {
  return { id, state: 'skip', reason }
}

function fontStat(kind, extra = {}) {
  return {
    isSymbolicLink: () => kind === 'symlink',
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
    ...extra,
  }
}

function selectionProbes() {
  const tooMany = validateFinderSyncSelection(
    Array.from({ length: FINDER_SYNC_MAX_FILES + 1 }, (_, index) => `/Fonts/${index}.otf`),
    { lstatSync() { const error = new Error('missing'); error.code = 'ENOENT'; throw error } },
  )
  const huge = validateFinderSyncSelection(['/Fonts/Huge.otf'], {
    lstatSync: () => fontStat('file', { size: FINDER_SYNC_MAX_BYTES + 1 }),
    readPrefix: () => Buffer.from('OTTO'),
  })
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
      if (filePath === '/Fonts' || names.has(filePath)) return fontStat('dir')
      const error = new Error('missing')
      error.code = 'ENOENT'
      throw error
    },
    readdirSync: (filePath) => names.get(filePath) ?? [],
    openSync: () => 4,
    closeSync() {},
    fstatSync: () => fontStat('dir'),
  })
  const OTTO = Buffer.from('OTTO')
  const TTF = Buffer.from([0x00, 0x01, 0x00, 0x00])
  const linked = validateFinderSyncSelection(['/tmp/A.otf', '/var/B.ttf', '/Fonts/link.otf'], {
    lstatSync(filePath) {
      const nodes = {
        '/tmp': fontStat('symlink'),
        '/private': fontStat('dir'),
        '/private/tmp': fontStat('dir'),
        '/private/tmp/A.otf': fontStat('file', { size: 8 }),
        '/var': fontStat('symlink'),
        '/private/var': fontStat('dir'),
        '/private/var/B.ttf': fontStat('file', { size: 8 }),
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
      return '/etc/passwd'
    },
    readPrefix(filePath) {
      if (filePath === '/private/tmp/A.otf') return OTTO
      if (filePath === '/private/var/B.ttf') return TTF
      throw new Error('unreadable')
    },
  })
  return { tooMany, huge, deep, linked }
}

export function classifyRoundtripOutput(text, status) {
  const body = String(text ?? '')
  const rejections = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('rejected:') || line.includes('rejected:'))
    .map((line) => {
      const at = line.indexOf('rejected:')
      return line.slice(at).trim()
    })
  const rejectedOk = rejections.filter((line) => FINDER_SYNC_REJECTION.test(line)).length >= 2
  const acceptedNegative = /was accepted/.test(body)
  const ping = body.includes('ping ok')
  const submit = body.includes('submit ok')
  const invalid = /invalid connection/i.test(body)
  const ok = status === 0
  return {
    xpcAccept: ok && ping,
    xpcReject: ok && rejectedOk && !acceptedNegative,
    socketSubmit: ok && submit,
    launchd: ok && ping && !invalid,
    reason: body.trim().split(/\r?\n/).slice(-4).join(' ') || `exit ${status}`,
  }
}

function optionalGate(id, artifact, check) {
  if (!artifact?.provided) return skip(id, 'Not passed on the command line.')
  if (artifact.error) return fail(id, artifact.error)
  return check()
}

/**
 * Turn already-collected command output into one result per automated item.
 * `observations.selection` may be omitted; the limit probes then run here.
 */
export function buildChecklist(observations = {}) {
  const testFeed = observations.testFeed === true
  const group = finderSyncAppGroup(testFeed)
  const other = finderSyncAppGroup(!testFeed)
  const helperId = finderSyncAgentBundleId(testFeed)
  const probes = observations.selection ?? selectionProbes()
  const roundtrip = classifyRoundtripOutput(observations.roundtrip?.output, observations.roundtrip?.status)
  const roundtripReason = observations.roundtrip?.error || roundtrip.reason

  const appEntitlements = String(observations.appEntitlements ?? '')
  const appexEntitlements = String(observations.appexEntitlements ?? '')
  const helperEntitlements = String(observations.helperEntitlements ?? '')
  const helperDisplay = String(observations.helperCodesignDisplay ?? '')
  const groups = entitlementGroupStrings(appEntitlements)
  const appexGroups = entitlementGroupStrings(appexEntitlements)

  const results = [
    observations.appexExists
      ? pass('appex-present', 'Contents/PlugIns contains the Finder Sync appex.')
      : fail('appex-present', 'The Finder Sync appex is missing from Contents/PlugIns.'),
    nmListsExtensionMain(observations.appexNm)
      ? pass('appex-entry', '_NSExtensionMain is in the appex symbol table.')
      : fail('appex-entry', observations.appexNmError || '_NSExtensionMain was not found in nm output.'),
    sameArchSet(observations.appArchs, observations.appexArchs)
      ? pass('appex-arch', `App and appex are ${observations.appexArchs.join(', ')}.`)
      : fail(
          'appex-arch',
          `App archs [${(observations.appArchs ?? []).join(', ')}] and appex archs [${(observations.appexArchs ?? []).join(', ')}] differ.`,
        ),
    observations.receiverExists
      ? pass('receiver-present', 'finder-sync-receiver.node is unpacked in the app.')
      : fail('receiver-present', 'finder-sync-receiver.node is missing from the app.'),
    observations.helperExists
      ? pass('helper-present', 'The Finder Sync helper executable is in the app.')
      : fail('helper-present', 'The Finder Sync helper executable is missing.'),
    straySliceNames(observations.straySlices).length === 0
      ? pass('no-stray-slices', 'No .slice Mach-O files were left in the bundle.')
      : fail('no-stray-slices', `Stray slice files: ${straySliceNames(observations.straySlices).join(', ')}`),
  ]

  const status = observations.agentStatus
  const known = new Set(['enabled', 'requires-approval', 'not-found'])
  if (status && known.has(status.status)) {
    results.push(pass('agent-status', `SMAppService status is ${status.status}.`))
  } else {
    results.push(fail('agent-status', observations.agentStatusError || `Unreadable agent status ${status?.status ?? ''}.`.trim()))
  }

  const appOk =
    entitlementsHaveKey(appEntitlements, 'com.apple.security.cs.allow-jit') &&
    entitlementsHaveKey(appEntitlements, 'com.apple.security.automation.apple-events') &&
    groups.includes(group) &&
    !groups.includes(other)
  results.push(
    appOk
      ? pass('app-entitlements', `allow-jit, apple-events, and ${group}.`)
      : fail('app-entitlements', `App entitlements are missing allow-jit, apple-events, or ${group}.`),
  )
  results.push(
    appexGroups.length === 1 && appexGroups[0] === group
      ? pass('appex-group', group)
      : fail('appex-group', `Appex group is ${appexGroups[0] || 'missing'}, expected ${group}.`),
  )
  const helperRuntimeOk = hardenedRuntime(helperDisplay) && !entitlementsHaveKey(helperEntitlements, 'com.apple.security.cs.allow-jit')
  results.push(
    helperRuntimeOk
      ? pass('helper-runtime', 'Hardened runtime is set and allow-jit is absent.')
      : fail('helper-runtime', 'The helper is missing the hardened runtime or still has allow-jit.'),
  )
  results.push(
    helperDisplay.includes(`Identifier=${helperId}`)
      ? pass('helper-identifier', helperId)
      : fail('helper-identifier', `Expected Identifier=${helperId}.`),
  )

  const gate = (id, sample, label) => {
    if (!sample) return fail(id, `${label} was not run.`)
    return sample.ok ? pass(id, sample.reason || label) : fail(id, sample.reason || `${label} failed.`)
  }
  results.push(gate('spctl-app', observations.spctlApp, 'spctl on the app'))
  results.push(gate('stapler-app', observations.staplerApp, 'stapler on the app'))
  results.push(gate('spctl-appex', observations.spctlAppex, 'spctl on the appex'))
  results.push(gate('stapler-appex', observations.staplerAppex, 'stapler on the appex'))
  results.push(optionalGate('spctl-dmg', observations.dmg, () => gate('spctl-dmg', observations.dmg?.spctl, 'spctl on the DMG app')))
  results.push(optionalGate('stapler-dmg', observations.dmg, () => gate('stapler-dmg', observations.dmg?.stapler, 'stapler on the DMG app')))
  results.push(optionalGate('spctl-zip', observations.zip, () => gate('spctl-zip', observations.zip?.spctl, 'spctl on the zip app')))
  results.push(optionalGate('stapler-zip', observations.zip, () => gate('stapler-zip', observations.zip?.stapler, 'stapler on the zip app')))

  const blocked = status?.status !== 'enabled'
  if (blocked) {
    const why = `Agent status is ${status?.status || 'unknown'}, so the launchd clients were not run.`
    results.push(fail('xpc-accept', why))
    results.push(fail('xpc-reject', why))
    results.push(fail('socket-submit', why))
    results.push(fail('launchd-vend', why))
  } else if (observations.roundtrip?.error && observations.roundtrip.status == null) {
    const why = observations.roundtrip.error
    results.push(fail('xpc-accept', why))
    results.push(fail('xpc-reject', why))
    results.push(fail('socket-submit', why))
    results.push(fail('launchd-vend', why))
  } else {
    results.push(roundtrip.xpcAccept ? pass('xpc-accept', 'ping ok') : fail('xpc-accept', roundtripReason))
    results.push(roundtrip.xpcReject ? pass('xpc-reject', 'Both negative clients printed the expected rejection.') : fail('xpc-reject', roundtripReason))
    results.push(roundtrip.socketSubmit ? pass('socket-submit', 'submit ok') : fail('socket-submit', roundtripReason))
    results.push(
      roundtrip.launchd
        ? pass('launchd-vend', 'The ping reached the helper, so launchd vended the Mach service.')
        : fail('launchd-vend', /invalid connection/i.test(roundtripReason) ? 'invalid connection' : roundtripReason),
    )
  }

  const probe = observations.xpcProbe
  if (!probe) results.push(fail('xpc-anonymous', 'The anonymous XPC probe was not run.'))
  else if (probe.skipped) results.push(skip('xpc-anonymous', probe.reason || 'Skipped.'))
  else if (probe.ok) results.push(pass('xpc-anonymous', 'A foreign client was rejected by the anonymous listener.'))
  else results.push(fail('xpc-anonymous', probe.reason || 'The anonymous XPC probe failed.'))

  results.push(
    probes.tooMany.limitError === FINDER_SYNC_TOO_MANY_FILES
      ? pass('limit-files', FINDER_SYNC_TOO_MANY_FILES)
      : fail('limit-files', probes.tooMany.limitError || 'The 500-file cap did not refuse the selection.'),
  )
  results.push(
    probes.huge.limitError === FINDER_SYNC_TOO_LARGE
      ? pass('limit-bytes', FINDER_SYNC_TOO_LARGE)
      : fail('limit-bytes', probes.huge.limitError || 'The 2 GB cap did not refuse the selection.'),
  )
  results.push(
    probes.deep.rejected?.some((item) => item.reason === FINDER_SYNC_TREE_TOO_DEEP)
      ? pass('limit-depth', FINDER_SYNC_TREE_TOO_DEEP)
      : fail('limit-depth', 'A folder deeper than 10 levels was not refused.'),
  )
  const linkedPaths = probes.linked.paths ?? []
  results.push(
    linkedPaths.includes('/private/tmp/A.otf') && linkedPaths.includes('/private/var/B.ttf')
      ? pass('symlink-standard', '/tmp and /var resolve to /private/tmp and /private/var.')
      : fail('symlink-standard', `Resolved paths were ${linkedPaths.join(', ') || 'none'}.`),
  )
  const otherRefused = (probes.linked.rejected ?? []).some((item) => item.path === '/Fonts/link.otf' && /Symlink/.test(item.reason))
  results.push(
    otherRefused
      ? pass('symlink-other', 'A non-standard symlink was refused.')
      : fail('symlink-other', 'A non-standard symlink was accepted.'),
  )

  const byId = new Map(results.map((item) => [item.id, item]))
  return AUTOMATED_CHECKS.map((item) => {
    const found = byId.get(item.id)
    return {
      id: item.id,
      title: item.title,
      state: found?.state ?? 'fail',
      reason: found?.reason ?? 'This check did not produce a result.',
    }
  })
}

export function summarizeChecklist(results) {
  const passed = results.filter((item) => item.state === 'pass').length
  const failed = results.filter((item) => item.state === 'fail').length
  const skipped = results.filter((item) => item.state === 'skip').length
  return { passed, failed, skipped, ok: failed === 0 }
}

export function formatCheckLine(result) {
  const label = result.state === 'pass' ? 'PASS' : result.state === 'fail' ? 'FAIL' : 'SKIP'
  return `${label}  ${result.id}  ${result.reason}`
}

export function formatSummary(summary) {
  return `summary: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`
}

export function formatManualList() {
  return MANUAL_MAC_CHECKS.map((item, index) => `${index + 1}. ${item.action} Expect: ${item.expect}`)
}

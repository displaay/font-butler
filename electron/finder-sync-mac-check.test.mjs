import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  AUTOMATED_CHECKS,
  FINDER_SYNC_NOT_VENDED,
  FINDER_SYNC_REJECTION,
  clientRejectionKind,
  xpcRequirementRejectionProven,
  MANUAL_MAC_CHECKS,
  buildChecklist,
  entitlementsHaveKey,
  formatCheckLine,
  formatSummary,
  linuxRefusalMessage,
  machoArchs,
  nmListsExtensionMain,
  parseAgentStatusOutput,
  parseMacCheckArgs,
  sameArchSet,
  spctlNotarized,
  staplerAccepted,
  straySliceNames,
  summarizeChecklist,
} from '../scripts/finder-sync-mac-check-lib.mjs'
import { finderSyncAppGroup } from './finder-sync.mjs'

const group = finderSyncAppGroup(false)

function entitlements(keys) {
  const body = keys
    .map(([key, value]) => (value ? `<key>${key}</key><array><string>${value}</string></array>` : `<key>${key}</key><true/>`))
    .join('')
  return `<?xml version="1.0"?><plist><dict>${body}</dict></plist>`
}

function passingObservations(extra = {}) {
  return {
    testFeed: false,
    appexExists: true,
    appexNm: '0000000100003f50 T _NSExtensionMain\n',
    appArchs: ['arm64'],
    appexArchs: ['arm64'],
    receiverExists: true,
    helperExists: true,
    straySlices: [],
    agentStatus: { status: 'enabled' },
    appEntitlements: entitlements([
      ['com.apple.security.cs.allow-jit', ''],
      ['com.apple.security.automation.apple-events', ''],
      ['com.apple.security.application-groups', group],
    ]),
    appexEntitlements: entitlements([['com.apple.security.application-groups', group]]),
    helperEntitlements: entitlements([['com.apple.security.application-groups', group]]),
    helperCodesignDisplay: 'Identifier=app.fontbutler.desktop.FinderSyncAgent\nflags=0x10000(runtime)\n',
    spctlApp: { ok: true, reason: 'Notarized Developer ID' },
    staplerApp: { ok: true, reason: 'stapler validate passed' },
    spctlAppex: { ok: true, reason: 'Notarized Developer ID' },
    staplerAppex: { ok: true, reason: 'stapler validate passed' },
    dmg: { provided: false },
    zip: { provided: false },
    roundtrip: {
      status: 0,
      output: [
        'positive: ping ok',
        'negative: rejected: NSCocoaErrorDomain 4097 Couldn\'t communicate with a helper application.',
        'wrong-identifier: rejected: NSCocoaErrorDomain 4097 Couldn\'t communicate with a helper application.',
        'submit: submit ok',
      ].join('\n'),
    },
    xpcProbe: { ok: true, skipped: false },
    ...extra,
  }
}

test('the Mac checklist parses codesign, spctl, and agent status without a Mac', () => {
  const arm = Buffer.alloc(8)
  arm.writeUInt32LE(0xfeedfacf, 0)
  arm.writeUInt32LE(0x0100000c, 4)
  assert.deepEqual(machoArchs(arm), ['arm64'])
  const intel = Buffer.alloc(8)
  intel.writeUInt32LE(0xfeedfacf, 0)
  intel.writeUInt32LE(0x01000007, 4)
  assert.equal(sameArchSet(machoArchs(arm), machoArchs(intel)), false)
  assert.equal(sameArchSet(['arm64'], ['arm64']), true)
  assert.equal(nmListsExtensionMain('0000000100003f50 T _NSExtensionMain\n'), true)
  assert.equal(nmListsExtensionMain('T _NSExtensionMainExtra\n'), false)
  assert.deepEqual(straySliceNames(['/App/helper', '/App/helper.slice0', '/App/helper.slice12']), [
    '/App/helper.slice0',
    '/App/helper.slice12',
  ])
  assert.equal(entitlementsHaveKey('<key>com.apple.security.cs.allow-jit</key>', 'com.apple.security.cs.allow-jit'), true)
  assert.equal(spctlNotarized('source=Notarized Developer ID', 0), true)
  assert.equal(spctlNotarized('rejected', 1), false)
  assert.equal(staplerAccepted(0), true)
  assert.equal(staplerAccepted(1), false)
  assert.deepEqual(parseAgentStatusOutput('noise\nfinder-sync-agent-status {"status":"requires-approval"}\n'), {
    status: 'requires-approval',
  })
  assert.equal(parseAgentStatusOutput('no status here'), null)
  const measuredNegative = 'rejected: NSCocoaErrorDomain 4097 Couldn\'t communicate with a helper application.'
  const measuredControl = 'rejected: connection invalidated'
  assert.equal(FINDER_SYNC_REJECTION.test(measuredNegative), true)
  assert.equal(FINDER_SYNC_REJECTION.test('rejected: NSCocoaErrorDomain 4099'), true)
  assert.equal(FINDER_SYNC_REJECTION.test(measuredControl), false)
  assert.equal(FINDER_SYNC_NOT_VENDED.test(measuredControl), true)
  assert.equal(clientRejectionKind(measuredNegative), 'requirement')
  assert.equal(clientRejectionKind(measuredControl), 'not-vended')
  assert.equal(clientRejectionKind('ping ok'), 'accepted')
  const measured = [
    'positive: ping ok',
    `negative: ${measuredNegative}`,
    `wrong-identifier: ${measuredNegative}`,
    `control: ${measuredControl}`,
    'submit: submit ok',
  ].join('\n')
  assert.equal(xpcRequirementRejectionProven(measured), true)
  const nobodyHome = measured
    .replaceAll(measuredNegative, measuredControl)
  assert.equal(xpcRequirementRejectionProven(nobodyHome), false)
  const roundtrip = readFileSync(new URL('../scripts/finder-sync-roundtrip-check', import.meta.url), 'utf8')
  assert.match(roundtrip, /NSCocoaErrorDomain 4097/)
  assert.match(roundtrip, /NSCocoaErrorDomain 4099/)
  assert.match(roundtrip, /not a requirement rejection/)
  const command = readFileSync(new URL('../scripts/finder-sync-mac-check.mjs', import.meta.url), 'utf8')
  const guard = command.indexOf("process.platform !== 'darwin'")
  const collectCall = command.indexOf('const results = collect(')
  assert.ok(guard > 0 && collectCall > guard)
  assert.match(command, /linuxRefusalMessage/)
  assert.match(command, /finder-sync-roundtrip-check/)
  assert.match(command, /runFinderSyncXpcRejectionTest/)
})

test('a complete signed-app observation passes, and a missing entitlement or pending approval fails', () => {
  const ready = buildChecklist(passingObservations())
  assert.equal(ready.length, AUTOMATED_CHECKS.length)
  assert.deepEqual(ready.map((item) => item.id), AUTOMATED_CHECKS.map((item) => item.id))
  const summary = summarizeChecklist(ready)
  assert.equal(summary.failed, 0)
  assert.equal(summary.skipped, 4)
  assert.equal(summary.ok, true)
  assert.match(formatSummary(summary), /passed, 0 failed, 4 skipped/)
  assert.match(formatCheckLine(ready[0]), /^PASS  appex-present/)

  const missingEvents = buildChecklist(passingObservations({
    appEntitlements: entitlements([
      ['com.apple.security.cs.allow-jit', ''],
      ['com.apple.security.application-groups', group],
    ]),
  }))
  assert.equal(missingEvents.find((item) => item.id === 'app-entitlements').state, 'fail')

  const jitOnHelper = buildChecklist(passingObservations({
    helperEntitlements: entitlements([
      ['com.apple.security.cs.allow-jit', ''],
      ['com.apple.security.application-groups', group],
    ]),
  }))
  assert.equal(jitOnHelper.find((item) => item.id === 'helper-runtime').state, 'fail')

  const pending = buildChecklist(passingObservations({ agentStatus: { status: 'requires-approval' } }))
  assert.equal(pending.find((item) => item.id === 'agent-status').state, 'pass')
  assert.match(pending.find((item) => item.id === 'agent-status').reason, /requires-approval/)
  assert.equal(pending.find((item) => item.id === 'launchd-vend').state, 'fail')
  assert.equal(pending.find((item) => item.id === 'xpc-accept').state, 'fail')
  assert.equal(summarizeChecklist(pending).ok, false)

  const invalid = buildChecklist(passingObservations({
    roundtrip: {
      status: 0,
      output: 'positive: ping ok\nnegative: rejected: connection invalidated\nwrong-identifier: rejected: connection invalidated\nsubmit: submit ok',
    },
  }))
  assert.equal(invalid.find((item) => item.id === 'xpc-reject').state, 'fail')
  assert.equal(invalid.find((item) => item.id === 'launchd-vend').state, 'fail')
  assert.match(invalid.find((item) => item.id === 'launchd-vend').reason, /not vended/)

  const args = parseMacCheckArgs(['/Applications/Font Buttler.app', '--dmg', '/tmp/Font.dmg', '--json'])
  assert.equal(args.error, '')
  assert.equal(args.json, true)
  assert.equal(args.dmg, '/tmp/Font.dmg')
  assert.match(parseMacCheckArgs([]).error, /Font Buttler\.app/)
  assert.match(linuxRefusalMessage(), /macOS/)
  assert.equal(MANUAL_MAC_CHECKS.length, 9)
  for (const item of MANUAL_MAC_CHECKS) {
    assert.ok(item.action)
    assert.ok(item.expect)
  }
})

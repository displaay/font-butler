#!/usr/bin/env node
/**
 * Run the automatable Finder Sync Mac checklist against a signed app.
 *
 *   node scripts/finder-sync-mac-check.mjs "/path/to/Font Buttler.app" [--dmg path] [--zip path] [--json]
 *
 * Prints one PASS, FAIL, or SKIP line per automatable item, then a numbered
 * manual list. Exits non-zero when an automatable item fails. On Linux it
 * refuses before running any macOS tool.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readAppTestFeedMarker } from '../electron/app-update-install.mjs'
import { finderSyncAppexPath } from './build-finder-sync.mjs'
import { finderSyncAgentExecutablePath } from './build-finder-sync-agent.mjs'
import { findAppBundles } from './assert-notarized-mac-release.mjs'
import { strayMachOFiles } from './macho-slices.mjs'
import { runFinderSyncXpcRejectionTest } from './test-finder-sync-xpc.mjs'
import {
  buildChecklist,
  formatCheckLine,
  formatManualList,
  formatSummary,
  linuxRefusalMessage,
  machoArchs,
  parseMacCheckArgs,
  parseAgentStatusOutput,
  selectProductAppBundle,
  spctlNotarized,
  staplerAccepted,
  summarizeChecklist,
} from './finder-sync-mac-check-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    error: result.error?.message ?? '',
  }
}

function readHeader(file) {
  try {
    const opened = readFileSync(file)
    return opened.subarray(0, Math.min(opened.length, 4096))
  } catch {
    return Buffer.alloc(0)
  }
}

function assessSpctl(target) {
  const result = run('spctl', ['-a', '-vv', '-t', 'exec', target])
  const ok = spctlNotarized(result.output, result.status)
  return { ok, reason: ok ? 'Notarized Developer ID' : result.output.trim() || result.error || `spctl exited ${result.status}` }
}

function assessStapler(target) {
  const result = run('xcrun', ['stapler', 'validate', target])
  const ok = staplerAccepted(result.status)
  return { ok, reason: ok ? 'stapler validate passed' : result.output.trim() || result.error || `stapler exited ${result.status}` }
}

function withMountedDmg(dmg, visit) {
  const attached = run('hdiutil', ['attach', '-nobrowse', '-readonly', '-plist', dmg])
  if (attached.status !== 0) return { provided: true, error: attached.output.trim() || 'hdiutil attach failed.' }
  const mount = attached.output.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? ''
  if (!mount) return { provided: true, error: 'hdiutil did not report a mount point.' }
  try {
    return visit(mount)
  } finally {
    run('hdiutil', ['detach', mount])
  }
}

function appInTree(root) {
  return selectProductAppBundle(findAppBundles(root))
}

function artifactChecks(appPath) {
  if (!appPath) {
    return {
      provided: true,
      error: 'No Cuttler.app, Font Buttler.app, or Font Buttler Test.app was found inside the archive.',
    }
  }
  return {
    provided: true,
    spctl: assessSpctl(appPath),
    stapler: assessStapler(appPath),
  }
}

function collect(app, dmg, zip) {
  const testFeed = readAppTestFeedMarker(app) === true
  const appex = finderSyncAppexPath(app)
  const appexExecutable = path.join(appex, 'Contents', 'MacOS', 'FontButtlerFinderSync')
  const mainExecutable = path.join(app, 'Contents', 'MacOS', path.basename(app, '.app'))
  const receiver = path.join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'electron', 'finder-sync-receiver.node')
  const helper = finderSyncAgentExecutablePath(app)
  const nm = existsSync(appexExecutable) ? run('nm', ['-g', appexExecutable]) : { output: '', error: 'The appex executable is missing.' }
  const statusRun = run(path.join(app, 'Contents', 'MacOS', path.basename(app, '.app')), ['--finder-sync-agent-status'], { timeout: 60000 })
  const agentStatus = parseAgentStatusOutput(statusRun.output)
  const observations = {
    testFeed,
    appexExists: existsSync(appex),
    appexNm: nm.output,
    appexNmError: nm.error,
    appArchs: machoArchs(readHeader(mainExecutable)),
    appexArchs: machoArchs(readHeader(appexExecutable)),
    receiverExists: existsSync(receiver),
    helperExists: existsSync(helper),
    straySlices: strayMachOFiles(app, { slicesOnly: true }),
    agentStatus,
    agentStatusError: agentStatus ? '' : statusRun.output.trim() || statusRun.error || 'The app did not print a Finder Sync agent status.',
    appEntitlements: run('codesign', ['-d', '--entitlements', ':-', app]).output,
    appexEntitlements: existsSync(appex) ? run('codesign', ['-d', '--entitlements', ':-', appex]).output : '',
    helperEntitlements: '',
    helperCodesignDisplay: '',
    spctlApp: assessSpctl(app),
    staplerApp: assessStapler(app),
    appexCodesignDisplay: existsSync(appex) ? run('codesign', ['-dv', '--verbose=4', appex]).output : '',
    dmg: dmg ? { provided: true, error: 'DMG was not mounted.' } : { provided: false },
    zip: zip ? { provided: true, error: 'The update zip was not unpacked.' } : { provided: false },
    roundtrip: { status: null, output: '', error: '' },
    xpcProbe: runFinderSyncXpcRejectionTest(),
  }
  const helperApp = path.dirname(path.dirname(path.dirname(helper)))
  observations.helperEntitlements = existsSync(helperApp) ? run('codesign', ['-d', '--entitlements', ':-', helperApp]).output : ''
  observations.helperCodesignDisplay = existsSync(helperApp) ? run('codesign', ['-dv', '--verbose=4', helperApp]).output : ''

  if (dmg) {
    observations.dmg = withMountedDmg(dmg, (mount) => artifactChecks(appInTree(mount)))
  }
  if (zip) {
    const directory = mkdtempSync(path.join(tmpdir(), 'font-butler-mac-check-zip-'))
    try {
      const unpacked = run('unzip', ['-q', zip, '-d', directory])
      observations.zip = unpacked.status !== 0
        ? { provided: true, error: unpacked.output.trim() || 'unzip failed.' }
        : artifactChecks(appInTree(directory))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
  if (agentStatus?.status === 'enabled') {
    const roundtrip = run(path.join(repoRoot, 'scripts', 'finder-sync-roundtrip-check'), [app], { timeout: 180000 })
    observations.roundtrip = { status: roundtrip.status, output: roundtrip.output, error: roundtrip.error }
  }
  return buildChecklist(observations)
}

function main() {
  const args = parseMacCheckArgs(process.argv.slice(2))
  if (args.error) {
    console.error(args.error)
    console.error('Usage: node scripts/finder-sync-mac-check.mjs "/path/to/Font Buttler.app" [--dmg path] [--zip path] [--json]')
    process.exit(2)
  }
  if (process.platform !== 'darwin') {
    const message = linuxRefusalMessage()
    if (args.json) console.log(JSON.stringify({ ok: false, error: message, manual: formatManualList() }))
    else console.error(message)
    process.exit(2)
  }
  if (!existsSync(args.app)) {
    const message = `App not found: ${args.app}`
    if (args.json) console.log(JSON.stringify({ ok: false, error: message }))
    else console.error(message)
    process.exit(2)
  }
  const results = collect(path.resolve(args.app), args.dmg, args.zip)
  const summary = summarizeChecklist(results)
  if (args.json) {
    console.log(JSON.stringify({ ...summary, results, manual: formatManualList() }, null, 2))
  } else {
    for (const result of results) console.log(formatCheckLine(result))
    console.log(formatSummary(summary))
    console.log('Manual checks (not run):')
    for (const line of formatManualList()) console.log(line)
  }
  process.exit(summary.ok ? 0 : 1)
}

main()

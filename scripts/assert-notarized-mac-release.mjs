import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEVELOPER_ID_IDENTITY } from './mac-signing.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function notarizationFailures({
  codesignDisplay = '',
  codesignVerifyStatus = 1,
  entitlements = '',
  staplerAppStatus = 1,
  staplerDmgStatus = 1,
  staplerZipAppStatus = 1,
  staplerDmgAppStatus = 1,
  spctlOutput = '',
  spctlStatus = 1,
}) {
  const failures = []
  if (/Signature=adhoc/i.test(codesignDisplay)) failures.push('The app is ad-hoc signed.')
  if (!codesignDisplay.includes(`Authority=Developer ID Application: ${DEVELOPER_ID_IDENTITY}`)) {
    failures.push(`The app is not signed with Developer ID identity "${DEVELOPER_ID_IDENTITY}".`)
  }
  if (/get-task-allow/.test(entitlements)) failures.push('Release entitlements include get-task-allow.')
  if (/disable-library-validation/.test(entitlements)) {
    failures.push('Release entitlements disable library validation.')
  }
  if (codesignVerifyStatus !== 0) {
    failures.push('codesign --verify --deep --strict failed. A helper, framework, or native module is unsigned.')
  }
  if (staplerAppStatus !== 0) failures.push('xcrun stapler validate failed on the app.')
  if (staplerDmgStatus !== 0) failures.push('xcrun stapler validate failed on the DMG.')
  if (staplerDmgAppStatus !== 0) failures.push('The DMG does not contain a stapled app.')
  if (staplerZipAppStatus !== 0) failures.push('The update zip does not contain a stapled app.')
  if (spctlStatus !== 0 || !/Notarized Developer ID/.test(spctlOutput)) {
    failures.push('spctl did not report Notarized Developer ID.')
  }
  return failures
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  }
}

export function findAppBundles(dir) {
  const found = []
  function walk(current, depth) {
    if (depth > 5) return
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = path.join(current, entry.name)
      if (entry.name.endsWith('.app')) found.push(full)
      else walk(full, depth + 1)
    }
  }
  walk(dir, 0)
  return found
}

export function macReleaseFiles(root) {
  const releaseDir = path.join(root, 'release')
  let names = []
  try {
    names = readdirSync(releaseDir)
  } catch {
    return { releaseDir, dmgs: [], zips: [], zipBlockmaps: [], feed: path.join(releaseDir, 'latest-mac.yml'), apps: [] }
  }
  const dmgs = names.filter((name) => name.endsWith('.dmg')).map((name) => path.join(releaseDir, name))
  const zips = names.filter((name) => name.endsWith('.zip')).map((name) => path.join(releaseDir, name))
  const zipBlockmaps = names
    .filter((name) => name.endsWith('.zip.blockmap'))
    .map((name) => path.join(releaseDir, name))
  return {
    releaseDir,
    dmgs,
    zips,
    zipBlockmaps,
    feed: path.join(releaseDir, 'latest-mac.yml'),
    apps: findAppBundles(releaseDir).filter((app) => path.basename(app) === 'Font Buttler.app'),
  }
}

function attachDmg(dmg) {
  const attached = run('hdiutil', ['attach', '-nobrowse', '-readonly', '-plist', dmg])
  if (attached.status !== 0) {
    return { mount: null, output: attached.output }
  }
  const match = attached.output.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/)
  return { mount: match?.[1] ?? null, output: attached.output }
}

function staplerStatus(target) {
  return run('xcrun', ['stapler', 'validate', target]).status
}

function evidenceForApp(app, extra) {
  const display = run('codesign', ['-dv', '--verbose=4', app])
  const verify = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  const entitlements = run('codesign', ['-d', '--entitlements', ':-', app])
  const spctl = run('spctl', ['-a', '-vv', '-t', 'exec', app])
  return notarizationFailures({
    codesignDisplay: display.output,
    codesignVerifyStatus: verify.status,
    entitlements: entitlements.output,
    staplerAppStatus: staplerStatus(app),
    spctlOutput: spctl.output,
    spctlStatus: spctl.status,
    ...extra,
  })
}

export function assertNotarizedMacRelease(root = repoRoot) {
  if (process.platform !== 'darwin') {
    return ['Refusing to publish a macOS release from a non-macOS host. Notarization can only be checked on macOS.']
  }
  const files = macReleaseFiles(root)
  const failures = []
  if (files.apps.length === 0) failures.push('No Font Buttler.app was found under release/.')
  if (files.dmgs.length === 0) failures.push('No DMG was found under release/.')
  if (files.zips.length === 0) failures.push('No update zip was found under release/.')
  if (failures.length) return failures

  const app = files.apps[0]
  const dmg = files.dmgs[0]
  const zip = files.zips[0]
  const mounted = attachDmg(dmg)
  let dmgAppStatus = 1
  try {
    if (!mounted.mount) {
      failures.push(`Could not mount ${path.basename(dmg)} to check the stapled app.`)
    } else {
      const inside = findAppBundles(mounted.mount).find((bundle) => path.basename(bundle) === 'Font Buttler.app')
      dmgAppStatus = inside ? staplerStatus(inside) : 1
      if (!inside) failures.push('The DMG does not contain Font Buttler.app.')
    }
  } finally {
    if (mounted.mount) run('hdiutil', ['detach', mounted.mount])
  }

  const zipDir = mkdtempSync(path.join(tmpdir(), 'font-butler-zip-'))
  let zipAppStatus = 1
  try {
    const unzipped = run('unzip', ['-q', zip, '-d', zipDir])
    if (unzipped.status !== 0) {
      failures.push('The update zip could not be unpacked.')
    } else {
      const inside = findAppBundles(zipDir).find((bundle) => path.basename(bundle) === 'Font Buttler.app')
      zipAppStatus = inside ? staplerStatus(inside) : 1
      if (!inside) failures.push('The update zip does not contain Font Buttler.app.')
    }
  } finally {
    rmSync(zipDir, { recursive: true, force: true })
  }

  failures.push(
    ...evidenceForApp(app, {
      staplerDmgStatus: staplerStatus(dmg),
      staplerDmgAppStatus: dmgAppStatus,
      staplerZipAppStatus: zipAppStatus,
    }),
  )
  return failures
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const failures = assertNotarizedMacRelease()
  if (failures.length) {
    console.error('Refusing to publish this macOS build.')
    for (const failure of failures) console.error(`- ${failure}`)
    process.exit(1)
  }
  console.log('Notarized Developer ID app, DMG, and update zip are stapled.')
}

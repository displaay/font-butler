import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha512Base64 } from './mac-dmg-staple.mjs'
import { DEVELOPER_ID_IDENTITY } from './mac-signing.mjs'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

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

export function macReleaseAssetNames(version) {
  const stem = `Font-Buttler-${version}-arm64`
  return {
    dmg: `${stem}.dmg`,
    zip: `${stem}.zip`,
    zipBlockmap: `${stem}.zip.blockmap`,
    feed: 'latest-mac.yml',
    appRelative: path.join('mac-arm64', 'Font Buttler.app'),
  }
}

export function readPackVersion(root) {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
}

/**
 * Compare latest-mac.yml to the DMG and zip now on disk. Stapling changes the
 * DMG bytes after electron-builder hashed them, so a feed that still has the
 * pre-staple sha512 or size must fail the publish.
 */
export async function updateFeedFailures({ dmg, zip, feed }) {
  const feedName = path.basename(feed)
  if (!existsSync(feed)) return [`${feedName} is missing, so the update feed cannot be checked.`]
  let doc
  try {
    doc = yaml.load(readFileSync(feed, 'utf8'))
  } catch {
    return [`Could not read ${feedName}.`]
  }
  if (!doc || !Array.isArray(doc.files)) return [`${feedName} has no files list.`]
  const failures = []
  const zipName = path.basename(zip)
  const dmgName = path.basename(dmg)
  for (const name of [zipName, dmgName]) {
    const file = name === zipName ? zip : dmg
    const entry = doc.files.find((item) => item && path.basename(String(item.url ?? '')) === name)
    if (!entry) {
      failures.push(`${feedName} has no entry for ${name}.`)
      continue
    }
    if (!existsSync(file)) {
      failures.push(`${name} is missing on disk.`)
      continue
    }
    const sha512 = await sha512Base64(file)
    const size = statSync(file).size
    if (entry.sha512 !== sha512) failures.push(`${feedName} sha512 for ${name} does not match the file on disk.`)
    if (entry.size !== size) failures.push(`${feedName} size for ${name} does not match the file on disk.`)
  }
  if (path.basename(String(doc.path ?? '')) !== zipName) {
    failures.push(`${feedName} path must be ${zipName}.`)
  } else if (existsSync(zip) && doc.sha512 !== (await sha512Base64(zip))) {
    failures.push(`${feedName} sha512 does not match ${zipName}.`)
  }
  return failures
}

/** Archives for this version only. Any other .dmg or .zip in release/ is a hard failure. */
export function prepareMacPublish(root, version) {
  const releaseDir = path.join(root, 'release')
  const expected = macReleaseAssetNames(version)
  let names = []
  try {
    names = readdirSync(releaseDir)
  } catch {
    names = []
  }
  // Stapling invalidates the DMG blockmap. It is not regenerated. Delete any
  // copy still in release/ so publish cannot upload a stale one.
  for (const name of names) {
    if (name.endsWith('.dmg.blockmap')) unlinkSync(path.join(releaseDir, name))
  }
  const archives = names.filter((name) => name.endsWith('.dmg') || name.endsWith('.zip'))
  const unexpected = archives.filter((name) => name !== expected.dmg && name !== expected.zip)
  const dmg = path.join(releaseDir, expected.dmg)
  const zip = path.join(releaseDir, expected.zip)
  const zipBlockmap = path.join(releaseDir, expected.zipBlockmap)
  const feed = path.join(releaseDir, expected.feed)
  const app = path.join(releaseDir, expected.appRelative)
  const failures = unexpected.map(
    (name) =>
      `release/${name} is not ${expected.dmg} or ${expected.zip}. Remove macOS archives from other versions before publishing.`,
  )
  const required = [
    [dmg, expected.dmg],
    [zip, expected.zip],
    [zipBlockmap, expected.zipBlockmap],
    [feed, expected.feed],
    [app, expected.appRelative],
  ]
  for (const [file, label] of required) {
    if (!existsSync(file)) failures.push(`Missing release/${label} for version ${version}.`)
  }
  const upload = (failures.length ? [] : [dmg, zip, zipBlockmap, feed]).filter(
    (file) => !path.basename(file).endsWith('.dmg.blockmap'),
  )
  return { expected, unexpected, failures, dmg, zip, zipBlockmap, feed, app, upload }
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

export async function assertNotarizedMacRelease(root = repoRoot, version = readPackVersion(root)) {
  const files = prepareMacPublish(root, version)
  const feedFailures =
    existsSync(files.dmg) && existsSync(files.zip) && existsSync(files.feed)
      ? await updateFeedFailures({ dmg: files.dmg, zip: files.zip, feed: files.feed })
      : []
  if (process.platform !== 'darwin') {
    return [
      'Refusing to publish a macOS release from a non-macOS host. Notarization can only be checked on macOS.',
      ...feedFailures,
    ]
  }
  if (files.failures.length) return [...files.failures, ...feedFailures]

  const { app, dmg, zip } = files
  const failures = []
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
    ...feedFailures,
  )
  return failures
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const failures = await assertNotarizedMacRelease()
  if (failures.length) {
    console.error('Refusing to publish this macOS build.')
    for (const failure of failures) console.error(`- ${failure}`)
    process.exit(1)
  }
  console.log('Notarized Developer ID app, DMG, and update zip are stapled.')
}

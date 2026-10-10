import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import {
  APP_UPDATE_FEED_ENV,
  DEVELOPER_ID_TEAM,
  readAppTestFeedMarker,
  resolveUpdateFeedUrl,
} from '../electron/app-update-install.mjs'
import { sha512Base64 } from './mac-dmg-staple.mjs'
import { DEVELOPER_ID_IDENTITY, TEST_FEED_BUILD_ENV, TEST_FEED_VERSION_ENV } from './mac-signing.mjs'
import { finderSyncBundleId, finderSyncMenuTitle } from '../electron/finder-sync.mjs'
import {
  entitlementKeysFromCodesign,
  finderSyncAppexFailures,
  finderSyncAppexPath,
  plistString,
} from './build-finder-sync.mjs'

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

const TEST_FEED_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

/**
 * Artifact names follow `FONT_BUTLER_TEST_VERSION` only for a marked pack.
 * A stray version variable does not retarget a real 0.3.9 publish.
 */
export function releaseAssetVersion(packageVersion, env = process.env) {
  const marked = String(env?.[TEST_FEED_BUILD_ENV] ?? '').trim() === '1'
  const raw = String(env?.[TEST_FEED_VERSION_ENV] ?? '').trim().replace(/^v/i, '')
  if (marked && TEST_FEED_VERSION_PATTERN.test(raw)) return raw
  return packageVersion
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

export function finderSyncReleaseFailures(appPath, { readFile = readFileSync, exists = existsSync, runCommand = run } = {}) {
  const testFeed = readAppTestFeedMarker(appPath) === true
  const expectedBundleId = finderSyncBundleId(testFeed)
  const appex = finderSyncAppexPath(appPath)
  if (!appex || !exists(appex)) {
    return finderSyncAppexFailures({ present: false, expectedBundleId, requireDeveloperId: true })
  }
  let plist = ''
  try {
    plist = readFile(path.join(appex, 'Contents', 'Info.plist'), 'utf8')
  } catch {
    plist = ''
  }
  const display = runCommand('codesign', ['-dv', '--verbose=4', appex])
  const verify = runCommand('codesign', ['--verify', '--strict', '--verbose=2', appex])
  const entitlements = runCommand('codesign', ['-d', '--entitlements', ':-', appex])
  return finderSyncAppexFailures({
    present: true,
    bundleId: plistString(plist, 'CFBundleIdentifier'),
    expectedBundleId,
    principalClass: plistString(plist, 'NSExtensionPrincipalClass'),
    extensionPoint: plistString(plist, 'NSExtensionPointIdentifier'),
    codesignDisplay: display.output,
    codesignVerifyStatus: verify.status,
    entitlementKeys: entitlementKeysFromCodesign(entitlements.output),
    requireDeveloperId: true,
    urlScheme: plistString(plist, 'FontButtlerURLScheme'),
    installTitle: plistString(plist, 'FontButtlerInstallTitle'),
    expectedInstallTitle: finderSyncMenuTitle('install', testFeed),
    installAsTitle: plistString(plist, 'FontButtlerInstallAsTitle'),
    expectedInstallAsTitle: finderSyncMenuTitle('install-as', testFeed),
  })
}

function prefixFailures(where, failures) {
  return failures.map((failure) => `${where}: ${failure}`)
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

/**
 * Packaged Developer ID builds must not honour FONT_BUTLER_UPDATE_FEED_URL.
 * Called from the notarization assert so a release that drops the guard fails closed.
 */
export function releaseFeedOverrideFailures() {
  const feed = resolveUpdateFeedUrl(
    { [APP_UPDATE_FEED_ENV]: 'http://127.0.0.1:9/feed/' },
    { packaged: true, developerId: true, teamId: DEVELOPER_ID_TEAM },
  )
  if (feed) {
    return [
      'A packaged Developer ID build honoured FONT_BUTLER_UPDATE_FEED_URL. Release builds must ignore that local feed.',
    ]
  }
  return []
}

export const TEST_FEED_ENV_REFUSAL =
  'FONT_BUTLER_TEST_FEED_BUILD is set. Marked test builds are never uploaded.'

export const TEST_FEED_MARKER_REFUSAL =
  'This build carries fontButlerTestFeed. Marked test builds are never uploaded.'

export const TEST_FEED_MARKER_UNREADABLE =
  "Couldn't read the release app's package marker."

export const TEST_FEED_MARKER_PROBE_FAILURE =
  "Couldn't run the packaged app's test-feed marker check under ELECTRON_RUN_AS_NODE. If the RunAsNode fuse is disabled, this check cannot run inside the release binary. Do not skip it. Use a helper Electron binary that still allows ELECTRON_RUN_AS_NODE, or enable the RunAsNode fuse for the assert."

const PACKAGED_MARKER_PROBE = `
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const app = process.env.FONT_BUTLER_MARKER_APP
const asarPath = path.join(app, 'Contents', 'Resources', 'app.asar')
const readerInsideAsar = path.join(asarPath, 'electron', 'app-update-install.mjs')

function headerEntry(archive, fileName) {
  if (!Buffer.isBuffer(archive) || archive.length < 16) return null
  if (archive.readUInt32LE(0) !== 4) return null
  const headerSize = archive.readUInt32LE(4)
  if (headerSize < 8 || 8 + headerSize > archive.length) return null
  const headerBuf = archive.subarray(8, 8 + headerSize)
  const stringLength = headerBuf.readInt32LE(4)
  if (stringLength < 2 || 8 + stringLength > headerBuf.length) return null
  let header
  try {
    header = JSON.parse(headerBuf.subarray(8, 8 + stringLength).toString('utf8'))
  } catch {
    return null
  }
  let node = header
  for (const part of fileName.split('/')) {
    node = node?.files?.[part]
    if (!node) return null
  }
  if (node.unpacked || node.offset == null || node.size == null) return null
  const offset = Number(node.offset)
  const size = Number(node.size)
  if (!Number.isInteger(size) || size < 0 || !Number.isFinite(offset) || offset < 0) return null
  const start = 8 + headerSize + offset
  if (start + size > archive.length) return null
  return Buffer.from(archive.subarray(start, start + size))
}

async function importReader() {
  try {
    return await import(pathToFileURL(readerInsideAsar).href)
  } catch {
    const raw = process.versions?.electron ? require('original-fs') : require('node:fs')
    const archive = raw.readFileSync(asarPath)
    const dir = mkdtempSync(path.join(tmpdir(), 'font-butler-marker-'))
    try {
      for (const name of ['electron/raw-fs.mjs', 'electron/app-update-install.mjs']) {
        const bytes = headerEntry(archive, name)
        if (!bytes) throw new Error('missing ' + name)
        const dest = path.join(dir, name)
        mkdirSync(path.dirname(dest), { recursive: true })
        writeFileSync(dest, bytes)
      }
      return await import(pathToFileURL(path.join(dir, 'electron', 'app-update-install.mjs')).href)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

const mod = await importReader()
process.stdout.write(JSON.stringify({ marker: mod.readAppTestFeedMarker(app) }))
`

function markerFromProbeStdout(stdout) {
  const lines = String(stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue
    try {
      return JSON.parse(lines[index])
    } catch {
      // A later line may be the marker payload.
    }
  }
  return null
}

/** Run the shipped reader inside the release binary. Missing binary skips; null and a dead probe fail. */
export function packagedElectronMarkerFailures(appPath, { spawnImpl = spawnSync, env = process.env } = {}) {
  if (!appPath || !existsSync(appPath)) return []
  const binary = path.join(appPath, 'Contents', 'MacOS', 'Font Buttler')
  if (!existsSync(binary)) return []
  let result
  try {
    result = spawnImpl(binary, ['--input-type=module', '--eval', PACKAGED_MARKER_PROBE], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1', FONT_BUTLER_MARKER_APP: appPath },
      encoding: 'utf8',
      timeout: 20000,
    })
  } catch {
    return [TEST_FEED_MARKER_PROBE_FAILURE]
  }
  if (!result || result.error || (result.status ?? 1) !== 0) return [TEST_FEED_MARKER_PROBE_FAILURE]
  const parsed = markerFromProbeStdout(result.stdout)
  if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'marker')) return [TEST_FEED_MARKER_PROBE_FAILURE]
  if (parsed.marker === true) return [TEST_FEED_MARKER_REFUSAL]
  if (parsed.marker === false) return []
  return [TEST_FEED_MARKER_UNREADABLE]
}

/** Any non-empty value counts as set. The pack stamp itself only happens for `=1`. */
export function testFeedPublishEnvFailures(env = process.env) {
  if (String(env?.[TEST_FEED_BUILD_ENV] ?? '').trim() !== '') return [TEST_FEED_ENV_REFUSAL]
  return []
}

function findZipEocd(buffer) {
  const min = Math.max(0, buffer.length - 22 - 65535)
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

function zipEntryBytes(buffer, entry) {
  const local = entry.localOffset
  if (local < 0 || local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) return null
  const nameLen = buffer.readUInt16LE(local + 26)
  const extraLen = buffer.readUInt16LE(local + 28)
  const start = local + 30 + nameLen + extraLen
  if (start + entry.compSize > buffer.length) return null
  const compressed = buffer.subarray(start, start + entry.compSize)
  if (entry.method === 0) return Buffer.from(compressed)
  if (entry.method === 8) return inflateRawSync(compressed)
  return null
}

function zipEntries(buffer) {
  const eocd = findZipEocd(buffer)
  if (eocd < 0) return []
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(offset + 10)
    const compSize = buffer.readUInt32LE(offset + 20)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8').replaceAll('\\', '/')
    entries.push({ name, method, compSize, localOffset })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/**
 * `readAppTestFeedMarker` on the app inside a release zip.
 * The zip's loose package.json and app.asar are written into a temporary
 * bundle so the install check and this assert share one reader.
 */
export function readZipAppTestFeedMarker(zipPath) {
  let buffer
  try {
    buffer = readFileSync(zipPath)
  } catch {
    return null
  }
  const root = mkdtempSync(path.join(tmpdir(), 'font-butler-zip-marker-'))
  try {
    const app = path.join(root, 'Font Buttler.app')
    let wrote = false
    for (const entry of zipEntries(buffer)) {
      const loose = entry.name.endsWith('Contents/Resources/app/package.json')
      const asar = entry.name.endsWith('Contents/Resources/app.asar')
      if (!loose && !asar) continue
      let bytes
      try {
        bytes = zipEntryBytes(buffer, entry)
      } catch {
        return null
      }
      if (!bytes) return null
      const dest = loose
        ? path.join(app, 'Contents', 'Resources', 'app', 'package.json')
        : path.join(app, 'Contents', 'Resources', 'app.asar')
      mkdirSync(path.dirname(dest), { recursive: true })
      writeFileSync(dest, bytes)
      wrote = true
    }
    if (!wrote) return null
    return readAppTestFeedMarker(app)
  } catch {
    return null
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** True when a zip's app bundle package.json, loose or inside app.asar, has the test-feed marker. */
export function zipHasTestFeedMarker(zipPath) {
  return readZipAppTestFeedMarker(zipPath) === true
}

function pushFailure(failures, message) {
  if (!failures.includes(message)) failures.push(message)
}

export function testFeedArchiveFailures({ zip, appPaths = [] } = {}) {
  const failures = []
  if (zip && existsSync(zip)) {
    const marker = readZipAppTestFeedMarker(zip)
    if (marker === true) pushFailure(failures, TEST_FEED_MARKER_REFUSAL)
    else if (marker == null) pushFailure(failures, TEST_FEED_MARKER_UNREADABLE)
  }
  for (const appPath of appPaths) {
    if (!appPath || !existsSync(appPath)) continue
    const marker = readAppTestFeedMarker(appPath)
    if (marker === true) pushFailure(failures, TEST_FEED_MARKER_REFUSAL)
    else if (marker == null) pushFailure(failures, TEST_FEED_MARKER_UNREADABLE)
  }
  return failures
}

export async function assertNotarizedMacRelease(
  root = repoRoot,
  version = readPackVersion(root),
  env = process.env,
  spawnImpl = spawnSync,
) {
  version = releaseAssetVersion(version, env)
  const overrideFailures = releaseFeedOverrideFailures()
  const files = prepareMacPublish(root, version)
  const testFeedFailures = []
  for (const message of [
    ...testFeedPublishEnvFailures(env),
    ...testFeedArchiveFailures({ zip: files.zip, appPaths: [files.app] }),
    ...packagedElectronMarkerFailures(files.app, { spawnImpl, env }),
  ]) {
    pushFailure(testFeedFailures, message)
  }
  const feedFailures =
    existsSync(files.dmg) && existsSync(files.zip) && existsSync(files.feed)
      ? await updateFeedFailures({ dmg: files.dmg, zip: files.zip, feed: files.feed })
      : []
  if (process.platform !== 'darwin') {
    return [
      ...overrideFailures,
      ...testFeedFailures,
      'Refusing to publish a macOS release from a non-macOS host. Notarization can only be checked on macOS.',
      ...feedFailures,
    ]
  }
  if (overrideFailures.length) return [...overrideFailures, ...testFeedFailures, ...files.failures, ...feedFailures]
  if (files.failures.length) return [...testFeedFailures, ...files.failures, ...feedFailures]

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
      else failures.push(...prefixFailures('DMG', finderSyncReleaseFailures(inside)))
      for (const failure of testFeedArchiveFailures({ appPaths: inside ? [inside] : [] })) {
        if (!testFeedFailures.includes(failure)) testFeedFailures.push(failure)
      }
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
      else failures.push(...prefixFailures('Update zip', finderSyncReleaseFailures(inside)))
      for (const failure of testFeedArchiveFailures({ appPaths: inside ? [inside] : [] })) {
        if (!testFeedFailures.includes(failure)) testFeedFailures.push(failure)
      }
    }
  } finally {
    rmSync(zipDir, { recursive: true, force: true })
  }

  failures.push(
    ...testFeedFailures,
    ...prefixFailures('App', finderSyncReleaseFailures(app)),
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

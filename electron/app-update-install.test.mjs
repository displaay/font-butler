import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import nodeFs from 'node:fs'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { releaseFeedOverrideFailures, updateFeedFailures } from '../scripts/assert-notarized-mac-release.mjs'
import { rawFs } from './raw-fs.mjs'
import { isNewerVersion as sharedIsNewerVersion } from '../shared/app-update.ts'
import {
  APP_UPDATE_FEED_ENV,
  DEVELOPER_ID_TEAM,
  GITHUB_LATEST_API,
  buildMacSwapScript,
  cleanupOpenedUpdateDmgs,
  createAppUpdateInstaller,
  isAllowedUpdateRequest,
  isNewerVersion,
  isUpdateDmgMounted,
  macArm64ArchiveName,
  normalizeTestFeedUrl,
  parseLatestMacYml,
  readAppTestFeedMarker,
  readAsarFile,
  readBundleShortVersion,
  rememberOpenedDmg,
  resolveUpdateFeedUrl,
  selectExactArm64Assets,
  selectInstallMode,
  unpackZipArchive,
  updateDownloadHeaders,
} from './app-update-install.mjs'

const TEAM = DEVELOPER_ID_TEAM

function sha512(bytes) {
  return createHash('sha512').update(bytes).digest('base64')
}

function headerMap(map = {}) {
  const lower = new Map(Object.entries(map).map(([key, value]) => [key.toLowerCase(), value]))
  return { get: (name) => lower.get(String(name).toLowerCase()) ?? null }
}

function httpResponse({ status = 200, location, body = Buffer.alloc(0), contentLength } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const headers = {}
  if (location) headers.location = location
  if (contentLength !== undefined) headers['content-length'] = String(contentLength)
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: headerMap(headers),
    bodyBuffer: buf,
    text: async () => buf.toString('utf8'),
  }
}

function yml(version, files) {
  const lines = [`version: ${version}`, 'files:']
  for (const file of files) {
    lines.push(`  - url: ${file.name}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`)
  }
  return `${lines.join('\n')}\n`
}

function infoPlist(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
</dict></plist>
`
}

function writeUpdateApp(dest, version) {
  const contents = path.join(dest, 'Font Buttler.app', 'Contents')
  mkdirSync(contents, { recursive: true })
  writeFileSync(path.join(contents, 'Info.plist'), infoPlist(version))
}

async function writeUpdatePackageJson(dest, pkg) {
  const src = path.join(dest, 'asar-src')
  mkdirSync(src, { recursive: true })
  writeFileSync(path.join(src, 'package.json'), JSON.stringify(pkg))
  const resources = path.join(dest, 'Font Buttler.app', 'Contents', 'Resources')
  mkdirSync(resources, { recursive: true })
  const asar = await import('@electron/asar')
  await asar.createPackage(src, path.join(resources, 'app.asar'))
}

function signedRuntime(extra = {}) {
  return {
    packaged: true,
    developerId: true,
    teamId: TEAM,
    adhoc: false,
    signatureUnreadable: false,
    translocated: false,
    readOnly: false,
    bundleWritable: true,
    appPath: '/Applications/Font Buttler.app',
    ...extra,
  }
}

function releaseJson(version, extraAssets = []) {
  const tag = `v${version}`
  const base = `https://github.com/displaay/font-butler/releases/download/${tag}`
  const names = [
    macArm64ArchiveName(version, 'dmg'),
    macArm64ArchiveName(version, 'zip'),
    'latest-mac.yml',
    ...extraAssets,
  ]
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: names.map((name) => ({ name, browser_download_url: `${base}/${name}` })),
  }
}

test('install mode follows the running signature, not the version', () => {
  assert.equal(selectInstallMode(signedRuntime()), 'inplace')
  assert.equal(selectInstallMode(signedRuntime({ packaged: false })), 'dmg')
  assert.equal(selectInstallMode(signedRuntime({ developerId: false, adhoc: true })), 'dmg')
  assert.equal(selectInstallMode(signedRuntime({ developerId: false, teamId: null })), 'dmg')
  assert.equal(selectInstallMode(signedRuntime({ teamId: 'OTHERTEAM1' })), 'dmg')
  assert.equal(
    selectInstallMode(signedRuntime({ translocated: true, appPath: '/private/var/folders/x/T/AppTranslocation/ABC/d/Font Buttler.app' })),
    'dmg',
  )
  assert.equal(selectInstallMode(signedRuntime({ readOnly: true })), 'dmg')
  assert.equal(selectInstallMode(signedRuntime({ bundleWritable: false })), 'dmg')
  assert.equal(selectInstallMode(undefined), 'dmg')
})

test('asset selection is an exact arm64 archive name', () => {
  const version = '0.3.9'
  const dmg = macArm64ArchiveName(version, 'dmg')
  const assets = [
    { name: `${dmg}.blockmap` },
    { name: 'Font-Buttler-0.3.90-arm64.dmg' },
    { name: 'Font-Buttler-0.3.9-x64.dmg' },
    { name: 'font-buttler-0.3.9-arm64.dmg' },
    { name: dmg, url: 'https://github.com/displaay/font-butler/releases/download/v0.3.9/Font-Buttler-0.3.9-arm64.dmg' },
    { name: macArm64ArchiveName(version, 'zip') },
    { name: 'latest-mac.yml' },
  ]
  const selected = selectExactArm64Assets(assets, version)
  assert.equal(selected.dmg?.name, 'Font-Buttler-0.3.9-arm64.dmg')
  assert.equal(selected.zip?.name, 'Font-Buttler-0.3.9-arm64.zip')
  assert.equal(selected.feed?.name, 'latest-mac.yml')
  assert.equal(selectExactArm64Assets([{ name: 'Font-Buttler-0.3.9-arm64.dmg.txt' }], version).dmg, null)
})

test('redirect policy allowlists GitHub release-asset hosts and checks every hop', () => {
  // Observed with curl -sI on a public release asset (electron v32.0.0 darwin arm64 zip):
  // HTTP 302 from github.com/.../releases/download/... to
  // https://release-assets.githubusercontent.com/github-production-release-asset/<id>/<uuid>?sp=r&sv=2018-11-09&...
  // Older assets redirected to objects.githubusercontent.com instead.
  const first = 'https://github.com/displaay/font-butler/releases/download/v0.3.9/Font-Buttler-0.3.9-arm64.dmg'
  const releaseAssets =
    'https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?sp=r&sv=2018-11-09&sr=b'
  const objects =
    'https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/abc?X-Amz-Algorithm=AWS4-HMAC-SHA256'
  assert.equal(isAllowedUpdateRequest(first, { hop: 0 }), true)
  assert.equal(isAllowedUpdateRequest(releaseAssets, { hop: 1 }), true)
  assert.equal(isAllowedUpdateRequest(objects, { hop: 1 }), true)
  assert.equal(isAllowedUpdateRequest(releaseAssets, { hop: 0 }), false)
  assert.equal(isAllowedUpdateRequest('https://evil.example/Font-Buttler-0.3.9-arm64.dmg', { hop: 1 }), false)
  assert.equal(isAllowedUpdateRequest('http://github.com/displaay/font-butler/releases/download/v0.3.9/a.dmg', { hop: 0 }), false)
  assert.equal(isAllowedUpdateRequest('https://github.com/displaay/other/releases/download/v0.3.9/a.dmg', { hop: 1 }), false)
  assert.equal(
    isAllowedUpdateRequest('http://127.0.0.1:9/feed/Font-Buttler-0.3.9-arm64.dmg', {
      hop: 0,
      feedOrigin: 'http://127.0.0.1:9',
    }),
    true,
  )
  assert.equal(
    isAllowedUpdateRequest(releaseAssets, { hop: 1, feedOrigin: 'http://127.0.0.1:9' }),
    false,
  )
  const headers = updateDownloadHeaders()
  assert.equal(headers.Authorization, undefined)
  assert.equal('authorization' in headers, false)
})

test('a checksum mismatch deletes the download and does not open or install it', async () => {
  const version = '0.4.0'
  const bytes = Buffer.from('not-the-real-bytes')
  const published = Buffer.from('the-real-dmg-bytes')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(published), size: published.length },
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(published), size: published.length },
  ])
  const opened = []
  const swaps = []
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-mismatch-'))
  const installer = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    env: { GITHUB_TOKEN: 'should-not-be-sent', FONT_BUTLER_GITHUB_TOKEN: 'also-not-sent' },
    probeRuntime: () => signedRuntime(),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    openPath: async (file) => {
      opened.push(file)
      return ''
    },
    spawnSwap: (swap) => {
      swaps.push(swap)
    },
    fetch: async (_url, init) => {
      assert.equal(init?.headers?.Authorization, undefined)
      if (_url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(_url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      return httpResponse({ body: bytes, contentLength: bytes.length })
    },
  })
  const result = await installer.start()
  assert.equal(result.ok, false)
  assert.match(result.error, /checksum/)
  assert.deepEqual(opened, [])
  assert.deepEqual(swaps, [])
  assert.equal(existsSync(dir), false)
})

test('an early write-stream error stays an installer error and removes the temp file', async () => {
  const version = '0.4.2'
  const bytes = Buffer.from('dmg-bytes-that-never-land')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(bytes), size: bytes.length },
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(bytes), size: bytes.length },
  ])
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-write-error-'))
  const dest = path.join(dir, macArm64ArchiveName(version, 'zip'))
  const removed = []
  const originalCreate = nodeFs.createWriteStream
  const originalRm = nodeFs.rmSync
  const unhandled = []
  const onException = (error) => {
    unhandled.push(error)
  }
  const onRejection = (error) => {
    unhandled.push(error)
  }
  nodeFs.createWriteStream = () => {
    const failure = Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
    const out = new Writable({
      write(_chunk, _encoding, callback) {
        out.once('error', () => callback(failure))
      },
    })
    process.nextTick(() => {
      out.destroy(failure)
    })
    return out
  }
  nodeFs.rmSync = function rmSyncSpy(target, options) {
    removed.push(String(target))
    return originalRm.call(this, target, options)
  }
  process.on('uncaughtException', onException)
  process.on('unhandledRejection', onRejection)
  const installer = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    env: {},
    probeRuntime: () => signedRuntime(),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    fetch: async (url) => {
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      return httpResponse({ body: bytes, contentLength: bytes.length })
    },
  })
  try {
    const result = await installer.start()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(result.ok, false)
    assert.equal(result.error, 'ENOSPC: no space left on device, write')
    assert.equal(installer.status().phase, 'error')
    assert.equal(existsSync(dest), false)
    assert.equal(existsSync(dir), false)
    assert.equal(removed.includes(dest), true)
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('uncaughtException', onException)
    process.off('unhandledRejection', onRejection)
    nodeFs.createWriteStream = originalCreate
    nodeFs.rmSync = originalRm
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a mid-download write error with no drain pending returns an installer error', async () => {
  const version = '0.4.3'
  const bytes = Buffer.from('partial-download-bytes')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(bytes), size: bytes.length },
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(bytes), size: bytes.length },
  ])
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-mid-write-'))
  const originalCreate = nodeFs.createWriteStream
  const unhandled = []
  const onException = (error) => {
    unhandled.push(error)
  }
  const onRejection = (error) => {
    unhandled.push(error)
  }
  nodeFs.createWriteStream = () => {
    const failure = Object.assign(new Error('EACCES: permission denied, write'), { code: 'EACCES' })
    const out = new Writable({
      highWaterMark: 1024 * 1024,
      write(_chunk, _encoding, callback) {
        callback()
        process.nextTick(() => {
          out.emit('error', failure)
        })
      },
    })
    return out
  }
  process.on('uncaughtException', onException)
  process.on('unhandledRejection', onRejection)
  const installer = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    env: {},
    probeRuntime: () => signedRuntime(),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    fetch: async (url) => {
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      return httpResponse({ body: bytes, contentLength: bytes.length })
    },
  })
  try {
    const result = await installer.start()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(result.ok, false)
    assert.equal(result.error, 'EACCES: permission denied, write')
    assert.equal(result.ignored, undefined)
    assert.equal(installer.status().phase, 'error')
    const second = await installer.start()
    assert.equal(second.ignored, undefined)
    assert.equal(second.ok, false)
    assert.equal(installer.status().phase, 'error')
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('uncaughtException', onException)
    process.off('unhandledRejection', onRejection)
    nodeFs.createWriteStream = originalCreate
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an evil redirect is refused before the body is saved', async () => {
  const version = '0.4.1'
  const published = Buffer.from('dmg-bytes')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(published), size: published.length },
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(published), size: published.length },
  ])
  const seen = []
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-redirect-'))
  const installer = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    env: {},
    probeRuntime: () => signedRuntime({ packaged: false }),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    openPath: async () => '',
    fetch: async (url) => {
      seen.push(url)
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      if (String(url).startsWith('https://github.com/')) {
        return httpResponse({ status: 302, location: 'https://evil.example/stolen.dmg' })
      }
      return httpResponse({ body: published })
    },
  })
  const result = await installer.start()
  assert.equal(result.ok, false)
  assert.match(result.error, /Blocked update URL/)
  assert.equal(seen.some((url) => url.startsWith('https://evil.example/')), false)
  assert.equal(existsSync(dir), false)
})

test('a real release-asset redirect hop is followed only after the host is allowlisted', async () => {
  const version = '0.4.2'
  const published = Buffer.from('verified-dmg')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(published), size: published.length },
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(Buffer.from('zip')), size: 3 },
  ])
  const cdn =
    'https://release-assets.githubusercontent.com/github-production-release-asset/9384267/abc?sp=r&sv=2018-11-09'
  const seen = []
  let opened = ''
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-cdn-'))
  const installer = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    env: {},
    probeRuntime: () => signedRuntime({ packaged: false, developerId: false, teamId: null }),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    openPath: async (file) => {
      opened = file
      return ''
    },
    fetch: async (url) => {
      seen.push(url)
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      if (String(url).startsWith('https://github.com/')) {
        return httpResponse({ status: 302, location: cdn })
      }
      assert.equal(url, cdn)
      return httpResponse({ body: published, contentLength: published.length })
    },
  })
  const result = await installer.start()
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'dmg')
  assert.equal(seen.at(-2)?.startsWith('https://github.com/displaay/font-butler/'), true)
  assert.equal(seen.at(-1), cdn)
  assert.match(opened, /Font-Buttler-0\.4\.2-arm64\.dmg$/)
  assert.equal(existsSync(opened), true)
  rmSync(path.dirname(opened), { recursive: true, force: true })
})

test('a second click is ignored while a download is in progress', async () => {
  const version = '0.4.3'
  const published = Buffer.from('dmg')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(published), size: published.length },
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(published), size: published.length },
  ])
  let releaseDownload
  let assetFetches = 0
  const installer = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    env: {},
    probeRuntime: () => signedRuntime({ packaged: false }),
    makeTempDir: () => mkdtempSync(path.join(os.tmpdir(), 'font-butler-busy-')),
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    openPath: async () => '',
    fetch: async (url) => {
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      assetFetches += 1
      await new Promise((resolve) => {
        releaseDownload = resolve
      })
      return httpResponse({ body: published, contentLength: published.length })
    },
  })
  const first = installer.start()
  const second = await installer.start()
  assert.equal(second.ignored, true)
  assert.equal(second.ok, false)
  for (let attempt = 0; attempt < 20 && !releaseDownload; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(typeof releaseDownload, 'function')
  releaseDownload()
  const result = await first
  assert.equal(result.ok, true)
  assert.equal(assetFetches, 1)
  assert.equal(installer.status().phase, 'idle')
})

test('a second start while the disk image is opening returns that phase', async () => {
  const version = '0.4.31'
  const published = Buffer.from('dmg-opening')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(published), size: published.length },
  ])
  let releaseOpen
  let markOpenCalled
  const openCalled = new Promise((resolve) => {
    markOpenCalled = resolve
  })
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-opening-'))
  const record = path.join(dir, 'opened.json')
  const installer = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    env: {},
    probeRuntime: () => signedRuntime({ packaged: false }),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    rememberOpenedDmg: (entry) => rememberOpenedDmg(entry, record),
    openPath: () =>
      new Promise((resolve) => {
        releaseOpen = () => resolve('')
        markOpenCalled()
      }),
    fetch: async (url) => {
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      return httpResponse({ body: published, contentLength: published.length })
    },
  })
  const first = installer.start()
  await Promise.race([openCalled, first])
  assert.equal(installer.status().phase, 'opening')
  const second = await installer.start()
  assert.equal(second.ok, false)
  assert.equal(second.ignored, true)
  assert.equal(second.phase, 'opening')
  assert.equal(typeof releaseOpen, 'function')
  releaseOpen()
  const result = await first
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'dmg')
  assert.equal(installer.status().phase, 'idle')
  rmSync(dir, { recursive: true, force: true })
})

test('a signed packaged app installs the zip in place and an ad-hoc app opens the dmg', async () => {
  const version = '0.4.4'
  const zipBytes = Buffer.from('zip-bytes')
  const dmgBytes = Buffer.from('dmg-bytes')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(dmgBytes), size: dmgBytes.length },
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(zipBytes), size: zipBytes.length },
  ])
  const release = releaseJson(version, [
    'Font-Buttler-0.4.4-arm64.dmg.blockmap',
    'Font-Buttler-0.4.40-arm64.dmg',
    'Font-Buttler-0.4.4-x64.dmg',
  ])

  async function run(runtime) {
    const swaps = []
    const opened = []
    const downloaded = []
    let verified = 0
    const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-mode-'))
    const installer = createAppUpdateInstaller({
    currentVersion: '0.0.0',
      env: { GITHUB_TOKEN: 'nope' },
      probeRuntime: () => runtime,
      makeTempDir: () => dir,
      removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
      unzip: async (_zip, dest) => {
        writeFileSync(path.join(dest, 'readme.txt'), 'unpacked')
        writeUpdateApp(dest, `v${version}`)
        await writeUpdatePackageJson(dest, { name: 'font-butler', version })
      },
      verifyDownloadedApp: async () => {
        verified += 1
        return { ok: true }
      },
      openPath: async (file) => {
        opened.push(file)
        return ''
      },
      spawnSwap: (swap) => swaps.push(swap),
      quit: () => {},
      pid: 4242,
      fetch: async (url, init) => {
        assert.equal(init?.headers?.Authorization, undefined)
        downloaded.push(url)
        if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(release) })
        if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
        const name = String(url).split('/').at(-1)
        const body = name?.endsWith('.zip') ? zipBytes : dmgBytes
        return httpResponse({ body, contentLength: body.length })
      },
    })
    const result = await installer.start()
    return { result, swaps, opened, downloaded, verified, dir }
  }

  const inplace = await run(signedRuntime())
  assert.equal(inplace.result.mode, 'inplace')
  assert.equal(inplace.verified, 1)
  assert.equal(inplace.swaps.length, 1)
  assert.match(inplace.swaps[0].script, /mv .*Font Buttler\.app/)
  assert.match(inplace.swaps[0].script, /font-butler-previous/)
  assert.equal(inplace.opened.length, 0)
  assert.equal(inplace.downloaded.some((url) => url.endsWith('/Font-Buttler-0.4.4-arm64.zip')), true)
  assert.equal(inplace.downloaded.some((url) => url.includes('0.4.40')), false)
  assert.equal(inplace.downloaded.some((url) => url.includes('x64')), false)
  rmSync(inplace.dir, { recursive: true, force: true })

  const adhoc = await run(signedRuntime({ developerId: false, adhoc: true, teamId: null }))
  assert.equal(adhoc.result.mode, 'dmg')
  assert.equal(adhoc.swaps.length, 0)
  assert.equal(adhoc.verified, 0)
  assert.equal(adhoc.opened.length, 1)
  assert.match(adhoc.opened[0], /Font-Buttler-0\.4\.4-arm64\.dmg$/)
  rmSync(path.dirname(adhoc.opened[0]), { recursive: true, force: true })
})

test('a failed signature check does not swap the running app', async () => {
  const version = '0.4.5'
  const zipBytes = Buffer.from('zip-bytes')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(zipBytes), size: zipBytes.length },
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(zipBytes), size: zipBytes.length },
  ])
  const swaps = []
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-sig-'))
  const installer = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    env: {},
    probeRuntime: () => signedRuntime(),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    unzip: async (_zip, dest) => {
      const { mkdirSync } = await import('node:fs')
      mkdirSync(path.join(dest, 'Font Buttler.app'))
    },
    verifyDownloadedApp: async () => ({ ok: false, reason: 'The downloaded app has no notarization staple.' }),
    spawnSwap: (swap) => swaps.push(swap),
    quit: () => {
      throw new Error('quit should not run')
    },
    fetch: async (url) => {
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      return httpResponse({ body: zipBytes, contentLength: zipBytes.length })
    },
  })
  const result = await installer.start()
  assert.equal(result.ok, false)
  assert.match(result.error, /staple/)
  assert.deepEqual(swaps, [])
  assert.equal(existsSync(dir), false)
})

test('a signed zip whose bundle version is not the feed version is not installed', async () => {
  const version = '0.4.8'
  const stale = '0.3.0'
  const zipBytes = Buffer.from('stale-zip')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(zipBytes), size: zipBytes.length },
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(zipBytes), size: zipBytes.length },
  ])
  const swaps = []
  const phases = []
  let quit = false
  const root = mkdtempSync(path.join(os.tmpdir(), 'font-butler-stale-'))
  const dir = path.join(root, 'download')
  const current = path.join(root, 'running.app')
  mkdirSync(dir)
  mkdirSync(current)
  const installer = createAppUpdateInstaller({
    currentVersion: '0.4.0',
    env: {},
    probeRuntime: () => signedRuntime({ appPath: current }),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    unzip: async (_zip, dest) => {
      writeUpdateApp(dest, stale)
    },
    verifyDownloadedApp: async () => ({ ok: true }),
    spawnSwap: (swap) => swaps.push(swap),
    quit: () => {
      quit = true
    },
    onProgress: (payload) => phases.push(payload.phase),
    fetch: async (url) => {
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      return httpResponse({ body: zipBytes, contentLength: zipBytes.length })
    },
  })
  const result = await installer.start()
  assert.equal(result.ok, false)
  assert.match(result.error, new RegExp(`The downloaded app is ${stale}, not ${version}`))
  assert.deepEqual(swaps, [])
  assert.equal(quit, false)
  assert.equal(phases.includes('installing'), false)
  assert.equal(existsSync(current), true)
  assert.equal(existsSync(dir), false)
  assert.equal(installer.status().phase, 'error')
  rmSync(root, { recursive: true, force: true })
})

test('a temp directory failure leaves the installer idle so the next start is not ignored', async () => {
  let created = 0
  const removed = []
  const installer = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    probeRuntime: () => signedRuntime(),
    makeTempDir: () => {
      created += 1
      if (created === 1) throw new Error('temp directory could not be created')
      return mkdtempSync(path.join(os.tmpdir(), 'font-butler-retry-'))
    },
    removeTemp: (target) => {
      removed.push(target)
      rmSync(target, { recursive: true, force: true })
    },
    fetch: async () => {
      throw new Error('feed unavailable')
    },
  })
  const first = await installer.start()
  assert.equal(first.ok, false)
  assert.equal(first.ignored, undefined)
  assert.match(first.error, /temp directory could not be created/)
  assert.deepEqual(installer.status(), { phase: 'idle' })
  assert.deepEqual(removed, [])
  const second = await installer.start()
  assert.equal(second.ignored, undefined)
  assert.equal(second.ok, false)
  assert.match(second.error, /feed unavailable/)
  assert.equal(created, 2)
  assert.equal(installer.status().phase, 'error')
  assert.equal(removed.length, 1)
})

test('readBundleShortVersion reads CFBundleShortVersionString and converts a binary plist', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'font-butler-plist-'))
  const app = path.join(root, 'Font Buttler.app')
  const plistPath = path.join(app, 'Contents', 'Info.plist')
  mkdirSync(path.dirname(plistPath), { recursive: true })
  writeFileSync(plistPath, infoPlist('0.4.4'))
  assert.equal(readBundleShortVersion(app), '0.4.4')
  writeFileSync(plistPath, Buffer.concat([Buffer.from('bplist00'), Buffer.from([0])]))
  assert.equal(
    readBundleShortVersion(app, () => ({ status: 0, stdout: infoPlist('0.9.1') })),
    '0.9.1',
  )
  assert.throws(
    () => readBundleShortVersion(app, () => ({ status: 1, stdout: '' })),
    /could not be read/,
  )
  rmSync(root, { recursive: true, force: true })
})

test('the swap script restores the previous app if the new bundle cannot be moved', () => {
  const script = buildMacSwapScript({
    pid: 50,
    currentApp: '/Applications/Font Buttler.app',
    nextApp: '/tmp/next/Font Buttler.app',
    tempDir: '/tmp/font-butler-update',
    scriptPath: '/tmp/font-butler-swap.sh',
  })
  assert.match(script, /mv '\/tmp\/next\/Font Buttler.app' '\/Applications\/Font Buttler.app'/)
  assert.match(script, /mv '\/Applications\/Font Buttler.app.font-butler-previous' '\/Applications\/Font Buttler.app'/)
  assert.match(script, /open '\/Applications\/Font Buttler.app'/)
  assert.match(script, /trap 'reopen_original; exit 1' ERR/)
  const reopen = script.slice(script.indexOf('reopen_original() {'), script.indexOf("trap 'reopen_original"))
  const removePartial = reopen.indexOf("rm -rf '/Applications/Font Buttler.app'")
  const restoreBackup = reopen.indexOf(
    "mv '/Applications/Font Buttler.app.font-butler-previous' '/Applications/Font Buttler.app'",
  )
  assert.ok(removePartial !== -1 && restoreBackup > removePartial)
  assert.match(
    reopen,
    /"\$moved" -eq 1 && -d '\/Applications\/Font Buttler.app.font-butler-previous'/,
  )
  assert.match(script, /if ! mv '\/tmp\/next\/Font Buttler.app' '\/Applications\/Font Buttler.app'; then\n  reopen_original/)
  assert.throws(() => buildMacSwapScript({ pid: 0, currentApp: '/a', nextApp: '/b', tempDir: '/t', scriptPath: '/s' }))
})

test('a marked swap relaunches with open -n and an unmarked swap keeps plain open', () => {
  const args = {
    pid: 50,
    currentApp: '/Applications/Font Buttler Test/Font Buttler.app',
    nextApp: '/tmp/next/Font Buttler.app',
    tempDir: '/tmp/font-butler-update',
    scriptPath: '/tmp/font-butler-swap.sh',
  }
  const openLines = (script) =>
    script
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('open '))
  const marked = buildMacSwapScript({ ...args, testFeedBuild: true })
  const unmarked = buildMacSwapScript(args)
  const quoted = "'/Applications/Font Buttler Test/Font Buttler.app'"
  assert.deepEqual(openLines(marked), [`open -n ${quoted} || true`, `open -n ${quoted}`])
  assert.deepEqual(openLines(unmarked), [`open ${quoted} || true`, `open ${quoted}`])
  assert.equal(marked.includes('open -n'), true)
  assert.equal(unmarked.includes('open -n'), false)
  const markedRestore = marked.slice(marked.indexOf('reopen_original() {'), marked.indexOf("trap 'reopen_original"))
  const unmarkedRestore = unmarked.slice(unmarked.indexOf('reopen_original() {'), unmarked.indexOf("trap 'reopen_original"))
  assert.match(markedRestore, /open -n /)
  assert.doesNotMatch(unmarkedRestore, /open -n /)
  assert.match(marked, /open -n '[^']+'\nmoved=0\n/)
  assert.match(unmarked, /open '[^']+'\nmoved=0\n/)
  assert.doesNotMatch(unmarked, /open -n /)
})

function runSwapFailure(fail, { testFeedBuild = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'font-butler-swap-'))
  const bin = path.join(root, 'bin')
  const current = path.join(root, 'Font Buttler.app')
  const next = path.join(root, 'next.app')
  const tempDir = path.join(root, 'temp')
  mkdirSync(bin)
  mkdirSync(current)
  mkdirSync(next)
  mkdirSync(tempDir)
  writeFileSync(path.join(current, 'marker'), 'original')
  writeFileSync(path.join(next, 'marker'), 'new')
  const backup = `${current}.font-butler-previous`
  const before = statSync(current)
  const markerBefore = statSync(path.join(current, 'marker'))
  const openLog = path.join(root, 'opened')
  writeFileSync(
    path.join(bin, 'mv'),
    `#!/bin/bash
if [[ ${JSON.stringify(fail)} == "aside" && "$1" == ${JSON.stringify(current)} && "$2" == ${JSON.stringify(backup)} ]]; then
  exit 1
fi
if [[ "$1" == ${JSON.stringify(next)} ]]; then
  if [[ ${JSON.stringify(fail)} == "mv" ]]; then
    exit 1
  fi
  if [[ ${JSON.stringify(fail)} == "partial" ]]; then
    mkdir -p "$2"
    printf 'partial\\n' > "$2/marker"
    exit 1
  fi
fi
exec /bin/mv "$@"
`,
  )
  writeFileSync(
    path.join(bin, 'rm'),
    `#!/bin/bash
if [[ ${JSON.stringify(fail)} == "rm" ]]; then
  exit 1
fi
exec /bin/rm "$@"
`,
  )
  writeFileSync(
    path.join(bin, 'open'),
    `#!/bin/bash
target="$1"
if [[ "$1" == "-n" ]]; then
  target="$2"
fi
marker=""
if [[ -f "$target/marker" ]]; then
  marker=$(cat "$target/marker")
fi
if [[ ${JSON.stringify(fail)} == "open" && "$marker" == "new" ]]; then
  exit 1
fi
printf '%s\\n' "$target" >> ${JSON.stringify(openLog)}
`,
  )
  for (const name of ['mv', 'rm', 'open']) chmodSync(path.join(bin, name), 0o755)
  const dead = spawnSync('/bin/bash', ['-c', 'echo $$'], { encoding: 'utf8' })
  const pid = Number(dead.stdout.trim())
  const scriptPath = path.join(root, 'swap.sh')
  writeFileSync(
    scriptPath,
    buildMacSwapScript({ pid, currentApp: current, nextApp: next, tempDir, scriptPath, testFeedBuild }),
    { mode: 0o700 },
  )
  const result = spawnSync('/bin/bash', [scriptPath], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
  const opened = existsSync(openLog) ? readFileSync(openLog, 'utf8').trim().split('\n') : []
  const markerPath = path.join(current, 'marker')
  const marker = existsSync(markerPath) ? readFileSync(markerPath, 'utf8') : ''
  return {
    result,
    opened,
    marker,
    current,
    root,
    before,
    markerBefore,
    after: existsSync(current) ? statSync(current) : null,
    markerAfter: existsSync(markerPath) ? statSync(markerPath) : null,
  }
}

test('a failing mv or rm reopens the original app', () => {
  const moved = runSwapFailure('mv')
  try {
    assert.notEqual(moved.result.status, 0)
    assert.equal(moved.marker, 'original')
    assert.deepEqual(moved.opened, [moved.current])
  } finally {
    rmSync(moved.root, { recursive: true, force: true })
  }
  const removed = runSwapFailure('rm')
  try {
    assert.notEqual(removed.result.status, 0)
    assert.equal(removed.marker, 'original')
    assert.deepEqual(removed.opened, [removed.current])
    assert.equal(existsSync(`${removed.current}.font-butler-previous`), false)
  } finally {
    rmSync(removed.root, { recursive: true, force: true })
  }
})

test('a failing final open restores and reopens the original bundle', () => {
  for (const testFeedBuild of [false, true]) {
    const failed = runSwapFailure('open', { testFeedBuild })
    try {
      assert.notEqual(failed.result.status, 0, failed.result.stderr)
      assert.equal(failed.marker, 'original')
      assert.deepEqual(failed.opened, [failed.current])
      assert.equal(existsSync(`${failed.current}.font-butler-previous`), false)
    } finally {
      rmSync(failed.root, { recursive: true, force: true })
    }
  }
})

test('a failed move aside leaves the original bundle untouched', () => {
  const aside = runSwapFailure('aside')
  try {
    assert.notEqual(aside.result.status, 0)
    assert.equal(aside.marker, 'original')
    assert.equal(aside.after?.ino, aside.before.ino)
    assert.equal(aside.markerAfter?.ino, aside.markerBefore.ino)
    assert.equal(existsSync(`${aside.current}.font-butler-previous`), false)
    assert.deepEqual(aside.opened, [aside.current])
  } finally {
    rmSync(aside.root, { recursive: true, force: true })
  }
})

test('rollback removes a partial destination before restoring the backup', () => {
  const partial = runSwapFailure('partial')
  try {
    assert.notEqual(partial.result.status, 0)
    assert.equal(partial.marker, 'original')
    assert.deepEqual(partial.opened, [partial.current])
    assert.equal(existsSync(`${partial.current}.font-butler-previous`), false)
    assert.equal(
      existsSync(path.join(partial.current, `${path.basename(partial.current)}.font-butler-previous`)),
      false,
    )
  } finally {
    rmSync(partial.root, { recursive: true, force: true })
  }
})

test('an equal or older release is not downloaded', async () => {
  const version = '0.4.8'
  const bytes = Buffer.from('should-not-download')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(bytes), size: bytes.length },
  ])
  for (const currentVersion of [version, '0.4.9']) {
    const fetched = []
    const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-older-'))
    const installer = createAppUpdateInstaller({
      currentVersion,
      env: {},
      probeRuntime: () => signedRuntime({ packaged: false }),
      makeTempDir: () => dir,
      removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
      openPath: async () => {
        throw new Error('open should not run')
      },
      fetch: async (url) => {
        fetched.push(String(url))
        if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
        if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
        return httpResponse({ body: bytes, contentLength: bytes.length })
      },
    })
    const result = await installer.start()
    assert.equal(result.ok, false)
    assert.match(result.error, /will not install/)
    assert.equal(fetched.some((url) => url.endsWith('.dmg') || url.endsWith('.zip')), false)
    assert.equal(existsSync(dir), false)
  }
  assert.equal(isNewerVersion('0.3.9', '0.3.9'), false)
  assert.equal(isNewerVersion('0.3.8', '0.3.9'), false)
  assert.equal(isNewerVersion('0.3.9', '0.3.8'), true)
  assert.equal(isNewerVersion('0.3.9', '0.3.8'), sharedIsNewerVersion('0.3.9', '0.3.8'))
  assert.equal(isNewerVersion('1.0.0-beta', '1.0.0'), sharedIsNewerVersion('1.0.0-beta', '1.0.0'))
})

test('download progress is reported only when the whole-number percent changes', async () => {
  const version = '0.4.9'
  const size = 1000
  const bytes = Buffer.alloc(size, 1)
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(bytes), size },
  ])
  const progress = []
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-percent-'))
  const installer = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    env: {},
    probeRuntime: () => signedRuntime({ packaged: false }),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    isDmgMounted: async () => false,
    openPath: async () => '',
    fetch: async (url) => {
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      const chunks = [bytes.subarray(0, 1), bytes.subarray(1, 2), bytes.subarray(2, 12), bytes.subarray(12)]
      return {
        status: 200,
        ok: true,
        headers: headerMap({ 'content-length': String(size) }),
        stream: (async function* () {
          for (const chunk of chunks) yield chunk
        })(),
      }
    },
    onProgress: (payload) => progress.push(payload),
  })
  const result = await installer.start()
  assert.equal(result.ok, true)
  assert.deepEqual(
    progress.filter((payload) => payload.phase === 'downloading').map((payload) => payload.percent),
    [0, 1, 100],
  )
})

test('opening a DMG does not delete it', async () => {
  const version = '0.5.0'
  const bytes = Buffer.from('dmg-bytes-ok')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(bytes), size: bytes.length },
  ])
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-dmg-open-'))
  const recordDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-dmg-record-'))
  const record = path.join(recordDir, 'opened-dmgs.json')
  let opened = ''
  try {
    const result = await createAppUpdateInstaller({
      currentVersion: '0.0.0',
      env: {},
      probeRuntime: () => signedRuntime({ packaged: false }),
      makeTempDir: () => tempDir,
      removeTemp: () => {
        throw new Error('the DMG must stay on disk after openPath')
      },
      rememberOpenedDmg: (entry) => rememberOpenedDmg(entry, record),
      openPath: async (file) => {
        opened = file
        return ''
      },
      fetch: async (url) => {
        if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
        if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
        return httpResponse({ body: bytes, contentLength: bytes.length })
      },
    }).start()
    assert.equal(result.ok, true)
    assert.equal(existsSync(opened), true)
    assert.equal(existsSync(tempDir), true)
    const saved = JSON.parse(readFileSync(record, 'utf8'))
    assert.deepEqual(saved, [{ dmg: opened, tempDir }])
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
    rmSync(recordDir, { recursive: true, force: true })
  }
})

test('the next launch deletes an opened DMG that is not mounted', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-update-'))
  const dmg = path.join(tempDir, 'Font-Buttler-0.3.9-arm64.dmg')
  writeFileSync(dmg, 'left-behind')
  const recordDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-dmg-unmounted-record-'))
  const record = path.join(recordDir, 'opened-dmgs.json')
  rememberOpenedDmg({ dmg, tempDir }, record)
  try {
    assert.equal(
      isUpdateDmgMounted(path.join(tempDir, 'missing.dmg'), () => ({
        status: 0,
        stdout: 'image-path: /tmp/missing.dmg\n',
        stderr: '',
      })),
      false,
    )
    const still = cleanupOpenedUpdateDmgs({
      recordFile: record,
      isMounted: (file) =>
        isUpdateDmgMounted(file, () => ({ status: 0, stdout: 'image-path: /other/disk.dmg\n', stderr: '' })),
    })
    assert.deepEqual(still, [])
    assert.equal(existsSync(dmg), false)
    assert.equal(existsSync(tempDir), false)
    assert.equal(existsSync(record), false)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
    rmSync(recordDir, { recursive: true, force: true })
  }
})

test('opened DMG cleanup does not delete a temp dir that is not a direct child of the temp directory', () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'font-butler-sibling-parent-'))
  const tempDir = path.join(parent, 'font-butler-update-sibling')
  mkdirSync(tempDir)
  const dmg = path.join(tempDir, 'Font-Buttler.dmg')
  const keep = path.join(tempDir, 'keep.txt')
  writeFileSync(dmg, 'keep-dmg')
  writeFileSync(keep, 'keep-dir')
  const record = path.join(parent, 'opened-dmgs.json')
  writeFileSync(record, JSON.stringify([{ dmg, tempDir }]))
  try {
    const still = cleanupOpenedUpdateDmgs({ recordFile: record, isMounted: () => false })
    assert.deepEqual(still, [])
    assert.equal(readFileSync(keep, 'utf8'), 'keep-dir')
    assert.equal(readFileSync(dmg, 'utf8'), 'keep-dmg')
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test('opened DMG cleanup does not delete through a symlink temp dir', () => {
  const realDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-update-target-'))
  const link = path.join(os.tmpdir(), `font-butler-update-link-${process.pid}-${Date.now()}`)
  symlinkSync(realDir, link)
  const dmg = path.join(realDir, 'Font-Buttler.dmg')
  const keep = path.join(realDir, 'keep.txt')
  writeFileSync(dmg, 'keep-dmg')
  writeFileSync(keep, 'keep-dir')
  const recordDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-link-record-'))
  const record = path.join(recordDir, 'opened-dmgs.json')
  writeFileSync(record, JSON.stringify([{ dmg, tempDir: link }]))
  try {
    cleanupOpenedUpdateDmgs({ recordFile: record, isMounted: () => false })
    assert.equal(lstatSync(link).isSymbolicLink(), true)
    assert.equal(existsSync(realDir), true)
    assert.equal(readFileSync(keep, 'utf8'), 'keep-dir')
    assert.equal(readFileSync(dmg, 'utf8'), 'keep-dmg')
  } finally {
    rmSync(link, { force: true })
    rmSync(realDir, { recursive: true, force: true })
    rmSync(recordDir, { recursive: true, force: true })
  }
})

test('opened DMG cleanup does not delete a temp dir with the wrong prefix', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-not-update-'))
  const dmg = path.join(tempDir, 'Font-Buttler.dmg')
  writeFileSync(dmg, 'keep-dmg')
  const recordDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-prefix-record-'))
  const record = path.join(recordDir, 'opened-dmgs.json')
  writeFileSync(record, JSON.stringify([{ dmg, tempDir }]))
  try {
    cleanupOpenedUpdateDmgs({ recordFile: record, isMounted: () => false })
    assert.equal(existsSync(tempDir), true)
    assert.equal(readFileSync(dmg, 'utf8'), 'keep-dmg')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
    rmSync(recordDir, { recursive: true, force: true })
  }
})

test('opened DMG cleanup does not delete a disk image outside its temp dir', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-update-'))
  const outside = mkdtempSync(path.join(os.tmpdir(), 'font-butler-outside-dmg-'))
  const dmg = path.join(outside, 'Font-Buttler.dmg')
  const keep = path.join(tempDir, 'keep.txt')
  writeFileSync(dmg, 'keep-dmg')
  writeFileSync(keep, 'keep-dir')
  const record = path.join(outside, 'opened-dmgs.json')
  writeFileSync(record, JSON.stringify([{ dmg, tempDir }]))
  try {
    cleanupOpenedUpdateDmgs({ recordFile: record, isMounted: () => false })
    assert.equal(existsSync(tempDir), true)
    assert.equal(readFileSync(keep, 'utf8'), 'keep-dir')
    assert.equal(readFileSync(dmg, 'utf8'), 'keep-dmg')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('the next launch keeps a mounted DMG, including /var versus /private/var', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-update-'))
  const dmgName = 'Font-Buttler-0.3.9-arm64.dmg'
  const privateFile = path.join(tempDir, dmgName)
  writeFileSync(privateFile, 'mounted')
  const root = mkdtempSync(path.join(os.tmpdir(), 'font-butler-dmg-mounted-'))
  mkdirSync(path.join(root, 'private'))
  symlinkSync(tempDir, path.join(root, 'private', 'var'))
  symlinkSync(path.join(root, 'private', 'var'), path.join(root, 'var'))
  const recorded = path.join(root, 'var', dmgName)
  const record = path.join(root, 'opened-dmgs.json')
  rememberOpenedDmg({ dmg: recorded, tempDir }, record)
  try {
    assert.notEqual(recorded, privateFile)
    assert.equal(realpathSync(recorded), realpathSync(privateFile))
    const still = cleanupOpenedUpdateDmgs({
      recordFile: record,
      isMounted: (file) =>
        isUpdateDmgMounted(file, () => ({
          status: 0,
          stdout: `image-path      : ${privateFile}\n`,
          stderr: '',
        })),
    })
    assert.deepEqual(
      still.map((entry) => entry.dmg),
      [recorded],
    )
    assert.equal(existsSync(privateFile), true)
    assert.equal(readFileSync(privateFile, 'utf8'), 'mounted')
    assert.equal(existsSync(record), true)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('the update zip is unpacked with ditto -x -k', async () => {
  let seen
  await unpackZipArchive('/tmp/Font-Buttler-0.3.9-arm64.zip', '/tmp/out', (command, args) => {
    seen = [command, args]
    const child = new EventEmitter()
    child.unref = () => {}
    queueMicrotask(() => child.emit('exit', 0))
    return child
  })
  assert.deepEqual(seen, ['ditto', ['-x', '-k', '/tmp/Font-Buttler-0.3.9-arm64.zip', '/tmp/out']])
})

test('publish still rejects a feed that does not match the stapled files and an extra draft asset', () => {
  const assertSource = readFileSync(new URL('../scripts/assert-notarized-mac-release.mjs', import.meta.url), 'utf8')
  const uploadSource = readFileSync(new URL('../scripts/upload-mac-release.mjs', import.meta.url), 'utf8')
  assert.match(assertSource, /export async function updateFeedFailures/)
  assert.match(assertSource, /export async function assertNotarizedMacRelease/)
  assert.match(assertSource, /releaseFeedOverrideFailures\(\)/)
  assert.match(assertSource, /\.dmg\.blockmap/)
  assert.equal(typeof updateFeedFailures, 'function')
  assert.match(uploadSource, /extra assets/)
  assert.match(uploadSource, /This command does not delete assets/)
})

test('release builds ignore FONT_BUTLER_UPDATE_FEED_URL and other builds can use a local feed', async () => {
  const feed = 'http://127.0.0.1:9/feed/'
  assert.equal(resolveUpdateFeedUrl({ [APP_UPDATE_FEED_ENV]: feed }, signedRuntime()), null)
  assert.equal(
    resolveUpdateFeedUrl({ [APP_UPDATE_FEED_ENV]: feed }, signedRuntime({ signatureUnreadable: true, developerId: false, teamId: null })),
    null,
  )
  assert.equal(
    resolveUpdateFeedUrl({ [APP_UPDATE_FEED_ENV]: feed }, signedRuntime({ testFeedBuild: true })),
    feed,
  )
  assert.equal(
    normalizeTestFeedUrl('http://localhost:8765/feed'),
    'http://localhost:8765/feed/',
  )
  assert.equal(
    resolveUpdateFeedUrl(
      { [APP_UPDATE_FEED_ENV]: 'https://updates.example/feed' },
      signedRuntime({ testFeedBuild: true }),
    ),
    'https://updates.example/feed/',
  )
  assert.equal(
    resolveUpdateFeedUrl({ [APP_UPDATE_FEED_ENV]: 'file:///tmp/feed/' }, signedRuntime({ testFeedBuild: true })),
    null,
  )
  assert.equal(
    resolveUpdateFeedUrl({ [APP_UPDATE_FEED_ENV]: 'http://evil.example/feed/' }, signedRuntime({ testFeedBuild: true })),
    null,
  )
  assert.equal(resolveUpdateFeedUrl({ [APP_UPDATE_FEED_ENV]: feed }, signedRuntime({ packaged: false })), feed)
  assert.equal(
    resolveUpdateFeedUrl({ [APP_UPDATE_FEED_ENV]: 'https://evil.example/feed/' }, { packaged: false }),
    null,
  )
  assert.deepEqual(releaseFeedOverrideFailures(), [])
  const assertSource = readFileSync(new URL('../scripts/assert-notarized-mac-release.mjs', import.meta.url), 'utf8')
  assert.match(assertSource, /releaseFeedOverrideFailures\(\)/)

  const version = '0.4.6'
  const dmg = Buffer.from('local-dmg')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(dmg), size: dmg.length },
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(dmg), size: dmg.length },
  ])
  const seen = []
  let opened = ''
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-feed-'))
  const local = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    env: { [APP_UPDATE_FEED_ENV]: feed, GITHUB_TOKEN: 'nope' },
    probeRuntime: () => signedRuntime({ packaged: false, developerId: false, teamId: null }),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    openPath: async (file) => {
      opened = file
      return ''
    },
    fetch: async (url, init) => {
      seen.push(url)
      assert.equal(init?.headers?.Authorization, undefined)
      if (url === `${feed}latest-mac.yml`) return httpResponse({ body: doc })
      if (url === `${feed}${macArm64ArchiveName(version, 'dmg')}`) {
        return httpResponse({ body: dmg, contentLength: dmg.length })
      }
      throw new Error(`unexpected ${url}`)
    },
  })
  const localResult = await local.start()
  assert.equal(localResult.mode, 'dmg')
  assert.equal(seen.includes(GITHUB_LATEST_API), false)
  assert.match(opened, /Font-Buttler-0\.4\.6-arm64\.dmg$/)
  rmSync(path.dirname(opened), { recursive: true, force: true })

  const releaseSeen = []
  const published = Buffer.from('github-dmg')
  const githubDoc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(published), size: published.length },
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(published), size: published.length },
  ])
  const releaseDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-release-feed-'))
  const releaseInstaller = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    env: { [APP_UPDATE_FEED_ENV]: feed },
    probeRuntime: () => signedRuntime(),
    makeTempDir: () => releaseDir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    unzip: async (_zip, dest) => {
      writeUpdateApp(dest, version)
      await writeUpdatePackageJson(dest, { name: 'font-butler', version })
    },
    verifyDownloadedApp: async () => ({ ok: true }),
    spawnSwap: () => {},
    quit: () => {},
    pid: 7,
    fetch: async (url) => {
      releaseSeen.push(url)
      if (String(url).includes('127.0.0.1')) throw new Error('release build used the local feed')
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: githubDoc })
      return httpResponse({ body: published, contentLength: published.length })
    },
  })
  const releaseResult = await releaseInstaller.start()
  assert.equal(releaseResult.mode, 'inplace')
  assert.equal(releaseSeen[0], GITHUB_LATEST_API)
  rmSync(releaseDir, { recursive: true, force: true })
})

test('parseLatestMacYml reads electron-builder sha512 and size', () => {
  const doc = parseLatestMacYml(`version: 0.3.9
files:
  - url: Font-Buttler-0.3.9-arm64.zip
    sha512: abc+/=
    size: 10
  - url: Font-Buttler-0.3.9-arm64.dmg
    sha512: def==
    size: 20
path: Font-Buttler-0.3.9-arm64.zip
sha512: abc+/=
`)
  assert.equal(doc.version, '0.3.9')
  assert.equal(doc.files[1].sha512, 'def==')
  assert.equal(doc.files[1].size, 20)
})

test('a file feed is confined to its directory', async () => {
  const version = '0.4.7'
  const dmg = Buffer.from('file-feed-dmg')
  const root = mkdtempSync(path.join(os.tmpdir(), 'font-butler-file-feed-'))
  const name = macArm64ArchiveName(version, 'dmg')
  writeFileSync(path.join(root, name), dmg)
  writeFileSync(
    path.join(root, 'latest-mac.yml'),
    yml(version, [
      { name, sha512: sha512(dmg), size: dmg.length },
      { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(dmg), size: dmg.length },
    ]),
  )
  const feed = pathToFileURL(root).href
  let opened = ''
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-file-install-'))
  const installer = createAppUpdateInstaller({
    currentVersion: '0.0.0',
    env: { [APP_UPDATE_FEED_ENV]: feed },
    probeRuntime: () => ({ packaged: false, developerId: false, teamId: null, bundleWritable: false }),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    openPath: async (file) => {
      opened = file
      return ''
    },
    fetch: async () => {
      throw new Error('file feed should not fetch')
    },
  })
  const result = await installer.start()
  assert.equal(result.ok, true)
  assert.match(opened, new RegExp(`${name}$`))
  rmSync(path.dirname(opened), { recursive: true, force: true })
  rmSync(root, { recursive: true, force: true })
})

test('readAppTestFeedMarker reads fontButlerTestFeed from the packaged asar', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'font-butler-marker-'))
  const src = path.join(root, 'pack')
  const app = path.join(root, 'Font Buttler.app')
  const resources = path.join(app, 'Contents', 'Resources')
  mkdirSync(src)
  mkdirSync(resources, { recursive: true })
  writeFileSync(
    path.join(src, 'package.json'),
    JSON.stringify({ name: 'font-butler', version: '0.3.9', fontButlerTestFeed: true }),
  )
  const asarPath = path.join(resources, 'app.asar')
  const asar = await import('@electron/asar')
  await asar.createPackage(src, asarPath)
  const packed = readAsarFile(readFileSync(asarPath), 'package.json')
  assert.equal(JSON.parse(packed.toString('utf8')).fontButlerTestFeed, true)
  assert.equal(readAppTestFeedMarker(app), true)
  writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'font-butler', version: '0.3.9' }))
  await asar.createPackage(src, asarPath)
  assert.equal(readAppTestFeedMarker(app), false)
  writeFileSync(asarPath, 'not-an-asar')
  assert.equal(readAppTestFeedMarker(app), null)
  rmSync(root, { recursive: true, force: true })
})

test('readAppTestFeedMarker reads app.asar when the Electron fs shim hides it', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'font-butler-marker-shim-'))
  const src = path.join(root, 'pack')
  const app = path.join(root, 'Font Buttler.app')
  const resources = path.join(app, 'Contents', 'Resources')
  mkdirSync(src)
  mkdirSync(resources, { recursive: true })
  writeFileSync(
    path.join(src, 'package.json'),
    JSON.stringify({ name: 'font-butler', version: '0.3.9', fontButlerTestFeed: true }),
  )
  const asarPath = path.join(resources, 'app.asar')
  const asar = await import('@electron/asar')
  await asar.createPackage(src, asarPath)
  const original = nodeFs.readFileSync
  nodeFs.readFileSync = function asarShim(file, ...args) {
    if (String(file).includes('.asar')) {
      const error = new Error(`ENOENT: no such file or directory, open '${file}'`)
      error.code = 'ENOENT'
      throw error
    }
    return original.call(this, file, ...args)
  }
  try {
    assert.throws(
      () => nodeFs.readFileSync(asarPath),
      (error) => error?.code === 'ENOENT',
    )
    assert.equal(readAppTestFeedMarker(app), true)
  } finally {
    nodeFs.readFileSync = original
    rmSync(root, { recursive: true, force: true })
  }
})

test('recursive update cleanup deletes an app.asar when the Electron fs shim would stop', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-update-'))
  const asarPath = path.join(tempDir, 'unpacked', 'Font Buttler.app', 'Contents', 'Resources', 'app.asar')
  const dmg = path.join(tempDir, 'update.dmg')
  const root = mkdtempSync(path.join(os.tmpdir(), 'font-butler-asar-rm-'))
  const record = path.join(root, 'opened.json')
  mkdirSync(path.dirname(asarPath), { recursive: true })
  writeFileSync(asarPath, 'asar-bytes')
  writeFileSync(dmg, 'dmg')
  writeFileSync(record, JSON.stringify([{ dmg, tempDir }]))
  const original = nodeFs.rmSync
  nodeFs.rmSync = function asarShim(target, options) {
    if (String(target).includes('.asar')) {
      const error = new Error(`ENOENT: no such file or directory, rm '${target}'`)
      error.code = 'ENOENT'
      throw error
    }
    if (options?.recursive) {
      const pending = [String(target)]
      while (pending.length) {
        const current = pending.pop()
        let entries = []
        try {
          entries = readdirSync(current, { withFileTypes: true })
        } catch {
          continue
        }
        for (const entry of entries) {
          const full = path.join(current, entry.name)
          if (full.includes('.asar')) {
            const error = new Error(`ENOENT: no such file or directory, rm '${full}'`)
            error.code = 'ENOENT'
            throw error
          }
          if (entry.isDirectory()) pending.push(full)
        }
      }
    }
    return original.call(this, target, options)
  }
  try {
    assert.throws(
      () => nodeFs.rmSync(tempDir, { recursive: true, force: true }),
      (error) => error?.code === 'ENOENT',
    )
    assert.equal(existsSync(asarPath), true)
    cleanupOpenedUpdateDmgs({ recordFile: record, isMounted: () => false })
    assert.equal(existsSync(asarPath), false)
  } finally {
    nodeFs.rmSync = original
    rmSync(tempDir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('a marked Developer ID build installs from the loopback feed instead of GitHub', async () => {
  const version = '0.9.0'
  const feed = 'http://127.0.0.1:8765/'
  const zipBytes = Buffer.from('marked-zip')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(zipBytes), size: zipBytes.length },
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(zipBytes), size: zipBytes.length },
  ])
  const seen = []
  const swaps = []
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-marked-'))
  const installer = createAppUpdateInstaller({
    currentVersion: '0.3.9',
    env: { [APP_UPDATE_FEED_ENV]: feed, GITHUB_TOKEN: 'nope' },
    probeRuntime: () => signedRuntime({ testFeedBuild: true }),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    unzip: async (_zip, dest) => {
      writeUpdateApp(dest, version)
      await writeUpdatePackageJson(dest, {
        name: 'font-butler',
        version,
        fontButlerTestFeed: true,
      })
    },
    verifyDownloadedApp: async () => ({ ok: true }),
    spawnSwap: (swap) => swaps.push(swap),
    quit: () => {},
    pid: 9,
    fetch: async (url) => {
      seen.push(url)
      if (url === `${feed}latest-mac.yml`) return httpResponse({ body: doc })
      if (url === `${feed}${macArm64ArchiveName(version, 'zip')}`) {
        return httpResponse({ body: zipBytes, contentLength: zipBytes.length })
      }
      throw new Error(`unexpected ${url}`)
    },
  })
  const result = await installer.start()
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'inplace')
  assert.equal(swaps.length, 1)
  assert.equal(seen.includes(GITHUB_LATEST_API), false)
  rmSync(dir, { recursive: true, force: true })
})

test('a marked build refuses an unmarked download and an unmarked build still swaps', async () => {
  const version = '0.9.1'
  const feed = 'http://127.0.0.1:8765/'
  const zipBytes = Buffer.from('unmarked-zip')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(zipBytes), size: zipBytes.length },
  ])
  async function run(runtime, { localFeed = true } = {}) {
    const swaps = []
    let quit = false
    const phases = []
    const logs = []
    const realError = console.error
    console.error = (...args) => {
      logs.push(args.map((part) => String(part?.message ?? part)).join(' '))
    }
    const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-marker-swap-'))
    const installer = createAppUpdateInstaller({
      currentVersion: '0.3.9',
      env: localFeed ? { [APP_UPDATE_FEED_ENV]: feed } : {},
      probeRuntime: () => runtime,
      makeTempDir: () => dir,
      removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
      unzip: async (_zip, dest) => {
        writeUpdateApp(dest, version)
        await writeUpdatePackageJson(dest, { name: 'font-butler', version })
      },
      verifyDownloadedApp: async () => ({ ok: true }),
      spawnSwap: (swap) => swaps.push(swap),
      quit: () => {
        quit = true
      },
      pid: 11,
      onProgress: (payload) => phases.push(payload.phase),
      fetch: async (url) => {
        if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
        if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
        if (String(url).endsWith(macArm64ArchiveName(version, 'zip'))) {
          return httpResponse({ body: zipBytes, contentLength: zipBytes.length })
        }
        throw new Error(`unexpected ${url}`)
      },
    })
    let result
    try {
      result = await installer.start()
    } finally {
      console.error = realError
    }
    return { result, swaps, quit, phases, logs, dir, phase: installer.status().phase, error: result.error }
  }

  const marked = await run(signedRuntime({ testFeedBuild: true }))
  try {
    assert.equal(marked.result.ok, false)
    assert.equal(marked.result.error, 'Update is not a test build')
    assert.equal(marked.logs.includes('Update is not a test build'), true)
    assert.equal(marked.swaps.length, 0)
    assert.equal(marked.quit, false)
    assert.equal(marked.phases.includes('installing'), false)
    assert.equal(marked.phase, 'error')
    assert.equal(existsSync(marked.dir), false)
  } finally {
    rmSync(marked.dir, { recursive: true, force: true })
  }

  const unmarked = await run(signedRuntime(), { localFeed: false })
  try {
    assert.equal(unmarked.result.ok, true, unmarked.result.error)
    assert.equal(unmarked.result.mode, 'inplace')
    assert.equal(unmarked.swaps.length, 1)
  } finally {
    rmSync(unmarked.dir, { recursive: true, force: true })
  }
})

test('an unmarked build refuses a marked download before the swap', async () => {
  const version = '0.9.2'
  const zipBytes = Buffer.from('marked-zip-refused')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(zipBytes), size: zipBytes.length },
  ])
  const swaps = []
  let quit = false
  const phases = []
  const logs = []
  const realError = console.error
  console.error = (...args) => {
    logs.push(args.map((part) => String(part?.message ?? part)).join(' '))
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-marked-zip-'))
  const installer = createAppUpdateInstaller({
    currentVersion: '0.3.9',
    env: {},
    probeRuntime: () => signedRuntime(),
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    unzip: async (_zip, dest) => {
      writeUpdateApp(dest, version)
      await writeUpdatePackageJson(dest, {
        name: 'font-butler',
        version,
        fontButlerTestFeed: true,
      })
    },
    verifyDownloadedApp: async () => ({ ok: true }),
    spawnSwap: (swap) => swaps.push(swap),
    quit: () => {
      quit = true
    },
    pid: 12,
    onProgress: (payload) => phases.push(payload.phase),
    fetch: async (url) => {
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      if (String(url).endsWith(macArm64ArchiveName(version, 'zip'))) {
        return httpResponse({ body: zipBytes, contentLength: zipBytes.length })
      }
      throw new Error(`unexpected ${url}`)
    },
  })
  try {
    const result = await installer.start()
    assert.equal(result.ok, false)
    assert.equal(result.error, 'Update is a test build')
    assert.equal(logs.includes('Update is a test build'), true)
    assert.equal(swaps.length, 0)
    assert.equal(quit, false)
    assert.equal(phases.includes('installing'), false)
    assert.equal(installer.status().phase, 'error')
    assert.equal(existsSync(dir), false)
  } finally {
    console.error = realError
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a throwing temp cleanup still returns the marker refusal', async () => {
  const version = '0.9.3'
  const zipBytes = Buffer.from('unreadable-marker-zip')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(zipBytes), size: zipBytes.length },
  ])
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-cleanup-throw-'))
  const raw = rawFs()
  const originalRm = raw.rmSync
  let cleanupCalls = 0
  raw.rmSync = () => {
    cleanupCalls += 1
    const error = new Error(`ENOENT: no such file or directory, rm '${dir}'`)
    error.code = 'ENOENT'
    throw error
  }
  const logs = []
  const realError = console.error
  console.error = (...args) => {
    logs.push(args.map((part) => String(part?.message ?? part)).join(' '))
  }
  const installer = createAppUpdateInstaller({
    currentVersion: '0.3.9',
    env: {},
    probeRuntime: () => signedRuntime(),
    makeTempDir: () => dir,
    unzip: async (_zip, dest) => {
      writeUpdateApp(dest, version)
      const resources = path.join(dest, 'Font Buttler.app', 'Contents', 'Resources')
      mkdirSync(resources, { recursive: true })
      writeFileSync(path.join(resources, 'app.asar'), 'not-an-asar')
    },
    verifyDownloadedApp: async () => ({ ok: true }),
    spawnSwap: () => {
      throw new Error('refused update must not swap')
    },
    quit: () => {
      throw new Error('refused update must not quit')
    },
    pid: 13,
    fetch: async (url) => {
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      if (String(url).endsWith(macArm64ArchiveName(version, 'zip'))) {
        return httpResponse({ body: zipBytes, contentLength: zipBytes.length })
      }
      throw new Error(`unexpected ${url}`)
    },
  })
  try {
    const result = await installer.start()
    assert.equal(cleanupCalls, 1)
    assert.equal(result.ok, false)
    assert.equal(result.error, "Couldn't read the update's package marker (release build)")
    assert.equal(logs.includes(result.error), true)
    assert.equal(installer.status().phase, 'error')
    assert.equal(existsSync(dir), true)
  } finally {
    raw.rmSync = originalRm
    console.error = realError
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unmarked runtime refuses an unreadable update package marker', async () => {
  await assertUnreadableMarkerRefused(signedRuntime(), false)
})

test('a marked runtime refuses an unreadable update package marker', async () => {
  await assertUnreadableMarkerRefused(signedRuntime({ testFeedBuild: true }), true)
})

async function assertUnreadableMarkerRefused(runtime, localFeed) {
  const version = '0.9.3'
  const zipBytes = Buffer.from('unreadable-marker-zip')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'zip'), sha512: sha512(zipBytes), size: zipBytes.length },
  ])
  const swaps = []
  let quit = false
  const phases = []
  const logs = []
  const dir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-unreadable-marker-'))
  const realError = console.error
  console.error = (...args) => {
    logs.push(args.map((part) => String(part?.message ?? part)).join(' '))
  }
  const installer = createAppUpdateInstaller({
    currentVersion: '0.3.9',
    env: localFeed ? { [APP_UPDATE_FEED_ENV]: 'http://127.0.0.1:8765/' } : {},
    probeRuntime: () => runtime,
    makeTempDir: () => dir,
    removeTemp: (target) => rmSync(target, { recursive: true, force: true }),
    unzip: async (_zip, dest) => {
      writeUpdateApp(dest, version)
      const resources = path.join(dest, 'Font Buttler.app', 'Contents', 'Resources')
      mkdirSync(resources, { recursive: true })
      writeFileSync(path.join(resources, 'app.asar'), 'not-an-asar')
    },
    verifyDownloadedApp: async () => ({ ok: true }),
    spawnSwap: (swap) => swaps.push(swap),
    quit: () => {
      quit = true
    },
    pid: 13,
    onProgress: (payload) => phases.push(payload.phase),
    fetch: async (url) => {
      if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
      if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
      if (String(url).endsWith(macArm64ArchiveName(version, 'zip'))) {
        return httpResponse({ body: zipBytes, contentLength: zipBytes.length })
      }
      throw new Error(`unexpected ${url}`)
    },
  })
  try {
    const result = await installer.start()
    const message = localFeed
      ? "Couldn't read the update's package marker (test build)"
      : "Couldn't read the update's package marker (release build)"
    assert.equal(result.ok, false)
    assert.equal(result.error, message)
    assert.equal(logs.includes(message), true)
    assert.equal(logs.includes('Update is a test build'), false)
    assert.equal(logs.includes('Update is not a test build'), false)
    assert.equal(swaps.length, 0)
    assert.equal(quit, false)
    assert.equal(phases.includes('installing'), false)
    assert.equal(installer.status().phase, 'error')
    assert.equal(existsSync(dir), false)
  } finally {
    console.error = realError
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a failed record of an opened DMG keeps the file and stays off the error phase', async () => {
  const version = '0.5.1'
  const bytes = Buffer.from('dmg-record-fail')
  const doc = yml(version, [
    { name: macArm64ArchiveName(version, 'dmg'), sha512: sha512(bytes), size: bytes.length },
  ])
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-dmg-record-fail-'))
  const phases = []
  const errors = []
  const realError = console.error
  console.error = (...args) => {
    errors.push(args.map((part) => String(part?.message ?? part)).join(' '))
  }
  let opened = ''
  try {
    const installer = createAppUpdateInstaller({
      currentVersion: '0.0.0',
      env: {},
      probeRuntime: () => signedRuntime({ packaged: false }),
      makeTempDir: () => tempDir,
      removeTemp: () => {
        throw new Error('the DMG must stay on disk when recording it fails')
      },
      rememberOpenedDmg: () => {
        throw new Error('disk full')
      },
      openPath: async (file) => {
        opened = file
        return ''
      },
      onProgress: (payload) => phases.push(payload.phase),
      fetch: async (url) => {
        if (url === GITHUB_LATEST_API) return httpResponse({ body: JSON.stringify(releaseJson(version)) })
        if (String(url).endsWith('latest-mac.yml')) return httpResponse({ body: doc })
        return httpResponse({ body: bytes, contentLength: bytes.length })
      },
    })
    const result = await installer.start()
    assert.equal(result.ok, true)
    assert.equal(result.mode, 'dmg')
    assert.equal(existsSync(opened), true)
    assert.equal(existsSync(tempDir), true)
    assert.equal(phases.includes('opening'), true)
    assert.equal(phases.includes('error'), false)
    assert.equal(installer.status().phase, 'idle')
    assert.match(errors.join('\n'), /Could not record the opened update disk image/)
  } finally {
    console.error = realError
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('cleanup of a still-mounted DMG logs a failed record write and startup guards that call', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-update-'))
  const dmg = path.join(tempDir, 'Font-Buttler-0.3.9-arm64.dmg')
  writeFileSync(dmg, 'mounted')
  const recordDir = mkdtempSync(path.join(os.tmpdir(), 'font-butler-dmg-write-fail-record-'))
  const record = path.join(recordDir, 'opened-dmgs.json')
  rememberOpenedDmg({ dmg, tempDir }, record)
  const errors = []
  const realError = console.error
  console.error = (...args) => {
    errors.push(args.map((part) => String(part?.message ?? part)).join(' '))
  }
  try {
    const still = cleanupOpenedUpdateDmgs({
      recordFile: record,
      isMounted: () => true,
      writeRecord: () => {
        throw new Error('disk full')
      },
    })
    assert.deepEqual(still, [{ dmg, tempDir }])
    assert.equal(existsSync(dmg), true)
    assert.equal(existsSync(tempDir), true)
    assert.match(errors.join('\n'), /Could not record which update disk images are still open/)
    const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
    const ready = main.slice(main.indexOf('app.whenReady()'))
    const cleanupAt = ready.indexOf('cleanupOpenedUpdateDmgs(')
    const bootstrapAt = ready.indexOf('bootstrapApi()')
    assert.ok(cleanupAt > 0 && cleanupAt < bootstrapAt)
    assert.match(
      ready.slice(cleanupAt - 40, cleanupAt + 280),
      /try \{\s*cleanupOpenedUpdateDmgs\(\{[\s\S]*userData[\s\S]*\} catch/,
    )
  } finally {
    console.error = realError
    rmSync(tempDir, { recursive: true, force: true })
    rmSync(recordDir, { recursive: true, force: true })
  }
})

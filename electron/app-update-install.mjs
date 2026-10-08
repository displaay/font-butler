/**
 * Click-to-install for Font Buttler macOS updates.
 *
 * Nothing here runs until `start()` — there is no autoDownload and no
 * autoInstallOnAppQuit. The running app's signature chooses the path:
 * in-place only for a packaged Developer ID build on team A7WWML89LQ whose
 * bundle is writable and not translocated or read-only. Every other case
 * downloads the DMG, checks it, and opens it. The downloaded app is swapped
 * only after sha512, size, Developer ID team, and a notarization staple match.
 *
 * Redirects: GitHub release assets answer 302. A public asset URL
 * (`https://github.com/<owner>/<repo>/releases/download/<tag>/<file>`)
 * redirects to `https://release-assets.githubusercontent.com/github-production-release-asset/...`.
 * Older assets used `https://objects.githubusercontent.com/...`.
 * We allowlist those hosts and check every hop, then still require the
 * sha512 and size from `latest-mac.yml`. The first URL must be this repo on
 * github.com (or the local feed origin). A CDN host is never a valid start.
 * Downloads are unauthenticated: no GitHub token is read or sent.
 *
 * `FONT_BUTLER_UPDATE_FEED_URL` points a non-release run at a local feed
 * (`http://127.0.0.1`, `http://localhost`, or `file://`) so a newer build can
 * be tried without publishing. Packaged Developer ID builds ignore it.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEVELOPER_ID_TEAM = 'A7WWML89LQ'
export const APP_UPDATE_FEED_ENV = 'FONT_BUTLER_UPDATE_FEED_URL'
export const APP_PRODUCT_BUNDLE = 'Font Buttler.app'
export const GITHUB_OWNER = 'displaay'
export const GITHUB_REPO = 'font-butler'
export const GITHUB_LATEST_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
export const MAX_UPDATE_BYTES = 1024 * 1024 * 1024
export const MAX_REDIRECTS = 5

/** Hosts a GitHub release-asset redirect may land on. Not valid as the first URL. */
export const GITHUB_RELEASE_ASSET_HOSTS = new Set([
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
])

const GITHUB_REPO_PREFIX = `/${GITHUB_OWNER}/${GITHUB_REPO}`

export function macArm64ArchiveName(version, ext) {
  return `Font-Buttler-${version}-arm64.${ext}`
}

export function normalizeReleaseVersion(raw) {
  return String(raw ?? '').trim().replace(/^v/i, '')
}

function numericVersionParts(raw) {
  const normalized = normalizeReleaseVersion(raw)
  const [main = '0', preWithBuild = ''] = normalized.split('-')
  const pre = preWithBuild.split('+')[0] ?? ''
  const core = main
    .split('.')
    .slice(0, 3)
    .map((part) => {
      const match = String(part).match(/^\d+/)
      return match ? Number.parseInt(match[0], 10) : 0
    })
  while (core.length < 3) core.push(0)
  return { core, pre }
}

/** Same ordering as `shared/app-update.ts`. -1 when a < b, 0 when equal, 1 when a > b. */
export function compareVersions(a, b) {
  const left = numericVersionParts(a)
  const right = numericVersionParts(b)
  for (let i = 0; i < 3; i += 1) {
    const delta = (left.core[i] ?? 0) - (right.core[i] ?? 0)
    if (delta < 0) return -1
    if (delta > 0) return 1
  }
  if (!left.pre && !right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  if (left.pre < right.pre) return -1
  if (left.pre > right.pre) return 1
  return 0
}

/** True only when `latest` is strictly newer than the running version. */
export function isNewerVersion(latest, current) {
  return compareVersions(latest, current) > 0
}

export function parseCodesignDisplay(output) {
  const text = String(output ?? '')
  const adhoc = /Signature=adhoc/i.test(text)
  const teamMatch = text.match(/^TeamIdentifier=(.*)$/m)
  const teamRaw = teamMatch ? teamMatch[1].trim() : ''
  const teamId = teamRaw && teamRaw.toLowerCase() !== 'not set' ? teamRaw : null
  const developerId = !adhoc && /Authority=Developer ID Application:/i.test(text)
  return { adhoc, developerId, teamId }
}

export function isTranslocatedAppPath(appPath) {
  return String(appPath ?? '').split(path.sep).includes('AppTranslocation')
}

export function canWriteBundle(appPath) {
  if (!appPath) return false
  try {
    fs.accessSync(appPath, fs.constants.W_OK)
    fs.accessSync(path.dirname(appPath), fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function outermostAppBundle(execPath) {
  let dir = path.dirname(path.resolve(execPath))
  let found = null
  while (dir !== path.dirname(dir)) {
    if (dir.endsWith('.app')) found = dir
    dir = path.dirname(dir)
  }
  return found
}

/**
 * In-place only when the running app is a packaged Developer ID build for
 * this team, and the bundle can actually be replaced. Version is not an input.
 */
export function selectInstallMode(facts) {
  if (!facts || facts.packaged !== true) return 'dmg'
  if (facts.translocated === true) return 'dmg'
  if (facts.readOnly === true) return 'dmg'
  if (facts.bundleWritable !== true) return 'dmg'
  if (facts.developerId !== true) return 'dmg'
  if (facts.teamId !== DEVELOPER_ID_TEAM) return 'dmg'
  return 'inplace'
}

export function isReleaseBuildRuntime(runtime) {
  if (runtime?.packaged === true && runtime?.signatureUnreadable === true) return true
  return Boolean(
    runtime?.packaged === true &&
      runtime?.developerId === true &&
      runtime?.teamId === DEVELOPER_ID_TEAM,
  )
}

export function normalizeLocalFeedUrl(raw) {
  let parsed
  try {
    parsed = new URL(String(raw ?? '').trim())
  } catch {
    return null
  }
  if (parsed.username || parsed.password) return null
  if (parsed.protocol === 'file:') {
    if (!parsed.pathname || parsed.pathname === '/') return null
    return parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return null
  if (!parsed.pathname.endsWith('/')) parsed.pathname = `${parsed.pathname}/`
  parsed.search = ''
  parsed.hash = ''
  return parsed.href
}

/** Null when the env var is unset, not a local feed, or this is a release build. */
export function resolveUpdateFeedUrl(env, runtime) {
  if (isReleaseBuildRuntime(runtime)) return null
  const raw = String(env?.[APP_UPDATE_FEED_ENV] ?? '').trim()
  if (!raw) return null
  return normalizeLocalFeedUrl(raw)
}

export function feedEntryName(url) {
  const trimmed = String(url ?? '').trim()
  if (!trimmed || trimmed.includes('\\') || trimmed.includes('\0')) return null
  const parts = trimmed.split('/')
  if (parts.includes('..')) return null
  const name = parts.at(-1) ?? ''
  if (!name || name === '.' || name !== path.posix.basename(name)) return null
  return name
}

export function feedAssetUrl(feedUrl, fileName) {
  const name = feedEntryName(fileName)
  if (!feedUrl || !name) return null
  if (feedUrl.startsWith('file:')) {
    const root = path.resolve(fileURLToPath(feedUrl))
    const file = path.resolve(root, name)
    const relative = path.relative(root, file)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null
    return pathToFileURL(file).href
  }
  const base = feedUrl.endsWith('/') ? feedUrl : `${feedUrl}/`
  return new URL(name, base).href
}

function unquoteYaml(value) {
  const trimmed = String(value ?? '').trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** Subset of electron-builder's `latest-mac.yml` (one-line sha512 and size). */
export function parseLatestMacYml(text) {
  const files = []
  let version = ''
  let current = null
  let inFiles = false
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!inFiles) {
      const versionLine = line.match(/^version:\s*(.*)$/)
      if (versionLine) version = unquoteYaml(versionLine[1])
    }
    if (/^files:\s*$/.test(line)) {
      inFiles = true
      current = null
      continue
    }
    if (inFiles && /^[A-Za-z]/.test(line)) {
      inFiles = false
      current = null
    }
    if (!inFiles) continue
    const item = line.match(/^\s+-\s+url:\s*(.*)$/)
    if (item) {
      current = { url: unquoteYaml(item[1]), sha512: '', size: undefined }
      files.push(current)
      continue
    }
    const sha = line.match(/^\s+sha512:\s*(.*)$/)
    if (sha && current) {
      current.sha512 = unquoteYaml(sha[1])
      continue
    }
    const size = line.match(/^\s+size:\s*(\d+)\s*$/)
    if (size && current) current.size = Number(size[1])
  }
  return { version: normalizeReleaseVersion(version), files }
}

export function selectExactArm64Assets(assets, version) {
  const dmgName = macArm64ArchiveName(version, 'dmg')
  const zipName = macArm64ArchiveName(version, 'zip')
  const match = (name) => (assets ?? []).find((asset) => asset?.name === name) ?? null
  return {
    dmgName,
    zipName,
    dmg: match(dmgName),
    zip: match(zipName),
    feed: match('latest-mac.yml'),
  }
}

export function ymlFileEntry(doc, fileName) {
  return (
    doc?.files?.find((entry) => feedEntryName(entry?.url) === fileName && entry.sha512 && typeof entry.size === 'number') ??
    null
  )
}

function githubRepoUrl(parsed) {
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return false
  if (parsed.username || parsed.password) return false
  return parsed.pathname === GITHUB_REPO_PREFIX || parsed.pathname.startsWith(`${GITHUB_REPO_PREFIX}/`)
}

/**
 * Hop 0 is the URL we chose (this repo, or the local feed origin).
 * Later hops may be that same place or a GitHub release-asset host.
 */
export function isAllowedUpdateRequest(url, { hop = 0, feedOrigin = null } = {}) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.username || parsed.password) return false
  if (feedOrigin) {
    return parsed.origin === feedOrigin && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
  }
  if (parsed.protocol !== 'https:') return false
  if (hop === 0) return githubRepoUrl(parsed)
  if (GITHUB_RELEASE_ASSET_HOSTS.has(parsed.hostname)) return true
  if (parsed.hostname === 'github.com') return githubRepoUrl(parsed)
  return false
}

export function updateDownloadHeaders() {
  return {
    Accept: 'application/octet-stream',
    'User-Agent': 'Font-Butler',
  }
}

export function sameSha512(actual, expected) {
  let left
  let right
  try {
    left = Buffer.from(String(actual ?? ''), 'base64')
    right = Buffer.from(String(expected ?? ''), 'base64')
  } catch {
    return false
  }
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function detectAppUpdateRuntime(execPath = process.execPath, spawnImpl = spawnSync) {
  const appPath = outermostAppBundle(execPath)
  const product = Boolean(appPath && path.basename(appPath) === APP_PRODUCT_BUNDLE)
  if (!product || !appPath) {
    return {
      packaged: false,
      developerId: false,
      teamId: null,
      adhoc: false,
      signatureUnreadable: false,
      appPath: null,
      translocated: false,
      readOnly: false,
      bundleWritable: false,
    }
  }
  let output = ''
  let status = 1
  try {
    const result = spawnImpl('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' })
    status = result?.status ?? 1
    output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
  } catch {
    output = ''
    status = 1
  }
  const parsed = parseCodesignDisplay(output)
  const bundleWritable = canWriteBundle(appPath)
  const signatureUnreadable = status !== 0 && !parsed.adhoc && !parsed.developerId
  return {
    packaged: true,
    developerId: parsed.developerId,
    teamId: parsed.teamId,
    adhoc: parsed.adhoc,
    signatureUnreadable,
    appPath,
    translocated: isTranslocatedAppPath(appPath),
    readOnly: !bundleWritable,
    bundleWritable,
  }
}

export function nodeManualFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch (error) {
      reject(error)
      return
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      reject(new Error('Unsupported update URL'))
      return
    }
    const lib = parsed.protocol === 'http:' ? http : https
    const req = lib.request(
      parsed,
      { method: 'GET', headers: init.headers ?? updateDownloadHeaders() },
      (res) => {
        const status = res.statusCode ?? 0
        const headers = {
          get(name) {
            const value = res.headers[String(name).toLowerCase()]
            if (Array.isArray(value)) return value[0] ?? null
            return value ?? null
          },
        }
        if (status >= 300 && status < 400) {
          res.resume()
          resolve({ status, ok: false, headers, stream: null })
          return
        }
        resolve({ status, ok: status >= 200 && status < 300, headers, stream: res })
      },
    )
    req.on('error', reject)
    req.on('socket', (socket) => {
      socket.setTimeout(120_000)
      socket.on('timeout', () => req.destroy(new Error('The update download timed out.')))
    })
    req.end()
  })
}

async function readResponseText(response) {
  if (typeof response.text === 'function' && !response.stream) return response.text()
  if (response.stream) {
    const chunks = []
    for await (const chunk of response.stream) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8')
  }
  if (typeof response.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer()).toString('utf8')
  }
  throw new Error('Update response had no body')
}

export async function fetchChecked(url, { fetch: fetchImpl, feedOrigin = null, headers }) {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isAllowedUpdateRequest(current, { hop, feedOrigin })) {
      throw new Error('Blocked update URL')
    }
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: headers ?? updateDownloadHeaders(),
    })
    const locationHeader = response.headers?.get?.('location') ?? response.headers?.get?.('Location')
    if (response.status >= 300 && response.status < 400) {
      if (!locationHeader) throw new Error('Update redirect had no Location')
      if (hop === MAX_REDIRECTS) throw new Error('Too many update redirects')
      current = new URL(locationHeader, current).href
      response.stream?.resume?.()
      continue
    }
    return { response, url: current }
  }
  throw new Error('Too many update redirects')
}

function copyVerifiedFile(url, dest, expectedSha512, expectedSize) {
  const file = fileURLToPath(url)
  const bytes = fs.readFileSync(file)
  if (bytes.length !== expectedSize || !sameSha512(createHash('sha512').update(bytes).digest('base64'), expectedSha512)) {
    throw new Error('The download did not match the published checksum.')
  }
  fs.writeFileSync(dest, bytes)
  return dest
}

async function writeVerifiedBody(response, dest, expectedSize, onProgress) {
  const hash = createHash('sha512')
  let received = 0
  const out = createWriteStream(dest)
  let source
  if (response.stream) source = response.stream
  else if (response.bodyBuffer) source = [response.bodyBuffer]
  else if (typeof response.arrayBuffer === 'function') source = [Buffer.from(await response.arrayBuffer())]
  else throw new Error('Update download had no body')

  try {
    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      received += buf.length
      if (received > expectedSize) throw new Error('The download was larger than the published size.')
      hash.update(buf)
      if (!out.write(buf)) await once(out, 'drain')
      if (onProgress) onProgress(received)
    }
    out.end()
    await finished(out)
  } catch (error) {
    source.destroy?.()
    out.destroy()
    throw error
  }
  return { received, sha512: hash.digest('base64') }
}

export async function downloadVerifiedFile({
  url,
  dest,
  expectedSha512,
  expectedSize,
  fetch: fetchImpl,
  feedOrigin = null,
  onProgress,
}) {
  if (!expectedSha512 || typeof expectedSize !== 'number' || expectedSize <= 0 || expectedSize > MAX_UPDATE_BYTES) {
    throw new Error('Update feed is missing a usable sha512 or size.')
  }
  if (url.startsWith('file:')) {
    return copyVerifiedFile(url, dest, expectedSha512, expectedSize)
  }
  let verified = false
  try {
    const { response } = await fetchChecked(url, { fetch: fetchImpl, feedOrigin })
    if (!response.ok) throw new Error(`Update download failed (HTTP ${response.status}).`)
    const rawLength = response.headers?.get?.('content-length')
    if (rawLength != null && rawLength !== '') {
      const declared = Number(rawLength)
      if (!Number.isFinite(declared) || declared !== expectedSize) {
        response.stream?.resume?.()
        throw new Error('Update download size does not match latest-mac.yml.')
      }
    }
    const written = await writeVerifiedBody(response, dest, expectedSize, onProgress)
    if (written.received !== expectedSize || !sameSha512(written.sha512, expectedSha512)) {
      throw new Error('The download did not match the published checksum.')
    }
    verified = true
    return dest
  } finally {
    if (!verified) {
      try {
        fs.rmSync(dest, { force: true })
      } catch {
        // The partial file is already gone.
      }
    }
  }
}

function assertInside(parent, child) {
  const root = fs.realpathSync(parent)
  const target = fs.realpathSync(child)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Update contents escaped the download directory.')
  }
}

export function findUpdateAppBundle(root) {
  const direct = path.join(root, APP_PRODUCT_BUNDLE)
  if (fs.existsSync(direct)) return direct
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const nested = path.join(root, entry.name, APP_PRODUCT_BUNDLE)
    if (fs.existsSync(nested)) return nested
  }
  return null
}

export function verifyDownloadedDeveloperIdApp(appPath, spawnImpl = spawnSync) {
  const display = spawnImpl('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' })
  const verify = spawnImpl('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    encoding: 'utf8',
  })
  const staple = spawnImpl('xcrun', ['stapler', 'validate', appPath], { encoding: 'utf8' })
  const output = `${display?.stdout ?? ''}\n${display?.stderr ?? ''}`
  const parsed = parseCodesignDisplay(output)
  if ((verify?.status ?? 1) !== 0) return { ok: false, reason: 'The downloaded app failed codesign verification.' }
  if ((staple?.status ?? 1) !== 0) return { ok: false, reason: 'The downloaded app has no notarization staple.' }
  if (parsed.adhoc || !parsed.developerId) {
    return { ok: false, reason: 'The downloaded app is not signed with Developer ID.' }
  }
  if (parsed.teamId !== DEVELOPER_ID_TEAM) {
    return { ok: false, reason: 'The downloaded app is signed by a different team.' }
  }
  return { ok: true }
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

/**
 * Replace the bundle only after this process exits.
 * Any failure restores the original bundle if it was moved, then opens that app.
 * An early `rm` failure is not left to `set -e`: the ERR trap opens the original app.
 * A cross-volume `mv` can leave a partial destination. That directory is removed
 * before the backup is moved back, and only when the backup is still present.
 */
export function buildMacSwapScript({ pid, currentApp, nextApp, tempDir, scriptPath }) {
  const id = Number(pid)
  if (!Number.isInteger(id) || id <= 1) throw new Error('Invalid update process id.')
  const backup = `${currentApp}.font-butler-previous`
  const current = shellQuote(currentApp)
  const previous = shellQuote(backup)
  const next = shellQuote(nextApp)
  const temp = shellQuote(tempDir)
  const script = shellQuote(scriptPath)
  return `#!/bin/bash
set -euo pipefail
moved=0
reopen_original() {
  if [[ "$moved" -eq 1 && -e ${previous} ]]; then
    rm -rf ${current} || true
    if [[ ! -e ${current} ]]; then
      mv ${previous} ${current} || true
      moved=0
    fi
  fi
  open ${current} || true
}
trap 'reopen_original; exit 1' ERR
while kill -0 ${id} 2>/dev/null; do
  sleep 0.2
done
rm -rf ${previous}
if ! mv ${current} ${previous}; then
  reopen_original
  exit 1
fi
moved=1
if ! mv ${next} ${current}; then
  reopen_original
  exit 1
fi
moved=0
rm -rf ${previous}
open ${current}
rm -rf ${temp}
rm -f ${script}
`
}

function releaseAssetUrl(asset) {
  const url = String(asset?.url ?? asset?.browser_download_url ?? '').trim()
  return url || null
}

export async function loadUpdateFeed(feedUrl, fetchImpl) {
  const text = await readFeedYml(feedUrl, fetchImpl)
  return statusPiecesFromFeed(text, feedUrl)
}

async function readFeedYml(feedUrl, fetchImpl) {
  const ymlUrl = feedAssetUrl(feedUrl, 'latest-mac.yml')
  if (!ymlUrl) throw new Error('Local update feed URL is not usable.')
  if (ymlUrl.startsWith('file:')) {
    return fs.readFileSync(fileURLToPath(ymlUrl), 'utf8')
  }
  const feedOrigin = new URL(feedUrl).origin
  const { response } = await fetchChecked(ymlUrl, { fetch: fetchImpl, feedOrigin })
  if (!response.ok) throw new Error(`Local update feed returned HTTP ${response.status}.`)
  return readResponseText(response)
}

async function readGithubRelease(fetchImpl) {
  const response = await fetchImpl(GITHUB_LATEST_API, {
    redirect: 'manual',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Font-Butler',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (response.status !== 200) throw new Error(`GitHub Releases returned HTTP ${response.status}.`)
  const text = await readResponseText(response)
  const json = JSON.parse(text)
  if (json.draft || json.prerelease) throw new Error('The latest GitHub Release is not a final build.')
  const version = normalizeReleaseVersion(json.tag_name || json.name || '')
  if (!version) throw new Error('The latest GitHub Release has no version.')
  const assets = (json.assets ?? [])
    .map((asset) => ({
      name: String(asset.name ?? '').trim(),
      url: String(asset.browser_download_url ?? '').trim(),
      size: typeof asset.size === 'number' ? asset.size : undefined,
    }))
    .filter((asset) => asset.name && asset.url)
  return { version, assets }
}

async function readGithubFeedYml(assets, version, fetchImpl) {
  const selected = selectExactArm64Assets(assets, version)
  const feedUrl = releaseAssetUrl(selected.feed)
  if (!feedUrl) throw new Error('The release is missing latest-mac.yml.')
  const { response } = await fetchChecked(feedUrl, { fetch: fetchImpl, feedOrigin: null })
  if (!response.ok) throw new Error(`latest-mac.yml download failed (HTTP ${response.status}).`)
  const text = await readResponseText(response)
  const doc = parseLatestMacYml(text)
  if (doc.version !== version) throw new Error('latest-mac.yml version does not match the release.')
  return { doc, selected }
}

function fileUrlForAsset(feedUrl, fileName, asset) {
  if (feedUrl) return feedAssetUrl(feedUrl, fileName)
  const url = releaseAssetUrl(asset)
  if (!url || !isAllowedUpdateRequest(url, { hop: 0, feedOrigin: null })) return null
  return url
}

export function createAppUpdateInstaller(deps) {
  let running = false
  let phase = 'idle'
  let percent
  let errorMessage
  const fetchImpl = deps.fetch ?? nodeManualFetch

  function status() {
    const snapshot = { phase }
    if (typeof percent === 'number') snapshot.percent = percent
    if (errorMessage) snapshot.error = errorMessage
    return snapshot
  }

  function note(payload) {
    const nextPhase = payload?.phase
    const known =
      nextPhase === 'idle' ||
      nextPhase === 'downloading' ||
      nextPhase === 'verifying' ||
      nextPhase === 'installing' ||
      nextPhase === 'opening' ||
      nextPhase === 'error'
    if (!known) {
      deps.onProgress?.(payload)
      return
    }
    const nextPercent = typeof payload.percent === 'number' ? payload.percent : undefined
    const nextError = typeof payload.error === 'string' ? payload.error : undefined
    if (nextPhase === phase && nextPercent === percent && nextError === errorMessage) return
    phase = nextPhase
    percent = nextPercent
    errorMessage = nextError
    deps.onProgress?.(payload)
  }

  async function start() {
    if (running) return { ok: false, ignored: true, ...status() }
    running = true
    note({ phase: 'downloading', percent: 0 })
    const tempDir = deps.makeTempDir
      ? deps.makeTempDir()
      : fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-update-'))
    let keepTemp = false
    try {
      const result = await runInstall({ ...deps, onProgress: note }, fetchImpl, tempDir)
      keepTemp = result.keepTemp === true
      note({ phase: 'idle' })
      return { ok: true, mode: result.mode }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The update could not be installed.'
      note({ phase: 'error', error: message })
      return { ok: false, error: message }
    } finally {
      running = false
      if (!keepTemp) {
        if (deps.removeTemp) deps.removeTemp(tempDir)
        else fs.rmSync(tempDir, { recursive: true, force: true })
      }
    }
  }

  return { start, status }
}

function runningAppVersion(deps) {
  const value = typeof deps.currentVersion === 'function' ? deps.currentVersion() : deps.currentVersion
  return String(value ?? '').trim()
}

function assertNewerRelease(version, deps) {
  const current = runningAppVersion(deps)
  if (!current) throw new Error('The running app version is unknown.')
  if (!isNewerVersion(version, current)) {
    throw new Error(`Font Buttler ${current} will not install ${version}.`)
  }
}

async function runInstall(deps, fetchImpl, tempDir) {
  const runtime = await deps.probeRuntime()
  const mode = selectInstallMode(runtime)
  const feedUrl = resolveUpdateFeedUrl(deps.env ?? {}, runtime)
  const feedOrigin = feedUrl && !feedUrl.startsWith('file:') ? new URL(feedUrl).origin : null
  let lastDownloadPercent = -1
  const reportDownloadPercent = (percent) => {
    if (percent === lastDownloadPercent) return
    lastDownloadPercent = percent
    deps.onProgress?.({ phase: 'downloading', percent })
  }

  let version
  let doc
  let assetUrl
  let fileName
  if (feedUrl) {
    const text = await readFeedYml(feedUrl, fetchImpl)
    doc = parseLatestMacYml(text)
    version = doc.version
    if (!version) throw new Error('The local update feed has no version.')
    assertNewerRelease(version, deps)
    fileName = macArm64ArchiveName(version, mode === 'inplace' ? 'zip' : 'dmg')
    assetUrl = feedAssetUrl(feedUrl, fileName)
  } else {
    const release = await readGithubRelease(fetchImpl)
    version = release.version
    assertNewerRelease(version, deps)
    const loaded = await readGithubFeedYml(release.assets, version, fetchImpl)
    doc = loaded.doc
    fileName = mode === 'inplace' ? loaded.selected.zipName : loaded.selected.dmgName
    const asset = mode === 'inplace' ? loaded.selected.zip : loaded.selected.dmg
    assetUrl = fileUrlForAsset(null, fileName, asset)
  }
  if (!assetUrl) throw new Error(`The release is missing ${fileName}.`)
  const entry = ymlFileEntry(doc, fileName)
  if (!entry) throw new Error(`latest-mac.yml has no checksum for ${fileName}.`)

  reportDownloadPercent(0)
  const dest = path.join(tempDir, fileName)
  await downloadVerifiedFile({
    url: assetUrl,
    dest,
    expectedSha512: entry.sha512,
    expectedSize: entry.size,
    fetch: fetchImpl,
    feedOrigin,
    onProgress: (received) => {
      reportDownloadPercent(Math.min(100, Math.round((received / entry.size) * 100)))
    },
  })

  deps.onProgress?.({ phase: 'verifying' })
  if (mode === 'dmg') {
    deps.onProgress?.({ phase: 'opening' })
    const opened = await deps.openPath(dest)
    if (typeof opened === 'string' && opened.trim()) throw new Error(opened)
    // shell.openPath returns when macOS accepts the request, before
    // DiskImageMounter attaches the image. Never delete here. The path is
    // recorded on disk and removed on a later launch only if it is not mounted.
    const remember = deps.rememberOpenedDmg ?? rememberOpenedDmg
    remember({ dmg: dest, tempDir })
    return { mode, keepTemp: true }
  }

  const unpackDir = path.join(tempDir, 'unpacked')
  fs.mkdirSync(unpackDir)
  if (deps.unzip) await deps.unzip(dest, unpackDir)
  else await unpackZipArchive(dest, unpackDir)
  const nextApp = findUpdateAppBundle(unpackDir)
  if (!nextApp) throw new Error('The update zip does not contain Font Buttler.app.')
  assertInside(unpackDir, nextApp)
  const verified = deps.verifyDownloadedApp
    ? await deps.verifyDownloadedApp(nextApp)
    : verifyDownloadedDeveloperIdApp(nextApp)
  if (!verified?.ok) {
    throw new Error(verified?.reason || 'The downloaded app failed signature checks.')
  }
  if (!runtime.appPath) throw new Error('The running app bundle could not be found.')
  deps.onProgress?.({ phase: 'installing' })
  const scriptPath = deps.scriptPath ?? path.join(os.tmpdir(), `font-butler-swap-${process.pid}.sh`)
  const script = buildMacSwapScript({
    pid: deps.pid ?? process.pid,
    currentApp: runtime.appPath,
    nextApp,
    tempDir,
    scriptPath,
  })
  if (deps.spawnSwap) await deps.spawnSwap({ script, scriptPath })
  else spawnSwapScript({ script, scriptPath })
  deps.quit?.()
  return { mode, keepTemp: true }
}

/** macOS unpack. `ditto -x -k` keeps AppleDouble resource forks that `unzip` drops. */
export function unpackZipArchive(zipPath, destDir, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnImpl('ditto', ['-x', '-k', zipPath, destDir], { stdio: 'ignore' })
    } catch (error) {
      reject(error)
      return
    }
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ditto exited ${code ?? 'unknown'}.`))
    })
  })
}

export const OPENED_DMG_RECORD = path.join(os.tmpdir(), 'font-butler-opened-dmgs.json')

export function readOpenedDmgRecord(recordFile = OPENED_DMG_RECORD) {
  try {
    const parsed = JSON.parse(fs.readFileSync(recordFile, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry) => entry && typeof entry.dmg === 'string' && entry.dmg.length > 0)
  } catch {
    return []
  }
}

export function rememberOpenedDmg(entry, recordFile = OPENED_DMG_RECORD) {
  const pending = readOpenedDmgRecord(recordFile).filter((item) => item.dmg !== entry.dmg)
  pending.push({ dmg: entry.dmg, tempDir: entry.tempDir ?? null })
  fs.mkdirSync(path.dirname(recordFile), { recursive: true })
  fs.writeFileSync(recordFile, JSON.stringify(pending))
}

function existingRealPath(filePath) {
  try {
    return fs.realpathSync(filePath)
  } catch {
    return null
  }
}

/** image-path values from `hdiutil info` text or plist. */
export function hdiutilImagePaths(output) {
  const text = String(output ?? '')
  const paths = []
  for (const match of text.matchAll(/<key>image-path<\/key>\s*<string>([^<]*)<\/string>/gi)) {
    const value = match[1].trim()
    if (value) paths.push(value)
  }
  for (const match of text.matchAll(/^\s*image-path\s*:\s*(.+?)\s*$/gm)) {
    const value = match[1].trim()
    if (value) paths.push(value)
  }
  return paths
}

export function isUpdateDmgMounted(dmgPath, spawnImpl = spawnSync) {
  const recorded = existingRealPath(dmgPath)
  if (!recorded) return false
  try {
    const result = spawnImpl('hdiutil', ['info'], { encoding: 'utf8' })
    if ((result?.status ?? 1) !== 0) return false
    const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
    return hdiutilImagePaths(output).some((imagePath) => existingRealPath(imagePath) === recorded)
  } catch {
    return false
  }
}

/** On a later launch, delete recorded DMGs that are no longer mounted. */
export function cleanupOpenedUpdateDmgs({
  recordFile = OPENED_DMG_RECORD,
  isMounted = isUpdateDmgMounted,
} = {}) {
  const pending = readOpenedDmgRecord(recordFile)
  const stillMounted = []
  for (const entry of pending) {
    if (isMounted(entry.dmg)) {
      stillMounted.push(entry)
      continue
    }
    try {
      fs.rmSync(entry.dmg, { force: true })
    } catch {
      // Already gone.
    }
    if (entry.tempDir) {
      try {
        fs.rmSync(entry.tempDir, { recursive: true, force: true })
      } catch {
        // The temp directory was already removed.
      }
    }
  }
  if (stillMounted.length === 0) {
    try {
      fs.rmSync(recordFile, { force: true })
    } catch {
      // No record to remove.
    }
  } else {
    fs.writeFileSync(recordFile, JSON.stringify(stillMounted))
  }
  return stillMounted
}

function spawnSwapScript({ script, scriptPath }) {
  fs.writeFileSync(scriptPath, script, { mode: 0o700 })
  const child = spawn('/bin/bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

export function statusPiecesFromFeed(ymlText, feedUrl) {
  const doc = parseLatestMacYml(ymlText)
  const version = doc.version
  if (!version) return { version: '', assets: [], doc }
  const dmgName = macArm64ArchiveName(version, 'dmg')
  const zipName = macArm64ArchiveName(version, 'zip')
  const assets = []
  for (const name of [dmgName, zipName]) {
    const entry = ymlFileEntry(doc, name)
    const url = entry ? feedAssetUrl(feedUrl, name) : null
    if (!entry || !url) continue
    assets.push({ name, url, size: entry.size })
  }
  return { version, assets, doc }
}

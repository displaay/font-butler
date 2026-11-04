import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  documentPathsFromBytes,
  documentPathsFromLsof,
  isWatchedDocumentBundle,
  isWatchedDocumentSignal,
  normalizeOpenedPath,
  parseFrontAppInfo,
  pickOpenedDocumentPath,
} from './document-open-watch.mjs'

/**
 * macOS-only observer for Adobe, Office, and Figma coming frontmost.
 * Front app identity comes from lsappinfo. Open files come from lsof and the
 * app's recent-document list. No Accessibility, no Apple Events to those apps,
 * and no activation of them.
 */

const FRONT_POLL_MS = 1000
const OPEN_FILE_POLL_MS = 2000

function execText(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 2500, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) resolve('')
      else resolve(String(stdout ?? ''))
    })
  })
}

export async function readFrontApp() {
  const front = (await execText('/usr/bin/lsappinfo', ['front'])).trim()
  const asn = front.split(/\s+/)[0]
  if (!asn) return { bundleId: '', pid: 0 }
  const info = await execText('/usr/bin/lsappinfo', ['info', '-only', 'bundleid,pid', asn])
  return parseFrontAppInfo(info)
}

export async function listOpenDocumentPaths(pid) {
  const id = Number(pid)
  if (!Number.isInteger(id) || id <= 0) return []
  const text = await execText('/usr/sbin/lsof', ['-n', '-P', '-p', String(id), '-Fn'])
  return documentPathsFromLsof(text)
}

export function recentDocumentDirs(bundleId, home = os.homedir()) {
  const id = String(bundleId ?? '').trim()
  if (!id) return []
  return [
    path.join(
      home,
      'Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments',
    ),
    path.join(
      home,
      'Library/Containers',
      id,
      'Data/Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments',
    ),
  ]
}

export function recentFileMatchesBundle(bundleId, fileName) {
  const id = String(bundleId ?? '').trim().toLowerCase()
  const base = String(fileName ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.(sfl2|sfl3|plist)$/i, '')
  if (!id || !base) return false
  return base === id || base.startsWith(`${id}.`) || id.startsWith(`${base}.`)
}

export function recentDocumentPaths(bundleId, io) {
  const id = String(bundleId ?? '').trim()
  if (!id) return []
  const home = io?.home ?? os.homedir()
  const readDir = io?.readDir ?? ((dir) => fs.readdirSync(dir))
  const readFile = io?.readFile ?? ((filePath) => fs.readFileSync(filePath))
  const statMtime = io?.statMtime ?? ((filePath) => fs.statSync(filePath).mtimeMs)
  /** @type {{ filePath: string, mtime: number }[]} */
  const files = []
  for (const dir of recentDocumentDirs(bundleId, home)) {
    let names = []
    try {
      names = readDir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!recentFileMatchesBundle(id, name)) continue
      const filePath = path.join(dir, name)
      let mtime = 0
      try {
        mtime = Number(statMtime(filePath)) || 0
      } catch {
        mtime = 0
      }
      files.push({ filePath, mtime })
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  const found = []
  for (const file of files) {
    try {
      found.push(...documentPathsFromBytes(readFile(file.filePath)))
    } catch {
      // A recent-document file we cannot read is skipped.
    }
  }
  const seen = new Set()
  const paths = []
  for (const filePath of found) {
    const normalized = normalizeOpenedPath(filePath)
    if (!normalized || seen.has(normalized) || !isWatchedDocumentSignal(normalized)) continue
    seen.add(normalized)
    paths.push(normalized)
  }
  return paths
}

/**
 * @param {{
 *   platform?: NodeJS.Platform
 *   pollMs?: number
 *   openFilePollMs?: number
 *   readFront?: () => Promise<{ bundleId?: string, pid?: number }>
 *   listOpenPaths?: (pid: number) => Promise<string[]>
 *   listRecentPaths?: (bundleId: string) => Promise<string[]>
 *   onOpenedPath: (event: { bundleId: string, path: string }) => void
 *   now?: () => number
 * }} options
 */
export function createDocumentAppObserver({
  platform = process.platform,
  pollMs = FRONT_POLL_MS,
  openFilePollMs = OPEN_FILE_POLL_MS,
  readFront = readFrontApp,
  listOpenPaths = listOpenDocumentPaths,
  listRecentPaths = (bundleId) => Promise.resolve(recentDocumentPaths(bundleId)),
  onOpenedPath,
  now = Date.now,
} = {}) {
  let stopped = true
  let timer = null
  let tail = Promise.resolve()
  let currentBundle = ''
  let lastInspectAt = 0
  /** @type {Map<string, { openPaths: string[], recentHead: string }>} */
  const baselines = new Map()

  async function sample() {
    if (stopped) return
    let front
    try {
      front = await readFront()
    } catch {
      return
    }
    if (stopped) return
    const bundleId = String(front?.bundleId ?? '')
    const pid = Number(front?.pid) || 0
    const activation = bundleId !== currentBundle
    currentBundle = bundleId
    if (!isWatchedDocumentBundle(bundleId)) return
    const stamp = now()
    if (!activation && stamp - lastInspectAt < openFilePollMs) return
    lastInspectAt = stamp
    let openPaths = []
    let recentPaths = []
    try {
      openPaths = await listOpenPaths(pid)
    } catch {
      openPaths = []
    }
    if (stopped) return
    try {
      recentPaths = await listRecentPaths(bundleId)
    } catch {
      recentPaths = []
    }
    if (stopped) return
    const known = baselines.get(bundleId)
    const chosen = pickOpenedDocumentPath({
      activation,
      hasBaseline: Boolean(known),
      openPaths,
      recentPaths,
      previousOpenPaths: known?.openPaths ?? [],
      previousRecentHead: known?.recentHead ?? '',
    })
    const interesting = openPaths.map(normalizeOpenedPath).filter(isWatchedDocumentSignal)
    const recentHead =
      recentPaths.map(normalizeOpenedPath).find((filePath) => isWatchedDocumentSignal(filePath)) ?? ''
    baselines.set(bundleId, { openPaths: interesting, recentHead })
    if (chosen) onOpenedPath?.({ bundleId, path: chosen })
  }

  function enqueue() {
    tail = tail.then(() => sample()).catch(() => {})
    return tail
  }

  return {
    start() {
      if (platform !== 'darwin') return
      if (timer) return
      stopped = false
      currentBundle = ''
      baselines.clear()
      lastInspectAt = 0
      enqueue()
      timer = setInterval(() => {
        enqueue()
      }, pollMs)
      if (typeof timer.unref === 'function') timer.unref()
    },
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
      currentBundle = ''
      baselines.clear()
      lastInspectAt = 0
    },
    whenIdle() {
      return tail
    },
    poll() {
      return enqueue()
    },
  }
}

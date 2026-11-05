import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { askInDesignFonts, fontsFromInDesignReply } from './indesign-fonts.mjs'
import {
  documentPathsFromBytes,
  documentPathsFromLsof,
  isInDesignBundle,
  isWatchedDocumentBundle,
  isWatchedDocumentSignal,
  normalizeOpenedPath,
  parseFrontAppInfo,
  pickOpenedDocumentPath,
} from './document-open-watch.mjs'

/**
 * macOS-only observer for Adobe, Office, and Figma coming frontmost.
 * Front app identity comes from lsappinfo.
 * While InDesign is frontmost, ask that process over Apple Events for the
 * fonts in its open documents, about twice a second. That still works while
 * Missing Fonts is open. Illustrator and Photoshop stay on the open file
 * path (lsof and the recent-document list), then the file is read.
 * No Accessibility, and no activation of fonts.
 */

const FRONT_POLL_MS = 1000
const OPEN_FILE_POLL_MS = 2000
/** Cicero asks the front Adobe app every 500 ms. */
export const INDESIGN_FONT_POLL_MS = 500

function defaultScheduleInterval(fn, ms) {
  const id = setInterval(fn, ms)
  if (typeof id.unref === 'function') id.unref()
  return () => clearInterval(id)
}

function liveFontKey(fonts) {
  return fonts
    .map((font) => [font.postscriptName, font.familyName, font.styleName].join('\0'))
    .join('\n')
}

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
 *   onInDesignFonts?: (event: { bundleId: string, fonts: { postscriptName: string, familyName: string, styleName: string }[] }) => void
 *   askInDesign?: (pid: number) => Promise<{ unavailable?: boolean, refused?: boolean, postscriptNames?: string[], families?: string[], styles?: string[] }>
 *   indesignPollMs?: number
 *   scheduleInterval?: (fn: () => void, ms: number) => () => void
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
  onInDesignFonts,
  askInDesign = askInDesignFonts,
  indesignPollMs = INDESIGN_FONT_POLL_MS,
  scheduleInterval = defaultScheduleInterval,
  now = Date.now,
} = {}) {
  let stopped = true
  let timer = null
  let tail = Promise.resolve()
  let currentBundle = ''
  let lastInspectAt = 0
  let indesignPid = 0
  let indesignBundle = ''
  let indesignKey = ''
  let indesignRefused = false
  let indesignLoop = false
  let cancelInDesign = () => {}
  /** @type {Map<string, { openPaths: string[], recentHead: string }>} */
  const baselines = new Map()

  function stopInDesignLoop() {
    if (!indesignLoop) return
    indesignLoop = false
    cancelInDesign()
    cancelInDesign = () => {}
  }

  function startInDesignLoop() {
    if (indesignLoop || indesignRefused) return
    indesignLoop = true
    const cancel = scheduleInterval(() => {
      enqueueInDesign()
    }, indesignPollMs)
    cancelInDesign = typeof cancel === 'function' ? cancel : () => {}
  }

  async function askLiveInDesign(reset) {
    if (indesignRefused || !indesignPid) return 'refused'
    let reply
    try {
      reply = await askInDesign(indesignPid)
    } catch {
      return 'unavailable'
    }
    const parsed = fontsFromInDesignReply(reply)
    if (parsed.unavailable) return 'unavailable'
    if (parsed.refused) {
      indesignRefused = true
      stopInDesignLoop()
      return 'refused'
    }
    if (reset) indesignKey = '\0'
    const key = liveFontKey(parsed.fonts)
    if (key === indesignKey) return 'handled'
    indesignKey = key
    if (parsed.fonts.length > 0) {
      onInDesignFonts?.({ bundleId: indesignBundle, fonts: parsed.fonts })
    }
    return 'handled'
  }

  function enqueueInDesign() {
    tail = tail
      .then(async () => {
        if (stopped || indesignRefused || !indesignPid) return
        const outcome = await askLiveInDesign(false)
        if (outcome === 'unavailable') stopInDesignLoop()
      })
      .catch(() => {})
    return tail
  }

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
    if (!isWatchedDocumentBundle(bundleId)) {
      stopInDesignLoop()
      return
    }
    if (isInDesignBundle(bundleId) && indesignRefused) return
    if (isInDesignBundle(bundleId) && pid > 0) {
      const reset = activation || indesignPid !== pid
      indesignPid = pid
      indesignBundle = bundleId
      if (indesignLoop && !reset) return
      const outcome = await askLiveInDesign(reset)
      if (stopped) return
      if (outcome === 'handled') {
        startInDesignLoop()
        return
      }
      if (outcome === 'refused') {
        stopInDesignLoop()
        return
      }
    }
    if (!isInDesignBundle(bundleId)) stopInDesignLoop()
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
      indesignPid = 0
      indesignBundle = ''
      indesignKey = ''
      indesignRefused = false
      stopInDesignLoop()
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
      stopInDesignLoop()
      currentBundle = ''
      baselines.clear()
      lastInspectAt = 0
      indesignPid = 0
      indesignBundle = ''
      indesignKey = ''
    },
    whenIdle() {
      return tail
    },
    poll() {
      return enqueue()
    },
  }
}

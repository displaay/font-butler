import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Decide what a document-open watch should do with one file path.
 * The watch never activates fonts. A supported path is handed to the existing
 * document font report; the sheet is the only result.
 *
 * Supported extensions match shared/document-project.ts.
 * An open Illustrator or Photoshop file is parsed from the file Cicero reads
 * (PDF plus XMP, or Photoshop text layers). While InDesign is frontmost, the
 * observer asks it for the fonts instead of reading the saved file.
 * Figma is not parsed.
 */

const SUPPORTED = new Set(['.pdf', '.idml', '.docx', '.pptx', '.indd', '.indt', '.ai', '.psd', '.psb'])
const UNSUPPORTED = new Set(['.fig'])

const WATCHED_BUNDLE_PREFIXES = [
  'com.adobe.indesign',
  'com.adobe.illustrator',
  'com.adobe.photoshop',
  'com.adobe.acrobat',
  'com.adobe.reader',
  'com.microsoft.word',
  'com.microsoft.powerpoint',
  // Figma is not parsed. The bundle is watched so a front .fig can show the one-line note.
  'com.figma.desktop',
]

const NOTE_BY_EXTENSION = {
  '.fig': 'This Figma file is not read here. Export a PDF to see its fonts.',
}

export function isWatchedDocumentBundle(bundleId) {
  const id = String(bundleId ?? '').trim().toLowerCase()
  if (!id) return false
  return WATCHED_BUNDLE_PREFIXES.some((prefix) => id === prefix || id.startsWith(`${prefix}.`))
}

export function isInDesignBundle(bundleId) {
  const id = String(bundleId ?? '').trim().toLowerCase()
  return id === 'com.adobe.indesign' || id.startsWith('com.adobe.indesign.')
}

export function normalizeOpenedPath(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (text.toLowerCase().startsWith('file://')) {
    try {
      return path.resolve(fileURLToPath(text))
    } catch {
      return ''
    }
  }
  let decoded = text
  if (decoded.includes('%')) {
    try {
      decoded = decodeURIComponent(decoded)
    } catch {
      // Keep the original path when % is not an escape.
    }
  }
  return path.resolve(decoded)
}

export function documentExtension(filePath) {
  return path.extname(String(filePath ?? '')).toLowerCase()
}

/** @returns {'parse' | 'note' | 'ignore'} */
export function classifyOpenedDocument(filePath) {
  const ext = documentExtension(filePath)
  if (SUPPORTED.has(ext)) return 'parse'
  if (UNSUPPORTED.has(ext)) return 'note'
  return 'ignore'
}

export function isWatchedDocumentSignal(filePath) {
  return classifyOpenedDocument(filePath) !== 'ignore'
}

export function unsupportedDocumentNote(filePath) {
  return NOTE_BY_EXTENSION[documentExtension(filePath)] ?? ''
}

function uniquePaths(paths) {
  const seen = new Set()
  const result = []
  for (const filePath of paths) {
    if (!filePath || seen.has(filePath)) continue
    seen.add(filePath)
    result.push(filePath)
  }
  return result
}

/**
 * Pick at most one front document.
 * A new open (lsof path or recent-list head) wins. The first look at an app
 * uses the recent document, or the only open document, and does not guess
 * among several already-open files.
 */
export function pickOpenedDocumentPath({
  activation = false,
  hasBaseline = false,
  openPaths = [],
  recentPaths = [],
  previousOpenPaths = [],
  previousRecentHead = '',
} = {}) {
  const open = uniquePaths(openPaths.map(normalizeOpenedPath).filter(isWatchedDocumentSignal))
  const recent = uniquePaths(recentPaths.map(normalizeOpenedPath).filter(isWatchedDocumentSignal))
  const previous = new Set(previousOpenPaths.map(normalizeOpenedPath))
  const recentHead = recent[0] ?? ''
  if (hasBaseline) {
    const fresh = open.filter((filePath) => !previous.has(filePath))
    if (fresh.length > 0) return fresh[fresh.length - 1]
    if (recentHead && recentHead !== normalizeOpenedPath(previousRecentHead)) return recentHead
  }
  if (!activation) return null
  if (recentHead) return recentHead
  if (open.length === 1) return open[0]
  return null
}

const DOCUMENT_EXT = 'pdf|idml|docx|pptx|indd|indt|ai|psd|psb|fig'
const ABSOLUTE_PATH = new RegExp(
  `(?:/(?:[\\w .@()&+',\\-]|%[0-9A-Fa-f]{2})+)+\\.(?:${DOCUMENT_EXT})(?![A-Za-z0-9])`,
  'gi',
)
const FILE_URL = new RegExp(
  `file://(?:[\\w.-]+/)?((?:/(?:[\\w .@()&+',\\-]|%[0-9A-Fa-f]{2})+)+\\.(?:${DOCUMENT_EXT}))(?![A-Za-z0-9])`,
  'gi',
)

export function documentPathsFromText(text) {
  const source = String(text ?? '')
  /** @type {{ index: number, filePath: string }[]} */
  const hits = []
  for (const match of source.matchAll(FILE_URL)) {
    const filePath = normalizeOpenedPath(match[0])
    if (isWatchedDocumentSignal(filePath)) hits.push({ index: match.index ?? 0, filePath })
  }
  for (const match of source.matchAll(ABSOLUTE_PATH)) {
    const filePath = normalizeOpenedPath(match[0])
    if (isWatchedDocumentSignal(filePath)) hits.push({ index: match.index ?? 0, filePath })
  }
  hits.sort((a, b) => a.index - b.index)
  return uniquePaths(hits.map((hit) => hit.filePath))
}

export function documentPathsFromBytes(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes ?? ''))
  const sliced = buffer.length > 2_000_000 ? buffer.subarray(0, 2_000_000) : buffer
  const texts = [sliced.toString('utf8')]
  if (sliced.length >= 4) texts.push(sliced.toString('utf16le'))
  return uniquePaths(texts.flatMap((text) => documentPathsFromText(text)))
}

/** `lsof -Fn` lines. Only document signals are returned, in first-seen order. */
export function documentPathsFromLsof(text) {
  const found = []
  for (const line of String(text ?? '').split('\n')) {
    if (!line.startsWith('n/')) continue
    const filePath = normalizeOpenedPath(line.slice(1).trim())
    if (isWatchedDocumentSignal(filePath)) found.push(filePath)
  }
  return uniquePaths(found)
}

export function parseFrontAppInfo(text) {
  const source = String(text ?? '')
  const bundle =
    source.match(/CFBundleIdentifier"\s*=\s*"([^"]+)"/) ||
    source.match(/bundle\s*id"?\s*[:=]\s*"?([A-Za-z0-9._-]+)/i)
  const pidMatch = source.match(/"?pid"?\s*[:=]\s*"?(\d+)/i)
  return {
    bundleId: bundle?.[1] ?? '',
    pid: pidMatch ? Number(pidMatch[1]) : 0,
  }
}

function defaultSchedule(fn, ms) {
  const id = setTimeout(fn, ms)
  return () => clearTimeout(id)
}

/**
 * @param {{
 *   enabled?: boolean
 *   debounceMs?: number
 *   parse: (filePath: string) => unknown
 *   onEffect?: (effect: { action: 'sheet', path: string, report: unknown } | { action: 'note', path: string, message: string }) => void
 *   schedule?: (fn: () => void, ms: number) => () => void
 * }} options
 */
export function createDocumentOpenWatch({
  enabled = false,
  debounceMs = 600,
  parse,
  onEffect,
  schedule = defaultSchedule,
} = {}) {
  let active = enabled === true
  /** @type {Set<string>} */
  const presented = new Set()
  /** @type {{ path: string, kind: 'parse' | 'note' | 'live', fonts?: { postscriptName: string, familyName: string, styleName: string }[] } | null} */
  let pending = null
  let cancelTimer = () => {}

  function flush() {
    const current = pending
    pending = null
    cancelTimer = () => {}
    if (!active || !current) return
    if (current.kind === 'live') {
      const fonts = current.fonts ?? []
      if (fonts.length === 0) return
      onEffect?.({ action: 'live', fonts })
      return
    }
    if (presented.has(current.path)) return
    if (current.kind === 'note') {
      const message = unsupportedDocumentNote(current.path)
      if (!message) return
      presented.add(current.path)
      onEffect?.({ action: 'note', path: current.path, message })
      return
    }
    let report
    try {
      report = parse(current.path)
    } catch {
      return
    }
    presented.add(current.path)
    onEffect?.({ action: 'sheet', path: current.path, report })
  }

  function arm() {
    cancelTimer()
    if (debounceMs <= 0) {
      flush()
      return
    }
    const stop = schedule(() => {
      flush()
    }, debounceMs)
    cancelTimer = typeof stop === 'function' ? stop : () => {}
  }

  return {
    setEnabled(value) {
      const next = value === true
      if (active === next) return
      active = next
      cancelTimer()
      cancelTimer = () => {}
      pending = null
      if (next) presented.clear()
    },
    /**
     * One opened-path event from the macOS observer, or a test.
     * Ignored while the setting is off. One sheet (or one note) per path.
     */
    open(event) {
      if (!active) return
      const bundleId = event?.bundleId
      if (!isWatchedDocumentBundle(bundleId)) return
      const filePath = normalizeOpenedPath(event?.path)
      if (!filePath) return
      const kind = classifyOpenedDocument(filePath)
      if (kind === 'ignore') return
      if (presented.has(filePath)) return
      if (pending && pending.path === filePath) return
      pending = { path: filePath, kind }
      arm()
    },
    /**
     * Fonts InDesign just named. The observer already skips an unchanged list.
     * Coming back to the front sends the list again.
     */
    live(event) {
      if (!active) return
      if (!isInDesignBundle(event?.bundleId)) return
      const fonts = Array.isArray(event?.fonts) ? event.fonts : []
      if (fonts.length === 0) return
      pending = { path: '', kind: 'live', fonts }
      arm()
    },
  }
}

/** The only IPC this watch is allowed to send. There is no activate channel. */
export function documentWatchIpc(effect) {
  if (!effect || effect.action === 'ignore') return null
  if (effect.action === 'sheet') {
    return { channel: 'open-document', payload: { path: effect.path } }
  }
  if (effect.action === 'live') {
    const fonts = Array.isArray(effect.fonts) ? effect.fonts : []
    if (fonts.length === 0) return null
    return { channel: 'open-document', payload: { liveFonts: fonts, name: 'InDesign' } }
  }
  if (effect.action === 'note') {
    const message = typeof effect.message === 'string' ? effect.message.trim() : ''
    if (!message || message.includes('\n')) return null
    return { channel: 'document-watch-note', payload: { path: effect.path, message } }
  }
  return null
}

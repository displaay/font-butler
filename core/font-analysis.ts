/**
 * Off-thread fontkit parse + SHA-256 fingerprint with an in-memory result cache.
 *
 * Architecture (this PR): a **single `worker_threads` worker**, not a pool.
 * Bulk import/plan/apply enqueue jobs; the API worker's event loop stays free
 * for `/api/font-file`, SSE, and Settings. Results are keyed by
 * `path + mtimeMs + size + previewMeta` so `planImport` / `classifyImportFile`
 * feed `importOneUnlocked` without reopening the file.
 *
 * If the worker cannot start (tests without a TS loader, etc.), we fall back to
 * the same staged parse on the API thread, still yielding between files.
 *
 * Worker `execArgv` is resolved tsx loader flags only (never a copy of
 * `process.execArgv`). Node 24 rejects inherited flags such as `--node-snapshot`
 * with `ERR_WORKER_INVALID_EXEC_ARGV`, which used to silently fall back to the
 * API thread. Jobs wait for the worker `online` event before `postMessage`.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { yieldEventLoop } from './event-loop.ts'
import { fingerprintFile } from './fingerprint.ts'
import {
  beginParseFontFile,
  readFileStat,
  type ParsedFont,
} from './parse.ts'
import type {
  FontAnalysisWorkerMessage,
  FontAnalysisWorkerRequest,
} from './font-analysis-worker.ts'

export type FontAnalysis = {
  path: string
  mtimeMs: number
  size: number
  fingerprint: string
  parsed: ParsedFont
}

export type FontAnalysisStats = {
  parses: number
  fingerprints: number
  cacheHits: number
  workerJobs: number
  fallbackJobs: number
  yields: number
}

export type AnalyzeFontOptions = {
  previewMeta?: boolean
  /** Called when faces (and fingerprint) are ready, before cmap sample probing. */
  onPartial?: (analysis: FontAnalysis) => void
}

const cache = new Map<string, FontAnalysis>()
const inflight = new Map<string, Promise<FontAnalysis>>()
const stats: FontAnalysisStats = {
  parses: 0,
  fingerprints: 0,
  cacheHits: 0,
  workerJobs: 0,
  fallbackJobs: 0,
  yields: 0,
}

let worker: Worker | null = null
let workerFailed = process.env.FONT_BUTLER_PARSE_WORKER === '0'
let workerReady: Promise<boolean> = Promise.resolve(false)
let nextJobId = 0
let failAfterPartialOnce = false
const workerJobs = new Map<
  string,
  {
    onPartial?: (analysis: FontAnalysis) => void
    resolve: (analysis: FontAnalysis) => void
    reject: (error: Error) => void
  }
>()

/** Test-only: reject after faces/onPartial so import can prove catalog rollback. */
export function __failAfterPartialOnceForTests(): void {
  failAfterPartialOnce = true
}

function cacheKey(
  filePath: string,
  stat: { mtimeMs: number; size: number },
  previewMeta?: boolean,
): string {
  return `${filePath}\0${stat.mtimeMs}\0${stat.size}\0${previewMeta ? '1' : '0'}`
}

function isComplete(analysis: FontAnalysis): boolean {
  return typeof analysis.parsed.previewSample === 'string'
}

function remember(key: string, analysis: FontAnalysis): void {
  cache.set(key, analysis)
}

export function fontAnalysisStats(): FontAnalysisStats {
  return { ...stats }
}

export function resetFontAnalysisCache(): void {
  cache.clear()
  inflight.clear()
  stats.parses = 0
  stats.fingerprints = 0
  stats.cacheHits = 0
  stats.workerJobs = 0
  stats.fallbackJobs = 0
  stats.yields = 0
}

export function peekFontAnalysis(
  filePath: string,
  options?: { previewMeta?: boolean; stat?: { mtimeMs: number; size: number } },
): FontAnalysis | undefined {
  const resolved = path.resolve(filePath)
  const stat = options?.stat ?? (existsSync(resolved) ? readFileStat(resolved) : undefined)
  if (!stat) return undefined
  return cache.get(cacheKey(resolved, stat, options?.previewMeta))
}

export function rememberFontAnalysis(
  analysis: FontAnalysis,
  options?: { previewMeta?: boolean },
): void {
  remember(cacheKey(analysis.path, analysis, options?.previewMeta), analysis)
}

function workerUrl(): URL {
  const here = fileURLToPath(import.meta.url)
  const dir = path.dirname(here)
  const bundled = path.join(dir, 'font-analysis-worker.mjs')
  if (here.endsWith('.mjs') && existsSync(bundled)) {
    return pathToFileURL(bundled)
  }
  const tsWorker = path.join(dir, 'font-analysis-worker.ts')
  if (existsSync(tsWorker)) {
    return pathToFileURL(tsWorker)
  }
  return new URL('./font-analysis-worker.ts', import.meta.url)
}

const require = createRequire(import.meta.url)

function tsxLoaderExecArgv(): string[] {
  try {
    const root = path.dirname(require.resolve('tsx/package.json'))
    return [
      '--require',
      path.join(root, 'dist/preflight.cjs'),
      '--import',
      pathToFileURL(path.join(root, 'dist/loader.mjs')).href,
    ]
  } catch {
    return ['--import', 'tsx']
  }
}

function workerThreadExecArgv(url: URL): string[] {
  // Never inherit `process.execArgv` (Node 24 `--node-snapshot` →
  // ERR_WORKER_INVALID_EXEC_ARGV). Packaged `.mjs` needs no loader.
  if (url.pathname.endsWith('.ts')) return tsxLoaderExecArgv()
  return []
}

function failWorkerJobs(error: Error): void {
  const pending = [...workerJobs.values()]
  workerJobs.clear()
  for (const job of pending) job.reject(error)
}

class FontAnalysisWorkerJobError extends Error {
  override name = 'FontAnalysisWorkerJobError'
}

const TSX_LOADER_FLAGS = new Set(['--import', '--require', '-r', '--loader', '--experimental-loader'])

function isTsxLoaderSpec(value: string): boolean {
  const normalized = value.replace(/\\/g, '/').toLowerCase()
  if (normalized === 'tsx' || normalized.startsWith('tsx/')) return true
  if (normalized.includes('/node_modules/tsx/')) return true
  return /\/tsx\/dist\/(?:loader|preflight|esm|cjs)/.test(normalized)
}

/** tsx loader flags only — never forward the parent's full `process.execArgv`. */
export function execArgvForFontAnalysisWorker(execArgv: readonly string[]): string[] {
  const filtered: string[] = []
  const seen = new Set<string>()
  const push = (...flags: string[]) => {
    const key = flags.join('\0')
    if (seen.has(key)) return
    seen.add(key)
    filtered.push(...flags)
  }
  for (let i = 0; i < execArgv.length; i += 1) {
    const arg = execArgv[i]!
    const equals = arg.indexOf('=')
    if (equals > 0 && TSX_LOADER_FLAGS.has(arg.slice(0, equals))) {
      if (isTsxLoaderSpec(arg.slice(equals + 1))) push(arg)
      continue
    }
    if (!TSX_LOADER_FLAGS.has(arg)) continue
    const next = execArgv[i + 1]
    if (next && isTsxLoaderSpec(next)) {
      push(arg, next)
      i += 1
    }
  }
  return filtered.length > 0 ? filtered : ['--import', 'tsx']
}

function ensureWorker(): Worker | null {
  if (workerFailed) return null
  if (worker) return worker
  try {
    const url = workerUrl()
    const next = new Worker(url, { execArgv: workerThreadExecArgv(url) })
    workerReady = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000)
      const onOnline = () => {
        clearTimeout(timer)
        next.off('error', onError)
        next.unref()
        resolve(true)
      }
      const onError = () => {
        clearTimeout(timer)
        next.off('online', onOnline)
        resolve(false)
      }
      next.once('online', onOnline)
      next.once('error', onError)
    })
    next.on('message', (message: FontAnalysisWorkerMessage) => {
      const job = workerJobs.get(message.id)
      if (!job) return
      if (message.stage === 'error') {
        workerJobs.delete(message.id)
        job.reject(new FontAnalysisWorkerJobError(message.error))
        return
      }
      const analysis: FontAnalysis = {
        path: message.path,
        mtimeMs: message.mtimeMs,
        size: message.size,
        fingerprint: message.fingerprint,
        parsed: message.parsed,
      }
      if (message.stage === 'faces') {
        try {
          job.onPartial?.(analysis)
          if (failAfterPartialOnce) {
            failAfterPartialOnce = false
            throw new Error('test: fail after partial')
          }
        } catch (error) {
          workerJobs.delete(message.id)
          job.reject(error instanceof Error ? error : new Error(String(error)))
        }
        return
      }
      workerJobs.delete(message.id)
      job.resolve(analysis)
    })
    next.on('error', (error) => {
      workerFailed = true
      worker = null
      failWorkerJobs(error instanceof Error ? error : new Error(String(error)))
    })
    next.on('exit', (code) => {
      if (!worker) return
      worker = null
      if (code !== 0) workerFailed = true
      if (workerJobs.size === 0) return
      failWorkerJobs(new Error(`Font analysis worker exited (${code ?? 'unknown'})`))
    })
    worker = next
    return next
  } catch {
    workerFailed = true
    return null
  }
}

function analyzeOnThisThread(filePath: string, options?: AnalyzeFontOptions): FontAnalysis {
  stats.fallbackJobs += 1
  stats.parses += 1
  stats.fingerprints += 1
  const resolved = path.resolve(filePath)
  const stat = readFileStat(resolved)
  const fingerprint = fingerprintFile(resolved)
  const session = beginParseFontFile(resolved, { previewMeta: options?.previewMeta })
  const partial: FontAnalysis = {
    path: resolved,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    fingerprint,
    parsed: session.parsed,
  }
  options?.onPartial?.(partial)
  if (failAfterPartialOnce) {
    failAfterPartialOnce = false
    throw new Error('test: fail after partial')
  }
  return {
    ...partial,
    parsed: session.completePreview(),
  }
}

async function postWorkerJob(
  thread: Worker,
  filePath: string,
  options?: AnalyzeFontOptions,
): Promise<FontAnalysis> {
  const online = await workerReady
  if (!online || worker !== thread) {
    workerFailed = true
    throw new Error('Font analysis worker failed to start')
  }
  stats.workerJobs += 1
  stats.parses += 1
  stats.fingerprints += 1
  const id = String(++nextJobId)
  const request: FontAnalysisWorkerRequest = {
    id,
    path: path.resolve(filePath),
    previewMeta: options?.previewMeta,
  }
  return new Promise<FontAnalysis>((resolve, reject) => {
    workerJobs.set(id, { onPartial: options?.onPartial, resolve, reject })
    thread.postMessage(request)
  })
}

export async function analyzeFontFile(
  filePath: string,
  options?: AnalyzeFontOptions,
): Promise<FontAnalysis> {
  stats.yields += 1
  await yieldEventLoop()
  const resolved = path.resolve(filePath)
  const stat = readFileStat(resolved)
  const key = cacheKey(resolved, stat, options?.previewMeta)
  const cached = cache.get(key)
  if (cached && isComplete(cached)) {
    stats.cacheHits += 1
    return cached
  }
  const running = inflight.get(key)
  if (running) {
    if (cached) options?.onPartial?.(cached)
    return running
  }
  const job = (async () => {
    const thread = ensureWorker()
    try {
      const analysis = thread
        ? await postWorkerJob(thread, resolved, {
            previewMeta: options?.previewMeta,
            onPartial(partial) {
              remember(key, partial)
              options?.onPartial?.(partial)
            },
          })
        : analyzeOnThisThread(resolved, options)
      remember(key, analysis)
      return analysis
    } catch (error) {
      // Per-file worker errors must not retry on the API thread.
      // Only fall back when a posted worker job died with the worker itself.
      if (thread && workerFailed && !(error instanceof FontAnalysisWorkerJobError)) {
        const analysis = analyzeOnThisThread(resolved, options)
        remember(key, analysis)
        return analysis
      }
      throw error
    }
  })()
  inflight.set(key, job)
  try {
    return await job
  } finally {
    inflight.delete(key)
  }
}

export function analyzeFontFileSync(filePath: string, options?: AnalyzeFontOptions): FontAnalysis {
  const resolved = path.resolve(filePath)
  const stat = readFileStat(resolved)
  const key = cacheKey(resolved, stat, options?.previewMeta)
  const cached = cache.get(key)
  if (cached && isComplete(cached)) {
    stats.cacheHits += 1
    return cached
  }
  const analysis = analyzeOnThisThread(resolved, options)
  remember(key, analysis)
  return analysis
}

export function analysisFromPlanItem(item: {
  path: string
  faces?: ParsedFont['faces']
  format?: string
  previewSample?: string
  fingerprint?: string
  sourceMtimeMs?: number
  sourceSize?: number
}): FontAnalysis | undefined {
  if (!item.faces?.length || !item.format) return undefined
  if (item.sourceMtimeMs == null || item.sourceSize == null) return undefined
  const resolved = path.resolve(item.path)
  let stat: { mtimeMs: number; size: number }
  try {
    stat = readFileStat(resolved)
  } catch {
    return undefined
  }
  if (stat.mtimeMs !== item.sourceMtimeMs || stat.size !== item.sourceSize) {
    return undefined
  }
  return {
    path: resolved,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    fingerprint: item.fingerprint ?? '',
    parsed: {
      faces: item.faces,
      format: item.format,
      previewSample: item.previewSample,
    },
  }
}

export async function closeFontAnalysisWorker(): Promise<void> {
  const current = worker
  worker = null
  workerReady = Promise.resolve(false)
  workerFailed = process.env.FONT_BUTLER_PARSE_WORKER === '0'
  failWorkerJobs(new Error('Font analysis worker closed'))
  if (!current) return
  current.removeAllListeners()
  await current.terminate()
  await yieldEventLoop()
}

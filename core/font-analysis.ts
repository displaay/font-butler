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
 */
import { existsSync } from 'node:fs'
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
let nextJobId = 0
const workerJobs = new Map<
  string,
  {
    onPartial?: (analysis: FontAnalysis) => void
    resolve: (analysis: FontAnalysis) => void
    reject: (error: Error) => void
  }
>()

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

function failWorkerJobs(error: Error): void {
  const pending = [...workerJobs.values()]
  workerJobs.clear()
  for (const job of pending) job.reject(error)
}

function ensureWorker(): Worker | null {
  if (workerFailed) return null
  if (worker) return worker
  try {
    const url = workerUrl()
    const execArgv = url.pathname.endsWith('.ts') ? ['--import', 'tsx'] : undefined
    const next = new Worker(url, { execArgv })
    next.unref()
    next.on('message', (message: FontAnalysisWorkerMessage) => {
      const job = workerJobs.get(message.id)
      if (!job) return
      if (message.stage === 'error') {
        workerJobs.delete(message.id)
        job.reject(new Error(message.error))
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
        job.onPartial?.(analysis)
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
  return {
    ...partial,
    parsed: session.completePreview(),
  }
}

function analyzeOnWorker(filePath: string, options?: AnalyzeFontOptions): Promise<FontAnalysis> {
  const thread = ensureWorker()
  if (!thread) {
    return Promise.resolve(analyzeOnThisThread(filePath, options))
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
    try {
      const analysis = await analyzeOnWorker(resolved, {
        previewMeta: options?.previewMeta,
        onPartial(partial) {
          remember(key, partial)
          options?.onPartial?.(partial)
        },
      })
      remember(key, analysis)
      return analysis
    } catch (error) {
      if (workerFailed || workerJobs.size === 0) {
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
  return {
    path: path.resolve(item.path),
    mtimeMs: item.sourceMtimeMs ?? 0,
    size: item.sourceSize ?? 0,
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
  failWorkerJobs(new Error('Font analysis worker closed'))
  if (!current) return
  await current.terminate()
}

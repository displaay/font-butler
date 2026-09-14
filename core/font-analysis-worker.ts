import { parentPort } from 'node:worker_threads'
import { fingerprintFile } from './fingerprint.ts'
import { beginParseFontFile, readFileStat } from './parse.ts'
import type { ParsedFont } from './parse.ts'

export type FontAnalysisWorkerRequest = {
  id: string
  path: string
  previewMeta?: boolean
}

export type FontAnalysisWorkerFaces = {
  id: string
  stage: 'faces'
  path: string
  mtimeMs: number
  size: number
  fingerprint: string
  parsed: ParsedFont
}

export type FontAnalysisWorkerDone = {
  id: string
  stage: 'done'
  path: string
  mtimeMs: number
  size: number
  fingerprint: string
  parsed: ParsedFont
}

export type FontAnalysisWorkerError = {
  id: string
  stage: 'error'
  error: string
}

export type FontAnalysisWorkerMessage =
  | FontAnalysisWorkerFaces
  | FontAnalysisWorkerDone
  | FontAnalysisWorkerError

if (!parentPort) {
  throw new Error('font-analysis-worker must run as a worker thread')
}

parentPort.on('message', (message: FontAnalysisWorkerRequest) => {
  const { id, path: filePath, previewMeta } = message
  try {
    const stat = readFileStat(filePath)
    const fingerprint = fingerprintFile(filePath)
    const session = beginParseFontFile(filePath, { previewMeta })
    parentPort!.postMessage({
      id,
      stage: 'faces',
      path: filePath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      fingerprint,
      parsed: session.parsed,
    } satisfies FontAnalysisWorkerFaces)
    const parsed = session.completePreview()
    parentPort!.postMessage({
      id,
      stage: 'done',
      path: filePath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      fingerprint,
      parsed,
    } satisfies FontAnalysisWorkerDone)
  } catch (error) {
    parentPort!.postMessage({
      id,
      stage: 'error',
      error: error instanceof Error ? error.message : String(error),
    } satisfies FontAnalysisWorkerError)
  }
})

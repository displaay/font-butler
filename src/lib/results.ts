export type BatchOutcome = {
  succeeded?: number
  failed?: number
  skipped?: number
  errors?: string[]
  failedIds?: string[]
  preview?: number
}

export function batchResultCopy(
  done: string,
  outcome?: BatchOutcome,
): { message: string; failedIds: string[] } {
  if (!outcome) return { message: done, failedIds: [] }
  const succeeded = outcome.succeeded ?? 0
  const failed = outcome.failed ?? 0
  const skipped = outcome.skipped ?? 0
  const preview = outcome.preview ?? 0
  if (failed === 0 && skipped === 0 && preview === 0) {
    return { message: done, failedIds: [] }
  }
  const parts = [
    succeeded ? `${succeeded} succeeded` : '',
    failed ? `${failed} failed` : '',
    skipped ? `${skipped} skipped` : '',
    preview ? `${preview} preview-only` : '',
  ].filter(Boolean)
  return {
    message: parts.length ? `${done} · ${parts.join(' · ')}` : done,
    failedIds: outcome.failedIds ?? [],
  }
}

export const FONT_FILE_ACCEPT = '.ttf,.otf,.ttc,.otc,.woff,.woff2'

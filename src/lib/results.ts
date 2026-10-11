export type BatchOutcome = {
  succeeded?: number
  failed?: number
  skipped?: number
  errors?: string[]
  failedIds?: string[]
  preview?: number
}

/**
 * Any partial uninstall-and-unlink should warn, including a mix of removed and still-listed fonts.
 * The success toast would otherwise say every font was uninstalled and unlinked.
 */
export function partialUnlinkWarning(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const value = result as { removed?: unknown; partial?: unknown; error?: unknown }
  if (value.partial !== true) return null
  if (typeof value.error === 'string' && value.error.length > 0) return value.error
  if (typeof value.removed === 'number' && value.removed > 0) {
    return 'Uninstalled and unlinked some fonts. Others are still listed.'
  }
  return 'Could not uninstall and unlink that font.'
}

/** A mixed unlink still shows the success toast for the rows that were removed. */
export function partialUnlinkKeepsDoneToast(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const removed = (result as { removed?: unknown }).removed
  return typeof removed === 'number' && removed > 0
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

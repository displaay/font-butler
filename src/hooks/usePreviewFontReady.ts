import { useEffect, useState } from 'react'
import {
  isPreviewFontFailed,
  isPreviewFontReady,
  retryPreviewFamily,
  subscribePreviewFonts,
} from '@/lib/previewReady'

export type PreviewFontStatus = {
  /** The face is loaded and safe to paint. A failure is not ready. */
  ready: boolean
  failed: boolean
  retry: () => void
}

function readStatus(
  family: string,
  weight: number,
  italic: boolean,
  enabled: boolean,
): Pick<PreviewFontStatus, 'ready' | 'failed'> {
  if (!enabled) return { ready: true, failed: false }
  const settled = isPreviewFontReady(family, weight, italic)
  const failed = isPreviewFontFailed(family, weight, italic)
  return { ready: settled && !failed, failed }
}

export function usePreviewFontStatus(
  family: string,
  weight = 400,
  italic = false,
  enabled = true,
): PreviewFontStatus {
  const [status, setStatus] = useState(() => readStatus(family, weight, italic, enabled))
  const [tracked, setTracked] = useState({ family, weight, italic, enabled })
  if (
    tracked.family !== family ||
    tracked.weight !== weight ||
    tracked.italic !== italic ||
    tracked.enabled !== enabled
  ) {
    setTracked({ family, weight, italic, enabled })
    setStatus(readStatus(family, weight, italic, enabled))
  }

  useEffect(() => {
    if (!enabled) return
    function check() {
      setStatus((current) => {
        const next = readStatus(family, weight, italic, true)
        return current.ready === next.ready && current.failed === next.failed ? current : next
      })
    }
    // A load can settle before this effect subscribes. Read once, then stay subscribed
    // so a later timeout or Retry still reaches this card.
    const stop = subscribePreviewFonts(check)
    check()
    return () => stop()
  }, [family, weight, italic, enabled])

  return {
    ready: status.ready,
    failed: status.failed,
    retry: () => retryPreviewFamily(family),
  }
}

export function usePreviewFontReady(
  family: string,
  weight = 400,
  italic = false,
  enabled = true,
): boolean {
  return usePreviewFontStatus(family, weight, italic, enabled).ready
}

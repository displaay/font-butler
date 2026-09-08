import { useEffect, useState } from 'react'
import { isPreviewFontReady, subscribePreviewFonts } from '@/lib/previewReady'

export function usePreviewFontReady(family: string, weight = 400, italic = false): boolean {
  const [ready, setReady] = useState(() => isPreviewFontReady(family, weight, italic))

  useEffect(() => {
    let stop: (() => void) | undefined
    function check() {
      if (isPreviewFontReady(family, weight, italic)) {
        setReady(true)
        stop?.()
        stop = undefined
        return true
      }
      setReady(false)
      return false
    }
    if (check()) return
    stop = subscribePreviewFonts(check)
    return () => stop?.()
  }, [family, weight, italic])

  return ready
}

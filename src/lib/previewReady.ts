const GENERIC_FAMILIES = new Set([
  'ui-sans-serif',
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',
  'ui-monospace',
  'inherit',
  'unset',
  'cursive',
  'fantasy',
])

type PreviewFontsListener = () => void

const listeners = new Set<PreviewFontsListener>()
let interval: ReturnType<typeof setInterval> | null = null

function notifyPreviewFonts() {
  for (const listener of listeners) listener()
}

function ensurePreviewFontTicking() {
  if (typeof document === 'undefined' || !document.fonts) return
  if (interval != null) return
  document.fonts.addEventListener('loadingdone', notifyPreviewFonts)
  document.fonts.addEventListener('loadingerror', notifyPreviewFonts)
  interval = setInterval(notifyPreviewFonts, 100)
}

function stopPreviewFontTicking() {
  if (listeners.size > 0) return
  if (interval != null) {
    clearInterval(interval)
    interval = null
  }
  if (typeof document === 'undefined' || !document.fonts) return
  document.fonts.removeEventListener('loadingdone', notifyPreviewFonts)
  document.fonts.removeEventListener('loadingerror', notifyPreviewFonts)
}

export function normalizePreviewFamily(family: string): string {
  return family.replace(/^["']|["']$/g, '').trim()
}

export function isGenericPreviewFamily(family: string): boolean {
  const name = normalizePreviewFamily(family).toLowerCase()
  return !name || GENERIC_FAMILIES.has(name)
}

export function isPreviewFontReady(
  family: string,
  weight = 400,
  italic = false,
): boolean {
  if (isGenericPreviewFamily(family)) return true
  if (typeof document === 'undefined' || !document.fonts) return false
  const name = normalizePreviewFamily(family).toLowerCase()
  let matched = false
  let loaded = false
  document.fonts.forEach((face) => {
    if (normalizePreviewFamily(face.family).toLowerCase() !== name) return
    matched = true
    if (face.status === 'loaded') loaded = true
  })
  if (loaded) return true
  if (matched) {
    const spec = `${italic ? 'italic' : 'normal'} ${weight} 24px "${normalizePreviewFamily(family)}"`
    void document.fonts.load(spec)
  }
  return false
}

export function subscribePreviewFonts(listener: PreviewFontsListener): () => void {
  listeners.add(listener)
  ensurePreviewFontTicking()
  return () => {
    listeners.delete(listener)
    stopPreviewFontTicking()
  }
}

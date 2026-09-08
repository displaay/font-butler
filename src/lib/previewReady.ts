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
  interval = setInterval(notifyPreviewFonts, 250)
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

function hasMatchingPreviewFace(name: string): boolean {
  const expected = name.toLowerCase()
  let found = false
  document.fonts.forEach((face) => {
    if (!found && normalizePreviewFamily(face.family).toLowerCase() === expected) {
      found = true
    }
  })
  return found
}

export function isPreviewFontReady(
  family: string,
  weight = 400,
  italic = false,
): boolean {
  if (isGenericPreviewFamily(family)) return true
  if (typeof document === 'undefined' || !document.fonts) return false
  const name = normalizePreviewFamily(family)
  const spec = `${italic ? 'italic' : 'normal'} ${weight} 24px "${name}"`
  try {
    // FontFaceSet.check() is true when nothing matching is pending, including when
    // no @font-face has been registered yet. That would paint fallback text.
    if (hasMatchingPreviewFace(name) && document.fonts.check(spec)) return true
  } catch {
    // Fall through to load() when FontFaceSet.check rejects the descriptor.
  }
  void document.fonts.load(spec)
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

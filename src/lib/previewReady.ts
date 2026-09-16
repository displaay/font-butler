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
const loadPromises = new Map<string, Promise<void>>()
let listening = false

function notifyPreviewFonts() {
  for (const listener of listeners) listener()
}

function ensurePreviewFontListening() {
  if (typeof document === 'undefined' || !document.fonts) return
  if (listening) return
  listening = true
  document.fonts.addEventListener('loadingdone', notifyPreviewFonts)
  document.fonts.addEventListener('loadingerror', notifyPreviewFonts)
}

function stopPreviewFontListening() {
  if (listeners.size > 0) return
  if (!listening) return
  listening = false
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

function previewLoadKey(name: string, weight: number, italic: boolean): string {
  return `${name}\t${weight}\t${italic ? 1 : 0}`
}

function requestPreviewLoad(spec: string, key: string): void {
  if (loadPromises.has(key)) return
  if (typeof document === 'undefined' || !document.fonts) return
  const pending = document.fonts
    .load(spec)
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      notifyPreviewFonts()
    })
  loadPromises.set(key, pending)
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
  requestPreviewLoad(spec, previewLoadKey(name, weight, italic))
  return false
}

export function subscribePreviewFonts(listener: PreviewFontsListener): () => void {
  listeners.add(listener)
  ensurePreviewFontListening()
  return () => {
    listeners.delete(listener)
    stopPreviewFontListening()
  }
}

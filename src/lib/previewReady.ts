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
const readyKeys = new Set<string>()
let faceNames: Set<string> | null = null
let faceNamesSource: unknown
let listening = false

function notifyPreviewFonts() {
  faceNames = null
  faceNamesSource = undefined
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

function matchingPreviewFaceNames(): Set<string> {
  const fonts = typeof document === 'undefined' ? null : document.fonts
  if (faceNames && faceNamesSource === fonts) return faceNames
  const names = new Set<string>()
  fonts?.forEach((face) => {
    names.add(normalizePreviewFamily(face.family).toLowerCase())
  })
  faceNames = names
  faceNamesSource = fonts
  return names
}

function hasMatchingPreviewFace(name: string): boolean {
  return matchingPreviewFaceNames().has(name.toLowerCase())
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
  const key = previewLoadKey(name, weight, italic)
  // Session cache: a preview that already loaded renders instantly on remount
  // (tab switches) instead of flashing the spinner. The face still has to be
  // mounted; pruned faces fall through and drop their cached key.
  if (readyKeys.has(key)) {
    if (hasMatchingPreviewFace(name)) return true
    readyKeys.delete(key)
  }
  const spec = `${italic ? 'italic' : 'normal'} ${weight} 24px "${name}"`
  const hasFace = hasMatchingPreviewFace(name)
  let check = false
  try {
    // FontFaceSet.check() is true when nothing matching is pending, including when
    // no @font-face has been registered yet. That would paint fallback text.
    check = document.fonts.check(spec)
    if (hasFace && check) {
      readyKeys.add(key)
      return true
    }
  } catch {
    // Fall through to load() when FontFaceSet.check rejects the descriptor.
  }
  // Calling load() before @font-face exists resolves empty, so the spinner never
  // uses the family and the browser never fetches the file.
  if (hasFace) requestPreviewLoad(spec, key)
  return false
}

/** Drop cached readiness for families whose preview CSS was rebuilt or pruned. */
export function invalidatePreviewReadyFamilies(families: readonly string[]): void {
  if (families.length === 0) return
  faceNames = null
  faceNamesSource = undefined
  for (const family of families) {
    const prefix = `${normalizePreviewFamily(family)}\t`
    for (const key of readyKeys) {
      if (key.startsWith(prefix)) readyKeys.delete(key)
    }
    for (const key of loadPromises.keys()) {
      if (key.startsWith(prefix)) loadPromises.delete(key)
    }
  }
}

/** Cards wait on this after FontFaceStyles injects @font-face rules. */
export function notifyPreviewCssMounted() {
  notifyPreviewFonts()
}

export function subscribePreviewFonts(listener: PreviewFontsListener): () => void {
  listeners.add(listener)
  ensurePreviewFontListening()
  return () => {
    listeners.delete(listener)
    stopPreviewFontListening()
  }
}

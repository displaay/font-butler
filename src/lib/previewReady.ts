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

/** How long one family may sit in document.fonts.load() before that family is failed. */
export const PREVIEW_LOAD_TIMEOUT_MS = 4000

type PreviewFontsListener = () => void

const listeners = new Set<PreviewFontsListener>()
const loadPromises = new Map<string, Promise<void>>()
const readyKeys = new Set<string>()
// Failed faces stop the spinner. isPreviewFontReady stays true for them so a card
// does not spin forever; isPreviewFontFailed tells the UI to show an error instead
// of painting the unloaded family.
const failedKeys = new Set<string>()
const failedFamilies = new Set<string>()
const retries = new Map<string, number>()
const familyTimers = new Map<string, ReturnType<typeof setTimeout>>()
let faceNames: Set<string> | null = null
let faceNamesSource: unknown
let listening = false
let loadTimeoutMs = PREVIEW_LOAD_TIMEOUT_MS

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
  // Keep the document.fonts listeners for the session. Dropping them when the last
  // card unmounts swallowed loadingdone for a load that outlived the subscriber,
  // and the next mount treated the leftover promise as still in flight.
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

function familyPrefix(name: string): string {
  return `${name}\t`
}

export function previewFacesFailed(statuses: readonly string[]): boolean {
  return statuses.length > 0 && statuses.every((status) => status === 'error')
}

function faceWeightMatches(faceWeight: string | number | undefined, weight: number): boolean {
  if (faceWeight == null || faceWeight === '') return weight === 400
  if (typeof faceWeight === 'number') return faceWeight === weight
  const parts = String(faceWeight)
    .trim()
    .split(/\s+/)
    .map((part) => Number(part))
  if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) {
    const low = Math.min(parts[0]!, parts[1]!)
    const high = Math.max(parts[0]!, parts[1]!)
    return weight >= low && weight <= high
  }
  const exact = Number(faceWeight)
  return Number.isFinite(exact) && exact === weight
}

function previewFaceStatus(name: string, weight: number, italic: boolean): string | undefined {
  if (typeof document === 'undefined' || !document.fonts) return undefined
  let status: string | undefined
  let sawError = false
  document.fonts.forEach((face) => {
    if (normalizePreviewFamily(face.family).toLowerCase() !== name.toLowerCase()) return
    if (!faceWeightMatches(face.weight, weight)) return
    const faceItalic = face.style === 'italic' || face.style === 'oblique'
    if (faceItalic !== italic) return
    if (face.status === 'error') sawError = true
    status = face.status
  })
  return sawError ? 'error' : status
}

function previewSpec(name: string, weight: number, italic: boolean): string {
  return `${italic ? 'italic' : 'normal'} ${weight} 24px "${name}"`
}

function clearFamilyTimer(name: string) {
  const timer = familyTimers.get(name)
  if (timer == null) return
  clearTimeout(timer)
  familyTimers.delete(name)
}

function inflightForFamily(name: string): boolean {
  const prefix = familyPrefix(name)
  for (const key of loadPromises.keys()) {
    if (key.startsWith(prefix)) return true
  }
  return false
}

function rememberReady(key: string, name: string) {
  readyKeys.add(key)
  failedKeys.delete(key)
  retries.delete(key)
  failedFamilies.delete(name)
  clearFamilyTimer(name)
}

function rememberKeyFailure(key: string, name: string) {
  failedKeys.add(key)
  retries.delete(key)
  if (!inflightForFamily(name)) clearFamilyTimer(name)
}

function failFamily(name: string) {
  clearFamilyTimer(name)
  if (failedFamilies.has(name)) return
  failedFamilies.add(name)
  const prefix = familyPrefix(name)
  for (const key of readyKeys) {
    if (key.startsWith(prefix)) readyKeys.delete(key)
  }
  for (const key of loadPromises.keys()) {
    if (key.startsWith(prefix)) loadPromises.delete(key)
  }
  notifyPreviewFonts()
}

function armFamilyTimeout(name: string) {
  if (familyTimers.has(name) || failedFamilies.has(name)) return
  const timer = setTimeout(() => {
    familyTimers.delete(name)
    failFamily(name)
  }, loadTimeoutMs)
  ;(timer as unknown as { unref?: () => void }).unref?.()
  familyTimers.set(name, timer)
}

function faceIsLoaded(name: string, weight: number, italic: boolean): boolean {
  if (typeof document === 'undefined' || !document.fonts) return false
  if (!hasMatchingPreviewFace(name)) return false
  if (previewFaceStatus(name, weight, italic) === 'error') return false
  try {
    return document.fonts.check(previewSpec(name, weight, italic))
  } catch {
    return false
  }
}

function requestPreviewLoad(spec: string, key: string, name: string, weight: number, italic: boolean): void {
  if (loadPromises.has(key) || failedKeys.has(key) || failedFamilies.has(name)) return
  if (typeof document === 'undefined' || !document.fonts) return
  armFamilyTimeout(name)
  const pending = document.fonts
    .load(spec)
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      if (loadPromises.get(key) !== pending) return
      settleLoad(spec, key, name, weight, italic)
    })
  loadPromises.set(key, pending)
}

function settleLoad(spec: string, key: string, name: string, weight: number, italic: boolean) {
  loadPromises.delete(key)
  if (failedFamilies.has(name)) {
    if (faceIsLoaded(name, weight, italic)) rememberReady(key, name)
    notifyPreviewFonts()
    return
  }
  if (previewFaceStatus(name, weight, italic) === 'error') {
    rememberKeyFailure(key, name)
    notifyPreviewFonts()
    return
  }
  if (faceIsLoaded(name, weight, italic)) {
    rememberReady(key, name)
    notifyPreviewFonts()
    return
  }
  const attempts = (retries.get(key) ?? 0) + 1
  if (attempts <= 1) {
    retries.set(key, attempts)
    requestPreviewLoad(spec, key, name, weight, italic)
    return
  }
  rememberKeyFailure(key, name)
  notifyPreviewFonts()
}

export function setPreviewLoadTimeoutForTests(ms: number): void {
  loadTimeoutMs = ms
}

export function isPreviewFontFailed(family: string, weight = 400, italic = false): boolean {
  if (isGenericPreviewFamily(family)) return false
  const name = normalizePreviewFamily(family)
  if (failedFamilies.has(name)) return true
  return failedKeys.has(previewLoadKey(name, weight, italic))
}

export function isPreviewFontReady(family: string, weight = 400, italic = false): boolean {
  if (isGenericPreviewFamily(family)) return true
  if (typeof document === 'undefined' || !document.fonts) return false
  const name = normalizePreviewFamily(family)
  const key = previewLoadKey(name, weight, italic)
  if (faceIsLoaded(name, weight, italic)) {
    rememberReady(key, name)
    return true
  }
  // True here means "stop waiting", including a failed face. Paint only when
  // isPreviewFontFailed is false.
  if (failedFamilies.has(name) || failedKeys.has(key)) return true
  if (readyKeys.has(key)) {
    if (hasMatchingPreviewFace(name)) return true
    readyKeys.delete(key)
  }
  if (loadPromises.has(key)) {
    if (previewFaceStatus(name, weight, italic) === 'error') {
      rememberKeyFailure(key, name)
      loadPromises.delete(key)
      return true
    }
    return false
  }
  const hasFace = hasMatchingPreviewFace(name)
  if (hasFace) requestPreviewLoad(previewSpec(name, weight, italic), key, name, weight, italic)
  return false
}

/** Drop cached readiness for families whose preview CSS was rebuilt or pruned. */
export function invalidatePreviewReadyFamilies(families: readonly string[]): void {
  if (families.length === 0) return
  faceNames = null
  faceNamesSource = undefined
  for (const family of families) {
    const name = normalizePreviewFamily(family)
    const prefix = familyPrefix(name)
    failedFamilies.delete(name)
    clearFamilyTimer(name)
    for (const key of readyKeys) {
      if (key.startsWith(prefix)) readyKeys.delete(key)
    }
    for (const key of failedKeys) {
      if (key.startsWith(prefix)) failedKeys.delete(key)
    }
    for (const key of retries.keys()) {
      if (key.startsWith(prefix)) retries.delete(key)
    }
    for (const key of loadPromises.keys()) {
      if (key.startsWith(prefix)) loadPromises.delete(key)
    }
  }
}

/** Drop one family's failure and ask mounted previews to load it again. */
export function retryPreviewFamily(family: string): void {
  invalidatePreviewReadyFamilies([family])
  notifyPreviewFonts()
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

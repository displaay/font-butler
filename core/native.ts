import path from 'node:path'
import {
  clearAdobeFontCache as realClearAdobeFontCache,
  clearFontCaches as realClearFontCaches,
  clearOfficeFontCache as realClearOfficeFontCache,
  clearUserFontCache as realClearUserFontCache,
  fontActivationStates as realFontActivationStates,
  registerFont as realRegisterFont,
  setFontEnabled as realSetFontEnabled,
  ensureFontActivationNative as realEnsureFontActivation,
  unregisterFont as realUnregisterFont,
  type ActivationQuery,
} from './caches.ts'

export type { ActivationQuery }

export type NativeEnableResult = {
  ok: boolean
  native: boolean
  error?: string
}

export type CacheClearResult = {
  mac: boolean
  cleared: boolean
}

export type FontCachesResult = {
  mac: boolean
  office: boolean
  adobe: boolean
}

export type FontNative = {
  registerFont(filePath: string): Promise<NativeEnableResult>
  unregisterFont(filePath: string): Promise<NativeEnableResult>
  setFontEnabled(filePath: string, enabled: boolean): Promise<NativeEnableResult>
  ensureActivation?(filePath: string, enabled: boolean): Promise<NativeEnableResult>
  fontActivationStates(filePaths: string[]): Promise<ActivationQuery>
  clearUserFontCache(): Promise<CacheClearResult>
  clearOfficeFontCache(): Promise<CacheClearResult>
  clearAdobeFontCache(): Promise<CacheClearResult>
  clearFontCaches(options?: { office?: boolean; adobe?: boolean }): Promise<FontCachesResult>
}

export function noopFontNative(overrides: Partial<FontNative> = {}): FontNative {
  return {
    async registerFont() {
      return { ok: true, native: false }
    },
    async unregisterFont() {
      return { ok: true, native: false }
    },
    async setFontEnabled() {
      return { ok: true, native: false }
    },
    async fontActivationStates(filePaths) {
      const states: Record<string, boolean> = {}
      for (const filePath of filePaths) states[filePath] = true
      return { ok: true, native: false, states }
    },
    async clearUserFontCache() {
      return { mac: false, cleared: false }
    },
    async clearOfficeFontCache() {
      return { mac: false, cleared: false }
    },
    async clearAdobeFontCache() {
      return { mac: false, cleared: false }
    },
    async clearFontCaches() {
      return { mac: false, office: false, adobe: false }
    },
    ...overrides,
  }
}

export function realFontNative(): FontNative {
  return {
    registerFont: realRegisterFont,
    unregisterFont: realUnregisterFont,
    setFontEnabled: realSetFontEnabled,
    ensureActivation: realEnsureFontActivation,
    fontActivationStates: realFontActivationStates,
    clearUserFontCache: realClearUserFontCache,
    clearOfficeFontCache: realClearOfficeFontCache,
    clearAdobeFontCache: realClearAdobeFontCache,
    clearFontCaches: realClearFontCaches,
  }
}

function defaultNative(): FontNative {
  if (process.env.FONT_BUTLER_TEST === '1' && process.env.FONT_BUTLER_NATIVE !== '1') {
    return noopFontNative()
  }
  return realFontNative()
}

let current: FontNative | null = null

export function getFontNative(): FontNative {
  return current ?? defaultNative()
}

export function setFontNative(adapter: FontNative | null): void {
  current = adapter
}

export function activationOf(query: ActivationQuery, filePath: string): boolean | undefined {
  if (Object.hasOwn(query.states, filePath)) {
    return query.states[filePath]
  }
  const resolved = path.resolve(filePath)
  for (const [key, value] of Object.entries(query.states)) {
    if (path.resolve(key) === resolved) return value
  }
  return undefined
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function verifyFontActivation(
  native: FontNative,
  filePath: string,
  enabled: boolean,
): Promise<void> {
  let lastError = 'Could not verify font activation.'
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const query = await native.fontActivationStates([filePath])
    if (!query.ok) {
      lastError = query.error || 'Could not verify font activation.'
      await wait(100)
      continue
    }
    const actual = activationOf(query, filePath)
    if (actual === undefined) {
      lastError = 'macOS did not report that font in the registry.'
      await wait(100)
      continue
    }
    if (actual === enabled) {
      return
    }
    lastError = enabled
      ? 'macOS did not activate the font.'
      : 'macOS did not deactivate the font.'
    await wait(100)
  }
  throw new Error(lastError)
}

export async function ensureFontActivation(
  native: FontNative,
  filePath: string,
  enabled: boolean,
): Promise<void> {
  if (native.ensureActivation) {
    const ensured = await native.ensureActivation(filePath, enabled)
    if (!ensured.ok) {
      throw new Error(
        ensured.error ||
          (enabled ? 'Could not activate the font.' : 'Could not deactivate the font.'),
      )
    }
    return
  }
  if (enabled) {
    const registered = await native.registerFont(filePath)
    if (!registered.ok) {
      throw new Error(registered.error || 'Could not register the font.')
    }
  }
  const result = await native.setFontEnabled(filePath, enabled)
  if (!result.ok) {
    throw new Error(result.error || 'Could not change font activation.')
  }
  if (!result.native) {
    return
  }
  await verifyFontActivation(native, filePath, enabled)
}

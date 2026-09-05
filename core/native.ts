import {
  clearAdobeFontCache as realClearAdobeFontCache,
  clearFontCaches as realClearFontCaches,
  clearOfficeFontCache as realClearOfficeFontCache,
  clearUserFontCache as realClearUserFontCache,
  fontActivationStates as realFontActivationStates,
  registerFont as realRegisterFont,
  setFontEnabled as realSetFontEnabled,
  unregisterFont as realUnregisterFont,
} from './caches.ts'

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
  registerFont(filePath: string): Promise<void>
  unregisterFont(filePath: string): Promise<void>
  setFontEnabled(filePath: string, enabled: boolean): Promise<NativeEnableResult>
  fontActivationStates(filePaths: string[]): Promise<Record<string, boolean>>
  clearUserFontCache(): Promise<CacheClearResult>
  clearOfficeFontCache(): Promise<CacheClearResult>
  clearAdobeFontCache(): Promise<CacheClearResult>
  clearFontCaches(options?: { office?: boolean; adobe?: boolean }): Promise<FontCachesResult>
}

export function noopFontNative(overrides: Partial<FontNative> = {}): FontNative {
  return {
    async registerFont() {},
    async unregisterFont() {},
    async setFontEnabled() {
      return { ok: true, native: false }
    },
    async fontActivationStates(filePaths) {
      const result: Record<string, boolean> = {}
      for (const filePath of filePaths) result[filePath] = true
      return result
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

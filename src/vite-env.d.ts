/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    fontButlerDesktop?: {
      platform: NodeJS.Platform
      getPathForFile: (file: File) => string | undefined
      pickFolder: () => Promise<string | null>
      pickFile?: () => Promise<string | null>
      getApiToken?: () => Promise<string | null>
      requestNotifications: () => Promise<'granted' | 'denied' | 'default'>
      onOpenSettings: (callback: (payload?: { focus?: string }) => void) => () => void
      openExternal?: (url: string) => Promise<boolean>
      installAppUpdate?: () => Promise<{
        ok: boolean
        ignored?: boolean
        error?: string
        mode?: 'inplace' | 'dmg'
        phase?: 'idle' | 'downloading' | 'verifying' | 'installing' | 'opening' | 'error'
        percent?: number
      }>
      getAppUpdateInstallState?: () => Promise<{
        phase?: 'idle' | 'downloading' | 'verifying' | 'installing' | 'opening' | 'error'
        percent?: number
        error?: string
      }>
      onAppUpdateInstall?: (
        callback: (payload: { phase?: string; percent?: number; error?: string }) => void,
      ) => () => void
      onReinstallFonts: (callback: (payload: { ids?: string[] }) => void) => () => void
      onOpenTab: (callback: (payload: { tab?: string; operationId?: string }) => void) => () => void
      onFinderLinkTo?: (callback: (payload: { paths?: string[] }) => void) => () => void
      quitApp?: () => Promise<void>
      showDebugLogs?: () => Promise<boolean>
      signalAppMounted?: () => void
    }
  }
}

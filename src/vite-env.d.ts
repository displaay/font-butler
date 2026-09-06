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
      onOpenSettings: (callback: () => void) => () => void
      onReinstallFonts: (callback: (payload: { ids?: string[] }) => void) => () => void
    }
  }
}

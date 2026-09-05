/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    fontButlerDesktop?: {
      platform: NodeJS.Platform
      getPathForFile: (file: File) => string | undefined
      reveal: (filePath: string) => Promise<void>
      pickFolder: () => Promise<string | null>
      onOpenSettings: (callback: () => void) => () => void
      onReinstallFonts: (callback: (payload: { ids?: string[] }) => void) => () => void
    }
  }
}

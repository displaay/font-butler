/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    fontButlerDesktop?: {
      platform: NodeJS.Platform
      reveal: (filePath: string) => Promise<void>
      pickFolder: () => Promise<string | null>
      onOpenSettings: (callback: () => void) => () => void
    }
  }
}

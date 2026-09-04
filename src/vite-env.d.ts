/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    fontButlerDesktop?: {
      reveal: (filePath: string) => Promise<void>
      pickFolder: () => Promise<string | null>
      onOpenSettings: (callback: () => void) => () => void
    }
  }
}

/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    fontcaseDesktop?: {
      reveal: (filePath: string) => Promise<void>
    }
  }
}

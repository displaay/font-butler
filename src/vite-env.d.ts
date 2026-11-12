/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    fontButlerDesktop?: {
      platform: NodeJS.Platform
      getPathForFile: (file: File) => string | undefined
      pickFolder: () => Promise<string | null>
      pickFile?: () => Promise<string | null>
      pickDocument?: () => Promise<string | null>
      getApiToken?: () => Promise<string | null>
      requestNotifications: () => Promise<'granted' | 'denied' | 'default'>
      onOpenSettings: (callback: (payload?: { focus?: string }) => void) => () => void
      onOpenDocument?: (
        callback: (payload?: {
          path?: string
          liveFonts?: { postscriptName?: string; familyName?: string; styleName?: string }[]
          name?: string
        }) => void,
      ) => () => void
      onDocumentWatchNote?: (callback: (payload?: { path?: string; message?: string }) => void) => () => void
      openExternal?: (url: string) => Promise<boolean>
      openFinderExtensions?: () => Promise<boolean>
      openFinderSyncLoginItems?: () => Promise<boolean>
      getFinderSyncAgentStatus?: () => Promise<{ status?: string; error?: string; enabled?: boolean } | null>
      setFinderSyncAgentEnabled?: (enabled: boolean) => Promise<boolean>
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
      onOpenCompare?: (callback: () => void) => () => void
      onFinderCompare?: (callback: (payload: { paths?: string[] }) => void) => () => void
      pickCompareFonts?: () => Promise<string[] | null>
      onExternalFontOpen?: (callback: (payload: { depth?: number }) => void) => () => void
      quitApp?: () => Promise<void>
      showDebugLogs?: () => Promise<boolean>
      signalAppMounted?: () => void
      onWatchNotices?: (
        callback: (
          notices: Array<{
            kind: 'installed' | 'reinstalled' | 'error' | 'info' | 'warning'
            message: string
            entryId?: string
            operationId?: string
            source?: 'watch'
          }>,
        ) => void,
      ) => () => void
      onAnnouncement?: (
        callback: (payload: {
          id?: string
          title?: string
          body?: string
          celebrate?: boolean
          sinceVersion?: string
          showWhen?: 'upgrade' | 'always' | 'migration-stalled'
        }) => void,
      ) => () => void
      dismissAnnouncement?: (id: string) => void
    }
  }
}

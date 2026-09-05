export const FONT_EXTENSIONS = ['.ttf', '.otf', '.ttc', '.otc'] as const
export const WEB_FONT_EXTENSIONS = ['.woff', '.woff2'] as const

export type FontStatus =
  | 'installed'
  | 'uninstalled'
  | 'outdated'
  | 'source-missing'
  | 'deactivated'

export type FontFaceInfo = {
  familyName: string
  styleName: string
  fullName: string
  postscriptName: string
  isVariable: boolean
  instanceCount: number
  instanceNames: string[]
  weight: number
  italic: boolean
}

export type CatalogEntry = {
  id: string
  sourcePath: string
  sourceMtimeMs: number
  sourceSize: number
  sourcePresent?: boolean
  installedSnapshotMtimeMs?: number
  installedSnapshotSize?: number
  status: FontStatus
  installedPath?: string
  disabledPath?: string
  customFamilyName?: string
  faces: FontFaceInfo[]
  format: string
  addedAt: number
  updatedAt: number
}

export type CatalogFile = {
  version: 1
  entries: CatalogEntry[]
}

export type SystemFace = {
  path: string
  familyName: string
  styleName: string
  fullName: string
  postscriptName: string
  isVariable: boolean
  instanceCount: number
  instanceNames?: string[]
  weight?: number
  italic?: boolean
  format: string
  protected: boolean
  writable: boolean
  managedId?: string
}

export type Notice = {
  kind: 'installed' | 'reinstalled' | 'error' | 'info'
  message: string
  entryId?: string
}

export type ViewLayout = 'list' | 'grid'

export type SortMode = 'name' | 'added'

export type ThemeMode = 'light' | 'dark' | 'system'

export type AppSettings = {
  version: 1
  watchFolders: string[]
  defaultView: ViewLayout
  defaultSort: SortMode
  installAfterUpload: boolean
  installWatchFolderFonts: boolean
  theme: ThemeMode
  menuBarIcon: boolean
  openAtLogin: boolean
  clearOfficeFontCache: boolean
  clearAdobeFontCache: boolean
  autoReinstallOnUpdate: boolean
  skipCacheClearOnReinstall: boolean
}

export type OfficeFontCacheInfo = {
  path: string
  exists: boolean
}

export type AdobeFontCacheInfo = {
  exists: boolean
  paths: string[]
  roots: string[]
}

export type ServiceEvent =
  | { type: 'catalog'; entries: CatalogEntry[] }
  | { type: 'system'; faces: SystemFace[] }
  | { type: 'notice'; notice: Notice }
  | { type: 'settings'; settings: AppSettings }

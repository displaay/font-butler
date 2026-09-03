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

export type SystemFace = {
  path: string
  familyName: string
  styleName: string
  fullName: string
  postscriptName: string
  isVariable: boolean
  instanceCount: number
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

export type FamilyGroup = {
  key: string
  familyName: string
  entries: CatalogEntry[]
  faces: FontFaceInfo[]
  isVariable: boolean
  instanceCount: number
  status: FontStatus
  previewEntryId: string
}

export type SystemFamilyGroup = {
  key: string
  familyName: string
  faces: SystemFace[]
  isVariable: boolean
  instanceCount: number
  protected: boolean
  writable: boolean
}

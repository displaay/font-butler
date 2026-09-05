import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { inspectSourceAvailability } from './state.ts'
import type {
  AppSettings,
  DestinationId,
  FolderPolicyPreset,
  SourceAvailability,
  WatchFolder,
} from './types.ts'

export const DEFAULT_REVISION_BUDGET_BYTES = 1024 * 1024 * 1024
export const DEFAULT_ACTIVITY_RETENTION_DAYS = 90
export const DEFAULT_ACTIVITY_MAX_OPERATIONS = 10_000

export function policyFlags(policy: FolderPolicyPreset): { installNew: boolean; autoUpdate: boolean } {
  switch (policy) {
    case 'library':
      return { installNew: false, autoUpdate: false }
    case 'install-new':
      return { installNew: true, autoUpdate: false }
    case 'install-new-and-updates':
      return { installNew: true, autoUpdate: true }
    case 'custom':
      return { installNew: false, autoUpdate: true }
  }
}

export function policyFromFlags(installNew: boolean, autoUpdate: boolean): FolderPolicyPreset {
  if (installNew && autoUpdate) return 'install-new-and-updates'
  if (installNew && !autoUpdate) return 'install-new'
  if (!installNew && autoUpdate) return 'custom'
  return 'library'
}

export function policyLabel(folder: WatchFolder): string {
  switch (folder.policy) {
    case 'library':
      return 'Add to library'
    case 'install-new':
      return 'Install new fonts'
    case 'install-new-and-updates':
      return 'Install new fonts and updates'
    case 'custom':
      return 'Updates only (preserved setting)'
  }
}

export function createWatchFolder(
  root: string,
  options: {
    policy?: FolderPolicyPreset
    installNew?: boolean
    autoUpdate?: boolean
    paused?: boolean
    watching?: boolean
    exclusions?: string[]
    id?: string
    destinationId?: DestinationId
  } = {},
): WatchFolder {
  const resolved = path.resolve(root)
  const installNew = options.installNew ?? policyFlags(options.policy ?? 'library').installNew
  const autoUpdate = options.autoUpdate ?? policyFlags(options.policy ?? 'library').autoUpdate
  const policy = options.policy ?? policyFromFlags(installNew, autoUpdate)
  return {
    id: options.id ?? crypto.randomUUID(),
    root: resolved,
    policy,
    installNew,
    autoUpdate,
    paused: options.paused === true,
    watching: options.watching === true,
    exclusions: options.exclusions ?? [],
    availability: inspectFolderAvailability(resolved),
    destinationId: options.destinationId === 'adobe-shared' ? 'adobe-shared' : 'macos',
  }
}

export function inspectFolderAvailability(root: string): SourceAvailability {
  try {
    if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
      fs.accessSync(root, fs.constants.R_OK)
      return 'present'
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code === 'EACCES' || code === 'EPERM') {
      return 'unreadable'
    }
  }
  return inspectSourceAvailability(path.join(root, '.font-butler-probe'), {
    linked: true,
    external: true,
  })
}

export function migrateFolders(
  watchFolders: string[],
  existing: unknown,
  flags: { installNew: boolean; autoUpdate: boolean },
): WatchFolder[] {
  if (Array.isArray(existing) && existing.length) {
    return existing
      .map((item) => normalizeFolder(item, flags))
      .filter((item): item is WatchFolder => Boolean(item))
  }
  return watchFolders.map((root) =>
    createWatchFolder(root, {
      installNew: flags.installNew,
      autoUpdate: flags.autoUpdate,
      watching: true,
    }),
  )
}

function normalizeFolder(value: unknown, flags: { installNew: boolean; autoUpdate: boolean }): WatchFolder | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<WatchFolder>
  if (typeof row.root !== 'string' || !row.root.trim()) return null
  const installNew = typeof row.installNew === 'boolean' ? row.installNew : flags.installNew
  const autoUpdate = typeof row.autoUpdate === 'boolean' ? row.autoUpdate : flags.autoUpdate
  return createWatchFolder(row.root, {
    id: typeof row.id === 'string' ? row.id : undefined,
    policy: row.policy,
    installNew,
    autoUpdate,
    paused: row.paused === true,
    watching: row.watching !== false,
    exclusions: Array.isArray(row.exclusions)
      ? row.exclusions.filter((item): item is string => typeof item === 'string')
      : [],
    destinationId: row.destinationId === 'adobe-shared' ? 'adobe-shared' : 'macos',
  })
}

export function syncWatchFolderPaths(settings: AppSettings): AppSettings {
  settings.watchFolders = settings.folders.map((folder) => folder.root)
  return settings
}

export function folderForPath(folders: WatchFolder[], filePath: string): WatchFolder | undefined {
  const resolved = path.resolve(filePath)
  const matches = folders.filter((folder) => {
    const root = path.resolve(folder.root)
    return resolved === root || resolved.startsWith(`${root}${path.sep}`)
  })
  if (matches.length === 0) return undefined
  return matches.sort((a, b) => b.root.length - a.root.length)[0]
}

export function mostSpecificOwner(
  folders: WatchFolder[],
  filePath: string,
  currentOwnerId?: string | null,
): WatchFolder | undefined {
  if (currentOwnerId) {
    const current = folders.find((folder) => folder.id === currentOwnerId)
    if (current) return current
  }
  return folderForPath(folders, filePath)
}

export function isExcluded(folder: WatchFolder, filePath: string): boolean {
  if (folder.exclusions.length === 0) return false
  const root = path.resolve(folder.root)
  const resolved = path.resolve(filePath)
  const relative = path.relative(root, resolved).split(path.sep).join('/')
  if (relative.startsWith('..')) return false
  return folder.exclusions.some((pattern) => matchExclusion(relative, pattern))
}

function matchExclusion(relativePath: string, pattern: string): boolean {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized) return false
  if (normalized.includes('*')) {
    const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
    return new RegExp(`^${escaped}(?:/|$)`).test(relativePath)
  }
  return relativePath === normalized || relativePath.startsWith(`${normalized}/`)
}

export function applyFolderPatch(
  folder: WatchFolder,
  patch: Partial<Pick<WatchFolder, 'policy' | 'installNew' | 'autoUpdate' | 'paused' | 'watching' | 'exclusions' | 'root' | 'destinationId'>>,
): WatchFolder {
  const next = { ...folder }
  if (patch.root) next.root = path.resolve(patch.root)
  if (patch.policy) {
    next.policy = patch.policy
    const flags = policyFlags(patch.policy)
    next.installNew = flags.installNew
    next.autoUpdate = flags.autoUpdate
  }
  if (typeof patch.installNew === 'boolean') next.installNew = patch.installNew
  if (typeof patch.autoUpdate === 'boolean') next.autoUpdate = patch.autoUpdate
  if (patch.policy === undefined && (typeof patch.installNew === 'boolean' || typeof patch.autoUpdate === 'boolean')) {
    next.policy = policyFromFlags(next.installNew, next.autoUpdate)
  }
  if (typeof patch.paused === 'boolean') next.paused = patch.paused
  if (typeof patch.watching === 'boolean') next.watching = patch.watching
  if (patch.exclusions) next.exclusions = patch.exclusions
  if (patch.destinationId === 'adobe-shared' || patch.destinationId === 'macos') {
    next.destinationId = patch.destinationId
  }
  next.availability = inspectFolderAvailability(next.root)
  return next
}

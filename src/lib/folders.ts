import type {
  DefaultDestinationId,
  DestinationCapability,
  DestinationId,
  FolderPolicyPreset,
  WatchFolder,
} from './types'

export const DESTINATIONS: { id: DefaultDestinationId; label: string; detail: string }[] = [
  {
    id: 'macos',
    label: 'This Mac',
    detail: 'Install a managed copy for macOS applications.',
  },
  {
    id: 'adobe-shared',
    label: 'Adobe folder',
    detail: 'Place a managed copy for Adobe apps. This is not a verified activation in Photoshop or InDesign.',
  },
  {
    id: 'macos-and-adobe',
    label: 'This Mac and Adobe folder',
    detail: 'Install a managed copy for macOS and place one in the Adobe folder.',
  },
]

export function destinationNeedsAdobe(id: DefaultDestinationId | undefined): boolean {
  return id === 'adobe-shared' || id === 'macos-and-adobe'
}

export function adobeTestingFolderAvailable(
  destinations: DestinationCapability[] | undefined,
): boolean {
  const adobe = destinations?.find((item) => item.id === 'adobe-shared')
  return adobe?.supported !== false
}

export function destinationLabel(id: DefaultDestinationId | DestinationId | undefined): string {
  return DESTINATIONS.find((item) => item.id === id)?.label ?? 'This Mac'
}

/** Per-folder choices shown when creating or editing a watch folder. */
export const WATCH_FOLDER_ACTIONS: {
  key: 'installNew' | 'autoUpdate'
  label: string
  description: string
}[] = [
  {
    key: 'installNew',
    label: 'Install fonts added to watch folders',
    description: 'Install font files that show up in this folder.',
  },
  {
    key: 'autoUpdate',
    label: 'Automatically reinstall when an update is detected',
    description: 'Replace the active installation when a source in this folder changes.',
  },
]

export const NEW_WATCH_FOLDER_ACTIONS = { installNew: true, autoUpdate: true }

export const GLOBAL_AUTO_REINSTALL_DESCRIPTION =
  'When a tracked source file changes, reinstall the installed copy. A watch folder uses its own checkbox, which wins over this one. Off by default.'

export const FOLDER_POLICIES: {
  id: FolderPolicyPreset
  label: string
  detail: string
}[] = [
  {
    id: 'library',
    label: 'Add to library',
    detail: 'Record and preview new fonts. Updates stay available until you install them.',
  },
  {
    id: 'install-new',
    label: 'Install new fonts',
    detail: 'Install newly discovered fonts. Changed sources show as updates.',
  },
  {
    id: 'install-new-and-updates',
    label: 'Install new fonts and updates',
    detail: 'Install new fonts and replace active installations when a source changes.',
  },
  {
    id: 'custom',
    label: 'Custom',
    detail: 'A preserved combination of install-new and auto-update that is not a named preset.',
  },
]

export function folderPolicyLabel(policy: FolderPolicyPreset): string {
  return FOLDER_POLICIES.find((item) => item.id === policy)?.label ?? policy
}

export function folderAvailabilityLabel(folder: WatchFolder): string {
  switch (folder.availability) {
    case 'offline':
      return 'Drive offline'
    case 'unreadable':
      return 'Unreadable'
    case 'missing':
      return 'Missing'
    case 'none':
      return 'Not linked'
    default:
      return folder.paused ? 'Paused' : folder.watching ? 'Watching' : 'Configured'
  }
}

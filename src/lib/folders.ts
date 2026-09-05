import type { DestinationId, FolderPolicyPreset, WatchFolder } from './types'

export const DESTINATIONS: { id: DestinationId; label: string; detail: string }[] = [
  {
    id: 'macos',
    label: 'This Mac',
    detail: 'Install a managed copy for macOS applications.',
  },
  {
    id: 'adobe-shared',
    label: 'Adobe testing folder',
    detail: 'Place a managed copy for Adobe apps. This is not a verified activation in Photoshop or InDesign.',
  },
]

export function destinationLabel(id: DestinationId | undefined): string {
  return DESTINATIONS.find((item) => item.id === id)?.label ?? 'This Mac'
}

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

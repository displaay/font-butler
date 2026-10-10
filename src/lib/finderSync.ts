export const FINDER_SYNC_ENABLE_LABEL = 'Finder menu'

export const FINDER_SYNC_ENABLE_DESCRIPTION =
  'Right-click a font file or a folder of fonts in Finder and choose Install or Install as…. Enable the Font Buttler extension once in System Settings, under General, Login Items & Extensions. The menu stays hidden while that extension is off. Until Font Buttler is allowed in Login Items, use Services (right-click > Services > Install). Inside Dropbox or iCloud folders you may need Services (right-click > Services > Install). Services still lists Install, Install as…, and Link to ….'

export const FINDER_SYNC_SETTINGS_BUTTON = 'Open Login Items & Extensions'

export const FINDER_SYNC_LOGIN_ITEMS_BUTTON = 'Open Login Items'

export type FinderSyncAgentStatusName =
  | 'enabled'
  | 'requires-approval'
  | 'not-registered'
  | 'not-found'
  | 'unsupported'
  | 'unknown'

/** The Login Items step is the one in-app action while the agent is not on. */
export function finderSyncEnableAction(status: FinderSyncAgentStatusName | string = 'enabled') {
  if (status === 'requires-approval' || status === 'not-registered' || status === 'not-found') {
    return 'login-items' as const
  }
  if (status === 'unsupported') return 'none' as const
  return 'extensions' as const
}

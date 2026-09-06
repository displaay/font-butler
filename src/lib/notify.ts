import { WOFF_INSTALL_ERROR } from './formats.ts'

export type ActionVerb =
  | 'install'
  | 'activate'
  | 'deactivate'
  | 'remove'
  | 'reinstall'
  | 'forget'
  | 'deleteFiles'
  | 'uninstallAndRemove'

const ACTION_WORDS: Record<ActionVerb, { pending: string; done: string }> = {
  install: { pending: 'Installing', done: 'Installed' },
  activate: { pending: 'Activating', done: 'Activated' },
  deactivate: { pending: 'Deactivating', done: 'Deactivated' },
  remove: { pending: 'Removing', done: 'Removed' },
  reinstall: { pending: 'Reinstalling', done: 'Reinstalled' },
  forget: { pending: 'Removing', done: 'Removed' },
  deleteFiles: { pending: 'Deleting', done: 'Deleted' },
  uninstallAndRemove: { pending: 'Uninstalling and removing', done: 'Uninstalled and removed' },
}

export function actionCopy(verb: ActionVerb, subject: string): { pending: string; done: string } {
  const words = ACTION_WORDS[verb]
  const suffix = verb === 'forget' ? ' from the list' : ''
  return {
    pending: `${words.pending} ${subject}${suffix}…`,
    done: `${words.done} ${subject}${suffix}`,
  }
}

export function actionCopyFor(
  verb: ActionVerb,
  groups: { familyName: string }[],
): { pending: string; done: string } {
  return actionCopy(verb, groups.length === 1 ? groups[0].familyName : `${groups.length} fonts`)
}

export function remainingActionCopy(
  verb: ActionVerb,
  remaining: number,
  singleName?: string,
): string {
  if (remaining <= 1 && singleName) {
    return actionCopy(verb, singleName).pending
  }
  return actionCopy(verb, remaining === 1 ? '1 font' : `${remaining} fonts`).pending
}

export function importDoneCopy(options: {
  installed: boolean
  count: number
  name?: string
  ignored?: number
  preview?: number
}): string {
  const ignored = options.ignored ?? 0
  const preview = options.preview ?? 0
  if (preview > 0 && options.count > preview) {
    const installed = options.count - preview
    return `${installed} ${installed === 1 ? 'font' : 'fonts'} ${
      options.installed ? 'installed' : 'added'
    } and ${preview} preview-only`
  }
  if (preview > 0 && options.count === preview) {
    if (options.count === 1 && options.name) return `Added preview of ${options.name}`
    return `Added ${options.count} preview-only ${options.count === 1 ? 'font' : 'fonts'}`
  }
  if (ignored > 0) {
    const main = `${options.count} ${options.count === 1 ? 'font' : 'fonts'} ${
      options.installed ? 'installed' : 'added'
    }`
    const skip = `${ignored} ${ignored === 1 ? 'font' : 'fonts'} ignored`
    return `${main} and ${skip}`
  }
  const verb = options.installed ? 'Installed' : 'Added'
  if (options.count === 1 && options.name) return `${verb} ${options.name}`
  return `${verb} ${options.count} ${options.count === 1 ? 'font' : 'fonts'}`
}

export function adobeInstallCopy(count: number): { pending: string; done: string } {
  if (count <= 1) {
    return { pending: 'Placing Adobe testing copy…', done: 'Placed Adobe testing copy' }
  }
  return {
    pending: `Placing ${count} Adobe testing copies…`,
    done: `Placed ${count} Adobe testing copies`,
  }
}

export function emptyImportError(visibleErrors: string[], ignored = 0): string {
  if (visibleErrors.length) return visibleErrors.join('\n')
  if (ignored > 0) return WOFF_INSTALL_ERROR
  return 'Could not add fonts'
}

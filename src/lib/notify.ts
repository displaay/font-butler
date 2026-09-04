import { WOFF_INSTALL_ERROR } from './formats.ts'

export type ActionVerb =
  | 'install'
  | 'activate'
  | 'deactivate'
  | 'remove'
  | 'reinstall'
  | 'forget'
  | 'deleteFiles'

const ACTION_WORDS: Record<ActionVerb, { pending: string; done: string }> = {
  install: { pending: 'Installing', done: 'Installed' },
  activate: { pending: 'Activating', done: 'Activated' },
  deactivate: { pending: 'Deactivating', done: 'Deactivated' },
  remove: { pending: 'Removing', done: 'Removed' },
  reinstall: { pending: 'Reinstalling', done: 'Reinstalled' },
  forget: { pending: 'Removing', done: 'Removed' },
  deleteFiles: { pending: 'Deleting', done: 'Deleted' },
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
}): string {
  const ignored = options.ignored ?? 0
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

export function emptyImportError(visibleErrors: string[], ignored = 0): string {
  if (visibleErrors.length) return visibleErrors.join('\n')
  if (ignored > 0) return WOFF_INSTALL_ERROR
  return 'Could not add fonts'
}

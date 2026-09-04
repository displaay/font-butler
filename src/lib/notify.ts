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

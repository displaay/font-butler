import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isPathUnderFolder,
  mergeWatchFolders,
  watchFolderLabel,
  watchFolderName,
} from './watchFolders.ts'

test('isPathUnderFolder matches files inside a watch folder', () => {
  assert.equal(isPathUnderFolder('/Users/you/Fonts/Inbox/Family.otf', '/Users/you/Fonts/Inbox'), true)
  assert.equal(isPathUnderFolder('/Users/you/Fonts/Inbox', '/Users/you/Fonts/Inbox'), true)
  assert.equal(isPathUnderFolder('/Users/you/Fonts/Other/Family.otf', '/Users/you/Fonts/Inbox'), false)
  assert.equal(isPathUnderFolder('/Users/you/Fonts/Inbox2/Family.otf', '/Users/you/Fonts/Inbox'), false)
})

test('watchFolderName uses the last path segment', () => {
  assert.equal(watchFolderName('/Users/you/Fonts/Inbox'), 'Inbox')
  assert.equal(watchFolderName('/Users/you/Fonts/Inbox/'), 'Inbox')
})

test('watchFolderLabel disambiguates matching folder names', () => {
  const folders = ['/Users/you/Work/Inbox', '/Users/you/Personal/Inbox']
  assert.equal(watchFolderLabel(folders[0], folders), 'Work/Inbox')
  assert.equal(watchFolderLabel('/Users/you/Fonts/Client', folders), 'Client')
})

test('mergeWatchFolders appends new folders without duplicates', () => {
  assert.deepEqual(mergeWatchFolders(['/Users/you/Fonts'], ['/Users/you/Fonts/', '/Users/you/Clients']), [
    '/Users/you/Fonts',
    '/Users/you/Clients',
  ])
})

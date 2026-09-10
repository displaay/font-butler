import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CatalogEntry, FontFaceInfo } from './types.ts'
import {
  isPathUnderFolder,
  isRetailLibraryEntry,
  isRetailLibraryFilter,
  isWatchFolderEntry,
  libraryFolderFilterLabel,
  matchesLibraryFolderFilter,
  mergeWatchFolders,
  RETAIL_LIBRARY_FILTER,
  RETAIL_LIBRARY_LABEL,
  watchFolderLabel,
  watchFolderName,
} from './watchFolders.ts'

function entry(
  sourcePath: string,
  sourcePresent: boolean,
  status: CatalogEntry['status'] = 'installed',
): CatalogEntry {
  const face: FontFaceInfo = {
    familyName: 'Demo',
    styleName: 'Regular',
    fullName: 'Demo Regular',
    postscriptName: 'Demo-Regular',
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
  return {
    id: sourcePath,
    sourcePath,
    sourceMtimeMs: 1,
    sourceSize: 1,
    sourcePresent,
    status,
    faces: [face],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
  }
}

test('isWatchFolderEntry ignores a missing source that still points at the folder', () => {
  const folder = '/Users/you/Fonts/Inbox'
  const present = entry(`${folder}/Family.otf`, true)
  const missing = entry(`${folder}/Gone.otf`, false)
  const elsewhere = entry('/Users/you/Fonts/Other/Family.otf', true)
  const orphan = entry(`${folder}/Old.otf`, false, 'source-missing')
  assert.equal(isWatchFolderEntry(present, folder), true)
  assert.equal(isWatchFolderEntry(missing, folder), false)
  assert.equal(isWatchFolderEntry(elsewhere, folder), false)
  assert.equal(isWatchFolderEntry(orphan, folder), false)
})

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

test('the retail library filter matches catalog entries tagged with a retail path', () => {
  const retail = { ...entry('/Users/you/Library/Fonts/RecklessVF.otf', true), retailRelativePath: 'Reckless/RecklessVF.otf' }
  const local = entry('/Users/you/Fonts/Inbox/Family.otf', true)
  assert.equal(isRetailLibraryFilter(RETAIL_LIBRARY_FILTER), true)
  assert.equal(isRetailLibraryEntry(retail), true)
  assert.equal(isRetailLibraryEntry(local), false)
  assert.equal(matchesLibraryFolderFilter(retail, RETAIL_LIBRARY_FILTER), true)
  assert.equal(matchesLibraryFolderFilter(local, RETAIL_LIBRARY_FILTER), false)
  assert.equal(libraryFolderFilterLabel(RETAIL_LIBRARY_FILTER, []), RETAIL_LIBRARY_LABEL)
})

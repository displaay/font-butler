import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createSavedFilter,
  defaultSavedFilterName,
  deleteSavedFilter,
  emptyLibraryCriteria,
  renameSavedFilter,
  savedFilterMatches,
} from './savedFilters.ts'

test('applying a saved filter restores query, chips, and source folder', () => {
  const [saved] = createSavedFilter([], {
    query: 'Acme',
    libraryFilters: ['uninstalled', 'source'],
    watchFolder: '/Library/Client',
  })
  assert.ok(saved)
  assert.equal(savedFilterMatches(saved, emptyLibraryCriteria()), false)
  assert.equal(
    savedFilterMatches(saved, {
      query: saved.query,
      libraryFilters: saved.libraryFilters,
      watchFolder: saved.watchFolder,
    }),
    true,
  )
})

test('rename and delete do not change captured library criteria', () => {
  const created = createSavedFilter([], {
    name: 'Needles',
    query: 'Needles',
    libraryFilters: ['installed'],
    watchFolder: null,
  })
  const renamed = renameSavedFilter(created, created[0]!.id, 'Needles VF')
  assert.equal(renamed[0]!.query, 'Needles')
  assert.deepEqual(renamed[0]!.libraryFilters, ['installed'])
  assert.equal(deleteSavedFilter(renamed, renamed[0]!.id).length, 0)
  assert.equal(defaultSavedFilterName(emptyLibraryCriteria()), 'Untitled filter')
  assert.equal(
    defaultSavedFilterName({ query: '', libraryFilters: [], watchFolder: '__retail__' }),
    'Displaay retail',
  )
})

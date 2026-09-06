import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createSavedFilter,
  defaultSavedFilterName,
  deleteSavedFilter,
  normalizeSavedFilters,
  renameSavedFilter,
  savedFilterMatches,
} from './saved-filters.ts'

test('normalizeSavedFilters keeps named library criteria and drops junk', () => {
  const saved = normalizeSavedFilters([
    {
      id: 'vf-installed',
      name: 'VF installed',
      query: 'Review',
      libraryFilters: ['installed', 'vf', 'nope'],
      watchFolder: '/Fonts/Client',
      createdAt: 12,
    },
    { id: '', name: 'bad' },
    { name: 'missing-id', query: 'x' },
    null,
  ])
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0], {
    id: 'vf-installed',
    name: 'VF installed',
    query: 'Review',
    libraryFilters: ['installed', 'vf'],
    watchFolder: '/Fonts/Client',
    createdAt: 12,
  })
  assert.deepEqual(normalizeSavedFilters(undefined), [])
})

test('create, rename, and delete saved filters are grouping-only list edits', () => {
  const created = createSavedFilter([], {
    name: 'WIP VF',
    query: 'WIP',
    libraryFilters: ['vf'],
    watchFolder: null,
  })
  assert.equal(created.length, 1)
  assert.equal(created[0]!.name, 'WIP VF')
  assert.equal(created[0]!.query, 'WIP')
  assert.deepEqual(created[0]!.libraryFilters, ['vf'])
  const renamed = renameSavedFilter(created, created[0]!.id, '  Client WIP  ')
  assert.equal(renamed[0]!.name, 'Client WIP')
  assert.equal(renamed[0]!.query, 'WIP')
  const emptyName = renameSavedFilter(renamed, renamed[0]!.id, '   ')
  assert.equal(emptyName[0]!.name, 'Untitled filter')
  const removed = deleteSavedFilter(emptyName, emptyName[0]!.id)
  assert.deepEqual(removed, [])
})

test('savedFilterMatches compares query, chips, and source folder', () => {
  const filter = createSavedFilter([], {
    name: 'Installed VF',
    query: 'Review',
    libraryFilters: ['installed', 'vf'],
    watchFolder: '/Fonts',
  })[0]!
  assert.equal(
    savedFilterMatches(filter, {
      query: 'Review',
      libraryFilters: ['vf', 'installed'],
      watchFolder: '/Fonts',
    }),
    true,
  )
  assert.equal(
    savedFilterMatches(filter, {
      query: 'Review',
      libraryFilters: ['installed', 'vf'],
      watchFolder: '/Other',
    }),
    false,
  )
  assert.equal(
    savedFilterMatches(filter, { query: '', libraryFilters: ['installed', 'vf'], watchFolder: '/Fonts' }),
    false,
  )
})

test('defaultSavedFilterName uses search, folder, and chips', () => {
  assert.equal(
    defaultSavedFilterName({
      query: 'Review',
      libraryFilters: ['installed', 'vf'],
      watchFolder: '/Users/me/Fonts/Client',
    }),
    'Review · Client · installed, vf',
  )
  assert.equal(
    defaultSavedFilterName({ query: '', libraryFilters: [], watchFolder: null }),
    'Untitled filter',
  )
})

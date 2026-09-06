import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FONT_BUTLER_ENTRIES_TYPE,
  canDropOnProject,
  defaultProjectName,
  memberIdsForProjectImport,
  projectContainsAll,
  readFontButlerEntries,
  readProjectSort,
  removeMemberIds,
  sortProjects,
  uniqueMemberIds,
} from './projects.ts'

test('defaultProjectName uses the family when exactly one is selected', () => {
  assert.equal(defaultProjectName(['Aguzzo']), 'Aguzzo')
  assert.equal(defaultProjectName([]), 'Untitled project')
  assert.equal(defaultProjectName(['Aguzzo', 'Reckless']), 'Untitled project')
})

test('uniqueMemberIds and removeMemberIds keep project membership stable', () => {
  assert.deepEqual(uniqueMemberIds(['a', 'b'], ['b', 'c']), ['a', 'b', 'c'])
  assert.deepEqual(removeMemberIds(['a', 'b', 'c'], ['b', 'd']), ['a', 'c'])
})

test('projectContainsAll requires every requested member', () => {
  const project = { members: [{ assetId: 'a' }, { assetId: 'b' }] }
  assert.equal(projectContainsAll(project, ['a', 'b']), true)
  assert.equal(projectContainsAll(project, ['a', 'c']), false)
  assert.equal(projectContainsAll(project, []), false)
})

test('sortProjects orders by name or keeps date-added order', () => {
  const projects = [{ name: 'Zed' }, { name: 'Able' }, { name: 'Mid' }]
  assert.deepEqual(
    sortProjects(projects, 'name').map((item) => item.name),
    ['Able', 'Mid', 'Zed'],
  )
  assert.deepEqual(
    sortProjects(projects, 'added').map((item) => item.name),
    ['Zed', 'Able', 'Mid'],
  )
})

test('readProjectSort defaults to date added', () => {
  assert.equal(readProjectSort({ getItem: () => null }), 'added')
  assert.equal(readProjectSort({ getItem: () => 'name' }), 'name')
  assert.equal(readProjectSort({ getItem: () => 'nope' }), 'added')
})

test('canDropOnProject accepts catalog entries and filesystem files', () => {
  assert.equal(canDropOnProject({ types: ['Files'] } as DataTransfer), true)
  assert.equal(canDropOnProject({ types: [FONT_BUTLER_ENTRIES_TYPE] } as DataTransfer), true)
  assert.equal(canDropOnProject({ types: ['text/plain'] } as DataTransfer), false)
})

test('memberIdsForProjectImport unions imported fonts with existing plan matches', () => {
  assert.deepEqual(
    memberIdsForProjectImport(
      {
        items: [
          { classification: 'identical', entryId: 'existing' },
          { classification: 'new' },
          { classification: 'unsupported', entryId: 'bad' },
          { classification: 'preview-only', entryId: 'web' },
        ],
      },
      [{ id: 'fresh' }],
    ),
    ['fresh', 'existing', 'web'],
  )
})

test('readFontButlerEntries ignores malformed payloads', () => {
  const types: string[] = []
  const store = new Map<string, string>()
  const dataTransfer = {
    types,
    getData: (type: string) => store.get(type) ?? '',
  } as unknown as DataTransfer
  assert.deepEqual(readFontButlerEntries(dataTransfer), [])
  store.set('application/x-font-butler-entries', '{"nope":true}')
  assert.deepEqual(readFontButlerEntries(dataTransfer), [])
  store.set('application/x-font-butler-entries', '["ok", 1, ""]')
  assert.deepEqual(readFontButlerEntries(dataTransfer), ['ok'])
})

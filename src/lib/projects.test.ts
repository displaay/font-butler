import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  defaultProjectName,
  projectContainsAll,
  readFontButlerEntries,
  removeMemberIds,
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

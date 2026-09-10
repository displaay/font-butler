import assert from 'node:assert/strict'
import { test } from 'node:test'
import { operationMatchesQuery, tabWithSearchHits } from './search.ts'
import type { Operation } from './types.ts'

test('tabWithSearchHits stays put when the query is empty', () => {
  assert.equal(
    tabWithSearchHits({
      current: 'system',
      query: '',
      libraryHits: 3,
      systemHits: 8,
      updateHits: 1,
      activityHits: 2,
    }),
    'system',
  )
})

test('tabWithSearchHits stays on the current tab when it has matches', () => {
  assert.equal(
    tabWithSearchHits({
      current: 'system',
      query: 'Arial',
      libraryHits: 1,
      systemHits: 4,
      updateHits: 0,
      activityHits: 0,
    }),
    'system',
  )
})

test('tabWithSearchHits jumps to the first tab that has matches', () => {
  assert.equal(
    tabWithSearchHits({
      current: 'library',
      query: 'Arial Hebrew',
      libraryHits: 0,
      systemHits: 2,
      updateHits: 0,
      activityHits: 0,
    }),
    'system',
  )
  assert.equal(
    tabWithSearchHits({
      current: 'activity',
      query: 'Inter',
      libraryHits: 1,
      systemHits: 1,
      updateHits: 0,
      activityHits: 0,
    }),
    'library',
  )
})

test('tabWithSearchHits stays put when nothing matches', () => {
  assert.equal(
    tabWithSearchHits({
      current: 'library',
      query: 'zzz',
      libraryHits: 0,
      systemHits: 0,
      updateHits: 0,
      activityHits: 0,
    }),
    'library',
  )
})

test('operationMatchesQuery matches family, action, and item labels', () => {
  const operation: Operation = {
    id: '1',
    startedAt: 1,
    trigger: 'import',
    action: 'install',
    familyName: 'Inter',
    items: [{ id: 'i', label: 'Inter Regular', outcome: 'succeeded' }],
    outcome: 'succeeded',
    undoable: true,
    undone: false,
  }
  assert.equal(operationMatchesQuery(operation, 'inter'), true)
  assert.equal(operationMatchesQuery(operation, 'install'), true)
  assert.equal(operationMatchesQuery(operation, 'zzz'), false)
  assert.equal(operationMatchesQuery(operation, ''), true)
})

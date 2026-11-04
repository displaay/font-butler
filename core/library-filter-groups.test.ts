import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  defaultLibraryFilterGroups,
  moveLibraryFilterGroup,
  normalizeLibraryFilterGroups,
  withoutGroupFilters,
} from '../shared/library-filter-groups.ts'

test('filter groups default to today’s sidebar and keep the new groups hidden', () => {
  const groups = defaultLibraryFilterGroups()
  assert.deepEqual(
    groups.filter((group) => group.visible).map((group) => group.id),
    ['status', 'type', 'source', 'destination', 'format'],
  )
  assert.equal(groups.find((group) => group.id === 'classification')?.visible, false)
  assert.equal(groups.find((group) => group.id === 'foundry')?.visible, false)
})

test('normalize drops unknown groups, keeps order, and appends anything missing', () => {
  const groups = normalizeLibraryFilterGroups([
    { id: 'foundry', visible: true },
    { id: 'nope', visible: true },
    { id: 'status', visible: 'yes' },
  ])
  assert.equal(groups[0]?.id, 'foundry')
  assert.equal(groups[0]?.visible, true)
  assert.equal(groups.find((group) => group.id === 'status')?.visible, false)
  assert.equal(groups.some((group) => group.id === 'classification'), true)
  assert.equal(groups.length, 7)
})

test('moving a group reorders it and hiding it clears that group’s chips', () => {
  const moved = moveLibraryFilterGroup(defaultLibraryFilterGroups(), 'format', 'status')
  assert.equal(moved[0]?.id, 'format')
  assert.deepEqual(withoutGroupFilters(['installed', 'otf', 'classification:serif', 'foundry:Displaay'], 'format'), [
    'installed',
    'classification:serif',
    'foundry:Displaay',
  ])
})

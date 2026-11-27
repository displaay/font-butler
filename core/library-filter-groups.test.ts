import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  defaultLibraryFilterGroups,
  moveLibraryFilterGroup,
  moveVisibleLibraryFilterGroup,
  normalizeLibraryFilterGroups,
  withoutGroupFilters,
  type LibraryFilterGroupPref,
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

const interleaved: LibraryFilterGroupPref[] = [
  { id: 'status', visible: true },
  { id: 'classification', visible: false },
  { id: 'type', visible: true },
  { id: 'foundry', visible: false },
  { id: 'source', visible: true },
  { id: 'destination', visible: true },
  { id: 'format', visible: true },
]

test('moving a visible group up or down leaves hidden groups in their slots', () => {
  const up = moveVisibleLibraryFilterGroup(interleaved, 'format', 'status', 'before')
  assert.deepEqual(
    up.map((group) => group.id),
    ['format', 'classification', 'status', 'foundry', 'type', 'source', 'destination'],
  )
  assert.deepEqual(
    up.filter((group) => group.visible).map((group) => group.id),
    ['format', 'status', 'type', 'source', 'destination'],
  )
  assert.equal(up.find((group) => group.id === 'classification')?.visible, false)
  assert.equal(up.find((group) => group.id === 'foundry')?.visible, false)

  const down = moveVisibleLibraryFilterGroup(interleaved, 'status', 'source', 'after')
  assert.deepEqual(
    down.filter((group) => group.visible).map((group) => group.id),
    ['type', 'source', 'status', 'destination', 'format'],
  )
  assert.equal(down[1]?.id, 'classification')
  assert.equal(down[1]?.visible, false)
  assert.equal(down[3]?.id, 'foundry')
  assert.equal(down[3]?.visible, false)
  assert.equal(down.length, interleaved.length)
})

test('dropping a visible group on itself or an invalid target is a no-op', () => {
  const groups = defaultLibraryFilterGroups()
  assert.equal(moveVisibleLibraryFilterGroup(groups, 'type', 'type', 'before'), groups)
  assert.equal(moveVisibleLibraryFilterGroup(groups, 'type', 'type', 'after'), groups)
  assert.equal(moveVisibleLibraryFilterGroup(groups, 'status', 'type', 'before'), groups)
  assert.equal(moveVisibleLibraryFilterGroup(groups, 'type', 'status', 'after'), groups)
  assert.equal(moveVisibleLibraryFilterGroup(groups, 'missing', 'type', 'before'), groups)
  assert.equal(moveVisibleLibraryFilterGroup(groups, 'type', 'missing', 'after'), groups)
  assert.equal(moveVisibleLibraryFilterGroup(groups, 'classification', 'status', 'before'), groups)
  assert.equal(moveVisibleLibraryFilterGroup(groups, 'status', 'foundry', 'after'), groups)
  assert.equal(moveVisibleLibraryFilterGroup(groups, 'format', 'source', 'beside' as 'before'), groups)
})

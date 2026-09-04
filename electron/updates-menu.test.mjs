import assert from 'node:assert/strict'
import { test } from 'node:test'
import { outdatedFamilies } from './updates-menu.mjs'

function entry(id, familyName, status, customFamilyName) {
  return {
    id,
    status,
    customFamilyName,
    faces: [{ familyName, styleName: 'Regular' }],
  }
}

test('outdatedFamilies lists update-tab families in A–Z order', () => {
  const families = outdatedFamilies([
    entry('zeta', 'Zeta', 'outdated'),
    entry('alpha-1', 'Alpha', 'outdated'),
    entry('keep', 'Keep', 'installed'),
    entry('alpha-2', 'Alpha', 'outdated'),
  ])
  assert.deepEqual(families, [
    { name: 'Alpha', ids: ['alpha-1', 'alpha-2'] },
    { name: 'Zeta', ids: ['zeta'] },
  ])
})

test('outdatedFamilies uses a custom family name when present', () => {
  const families = outdatedFamilies([
    entry('renamed', 'Source Sans', 'outdated', 'Display'),
  ])
  assert.deepEqual(families, [{ name: 'Display', ids: ['renamed'] }])
})

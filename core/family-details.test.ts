import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { loadCatalog, saveCatalog } from './catalog.ts'
import { persistFamilyComment, persistFamilyRating } from './family-details.ts'
import { tempPaths } from './test-util.ts'
import {
  commentForFamily,
  normalizeFamilyDetails,
  ratingForFamily,
} from '../shared/family-details.ts'

test('family rating and comment round-trip through the catalog', async () => {
  const paths = tempPaths('family-details-')
  try {
    saveCatalog(paths, { version: 1, entries: [] })
    const rated = await persistFamilyRating(paths, 'Acme Sans', 4)
    assert.equal(ratingForFamily(rated.familyDetails, 'Acme Sans'), 4)
    const commented = await persistFamilyComment(paths, 'Acme Sans', 'Hero face for headlines')
    assert.equal(commentForFamily(commented.familyDetails, 'Acme Sans'), 'Hero face for headlines')
    const saved = loadCatalog(paths)
    assert.deepEqual(saved.familyDetails, [
      { familyKey: 'Acme Sans', rating: 4, comment: 'Hero face for headlines' },
    ])

    const cleared = await persistFamilyRating(paths, 'Acme Sans', null)
    assert.equal(ratingForFamily(cleared.familyDetails, 'Acme Sans'), null)
    assert.equal(commentForFamily(cleared.familyDetails, 'Acme Sans'), 'Hero face for headlines')
    const emptied = await persistFamilyComment(paths, 'Acme Sans', '  ')
    assert.deepEqual(emptied.familyDetails, [])
    assert.deepEqual(loadCatalog(paths).familyDetails, [])
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('normalizeFamilyDetails drops invalid ratings and empty rows', () => {
  assert.deepEqual(
    normalizeFamilyDetails([
      { familyKey: 'A', rating: 9 },
      { familyKey: 'B', rating: 3, comment: ' ok ' },
      { familyKey: 'B', rating: 1 },
      { familyKey: ' ', rating: 5 },
      { familyKey: 'C', comment: '' },
    ]),
    [{ familyKey: 'B', rating: 3, comment: 'ok' }],
  )
})

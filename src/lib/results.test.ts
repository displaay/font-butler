import assert from 'node:assert/strict'
import { test } from 'node:test'
import { partialUnlinkWarning } from './results.ts'

test('a partial unlink that removed nothing warns instead of claiming success', () => {
  assert.equal(
    partialUnlinkWarning({
      removed: 0,
      partial: true,
      error: 'Uninstalled Fenul Regular, but it is still listed. Catalog write failed.',
    }),
    'Uninstalled Fenul Regular, but it is still listed. Catalog write failed.',
  )
  assert.equal(partialUnlinkWarning({ removed: 0, partial: true }), 'Could not uninstall and unlink that font.')
  assert.equal(partialUnlinkWarning({ removed: 2, partial: true, error: 'one failed' }), 'one failed')
  assert.equal(
    partialUnlinkWarning({ removed: 1, partial: true }),
    'Uninstalled and unlinked some fonts. Others are still listed.',
  )
  assert.equal(partialUnlinkWarning({ removed: 1 }), null)
  assert.equal(partialUnlinkWarning(null), null)
})

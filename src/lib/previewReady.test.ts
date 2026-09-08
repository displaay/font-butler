import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isGenericPreviewFamily,
  isPreviewFontReady,
  normalizePreviewFamily,
} from './previewReady.ts'

test('generic families are treated as ready so UI chrome is not blocked', () => {
  assert.equal(isGenericPreviewFamily('ui-sans-serif'), true)
  assert.equal(isGenericPreviewFamily('system-ui'), true)
  assert.equal(isGenericPreviewFamily(''), true)
  assert.equal(isGenericPreviewFamily('fc-abc'), false)
  assert.equal(isPreviewFontReady('ui-sans-serif'), true)
})

test('normalizePreviewFamily strips quotes', () => {
  assert.equal(normalizePreviewFamily('"fc-id"'), 'fc-id')
  assert.equal(normalizePreviewFamily("'sys-ab'"), 'sys-ab')
})

test('custom families are not ready without a loaded FontFace', () => {
  assert.equal(isPreviewFontReady('fc-missing'), false)
})

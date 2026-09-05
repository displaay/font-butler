import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countFormats, formatFromName, isInstallableFormat, isWebFormat } from './formats.ts'

test('formatFromName reads desktop and web extensions', () => {
  assert.equal(formatFromName('Family-Bold.otf'), 'otf')
  assert.equal(formatFromName('/tmp/Family.TTF'), 'ttf')
  assert.equal(formatFromName('Family.woff2'), 'woff2')
  assert.equal(formatFromName('notes.txt'), 'txt')
  assert.equal(formatFromName('Desktop package'), null)
})

test('isInstallableFormat rejects woff', () => {
  assert.equal(isInstallableFormat('otf'), true)
  assert.equal(isInstallableFormat('woff'), false)
  assert.equal(isInstallableFormat('woff2'), false)
})

test('isWebFormat only matches woff', () => {
  assert.equal(isWebFormat('woff2'), true)
  assert.equal(isWebFormat('otf'), false)
})

test('countFormats ignores web formats and keeps desktop order', () => {
  assert.deepEqual(countFormats(['ttf', 'otf', 'woff2', 'ttf', 'otf', 'otf']), [
    { format: 'otf', count: 3 },
    { format: 'ttf', count: 2 },
  ])
})

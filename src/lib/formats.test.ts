import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  countFormats,
  formatFromName,
  formatLabel,
  isInstallableFontName,
  isWebFontName,
  preferredFormat,
} from './formats.ts'

test('formatFromName reads desktop and web extensions', () => {
  assert.equal(formatFromName('Family-Bold.otf'), 'otf')
  assert.equal(formatFromName('/tmp/Family.TTF'), 'ttf')
  assert.equal(formatFromName('Family.woff2'), 'woff2')
  assert.equal(formatFromName('notes.txt'), 'txt')
  assert.equal(formatFromName('Desktop package'), null)
})

test('isInstallableFontName rejects woff', () => {
  assert.equal(isInstallableFontName('Family.otf'), true)
  assert.equal(isInstallableFontName('Family.woff'), false)
  assert.equal(isInstallableFontName('Family.woff2'), false)
})

test('isWebFontName only matches woff formats', () => {
  assert.equal(isWebFontName('Family.woff2'), true)
  assert.equal(isWebFontName('Family.otf'), false)
})

test('countFormats ignores web formats and keeps desktop order', () => {
  assert.deepEqual(countFormats(['ttf', 'otf', 'woff2', 'ttf', 'otf', 'otf']), [
    { format: 'otf', count: 3 },
    { format: 'ttf', count: 2 },
  ])
})

test('preferredFormat prefers OpenType', () => {
  assert.equal(preferredFormat(['ttf', 'otf']), 'otf')
  assert.equal(formatLabel('otf'), 'OpenType')
})

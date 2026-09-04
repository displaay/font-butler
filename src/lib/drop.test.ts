import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  collectNativeFolderPaths,
  isDroppedFontName,
  partitionDropPayload,
  shouldSkipDroppedName,
} from './drop.ts'

test('isDroppedFontName accepts common font extensions', () => {
  assert.equal(isDroppedFontName('Family-Bold.ttf'), true)
  assert.equal(isDroppedFontName('Family.OTF'), true)
  assert.equal(isDroppedFontName('Family.woff2'), true)
  assert.equal(isDroppedFontName('notes.txt'), false)
  assert.equal(isDroppedFontName('Family'), false)
})

test('shouldSkipDroppedName ignores hidden and junk folders', () => {
  assert.equal(shouldSkipDroppedName('.DS_Store'), true)
  assert.equal(shouldSkipDroppedName('__MACOSX'), true)
  assert.equal(shouldSkipDroppedName('Desktop'), false)
})

test('collectNativeFolderPaths keeps directory paths only', () => {
  assert.deepEqual(
    collectNativeFolderPaths([
      { isDirectory: true, path: '/Users/you/Fonts/Inbox' },
      { isDirectory: false, path: '/Users/you/Fonts/Inbox/Regular.otf' },
      { isDirectory: true, path: '  /Users/you/Clients  ' },
      { isDirectory: true },
    ]),
    ['/Users/you/Fonts/Inbox', '/Users/you/Clients'],
  )
})

test('partitionDropPayload asks for a choice when otf and ttf are mixed', () => {
  const result = partitionDropPayload(
    ['/fonts/Family-Regular.otf', '/fonts/Family-Regular.ttf', '/fonts/Family-Bold.otf'],
    [],
  )
  assert.deepEqual(
    result.formats.map((item) => item.format),
    ['otf', 'ttf'],
  )
  assert.equal(result.formats.find((item) => item.format === 'otf')?.count, 2)
  assert.equal(result.paths.length, 3)
})

test('partitionDropPayload skips woff and keeps a single desktop format', () => {
  const result = partitionDropPayload(
    ['/fonts/Family.otf', '/fonts/Web/Family.woff2', '/fonts/Web/Family.woff'],
    [],
  )
  assert.deepEqual(result.formats, [{ format: 'otf', count: 1 }])
  assert.equal(result.skippedWeb, 2)
  assert.deepEqual(result.paths, ['/fonts/Family.otf'])
})

test('partitionDropPayload keeps folder paths when no files were expanded', () => {
  const result = partitionDropPayload(['/fonts/Desktop package'], [])
  assert.deepEqual(result.paths, ['/fonts/Desktop package'])
  assert.deepEqual(result.formats, [])
})

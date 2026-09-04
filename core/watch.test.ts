import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { expandImportPaths, listFontFilesInTree } from './watch.ts'

function makeTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-walk-'))
  fs.writeFileSync(path.join(root, 'readme.txt'), 'nope')
  fs.writeFileSync(path.join(root, '.hidden.ttf'), 'skip')
  fs.writeFileSync(path.join(root, 'Top.ttf'), 'font')
  const nested = path.join(root, 'Family', 'Desktop', 'OTF')
  fs.mkdirSync(nested, { recursive: true })
  fs.writeFileSync(path.join(nested, 'Regular.otf'), 'font')
  fs.writeFileSync(path.join(nested, 'Bold.otf'), 'font')
  const macosx = path.join(root, 'Family', '__MACOSX')
  fs.mkdirSync(macosx)
  fs.writeFileSync(path.join(macosx, 'junk.ttf'), 'skip')
  const web = path.join(root, 'Family', 'Web')
  fs.mkdirSync(web)
  fs.writeFileSync(path.join(web, 'Family.woff2'), 'font')
  return root
}

test('listFontFilesInTree walks nested folders and skips junk', () => {
  const root = makeTree()
  try {
    const files = listFontFilesInTree(root)
      .map((filePath) => path.relative(root, filePath))
      .sort()
    assert.deepEqual(files, [
      path.join('Family', 'Desktop', 'OTF', 'Bold.otf'),
      path.join('Family', 'Desktop', 'OTF', 'Regular.otf'),
      'Top.ttf',
    ])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('expandImportPaths collects fonts from folders and files', () => {
  const root = makeTree()
  try {
    const top = path.join(root, 'Top.ttf')
    const result = expandImportPaths([root, top, path.join(root, 'missing.ttf')])
    assert.equal(result.files.length, 3)
    assert.equal(result.skippedWeb, 1)
    assert.equal(result.files.filter((filePath) => filePath === path.resolve(top)).length, 1)
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0], /Not found/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('expandImportPaths reports folders with no fonts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-empty-'))
  try {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'no fonts')
    const result = expandImportPaths([root])
    assert.deepEqual(result.files, [])
    assert.equal(result.skippedWeb, 0)
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0], /No font files in that folder/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('expandImportPaths skips woff files and does not treat them as errors', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-woff-'))
  try {
    const webOnlyDir = path.join(root, 'web')
    fs.mkdirSync(webOnlyDir)
    fs.writeFileSync(path.join(webOnlyDir, 'Family.woff2'), 'font')
    fs.writeFileSync(path.join(webOnlyDir, 'Family.woff'), 'font')
    const mixed = path.join(root, 'mixed')
    fs.mkdirSync(mixed)
    fs.writeFileSync(path.join(mixed, 'Regular.otf'), 'font')
    fs.writeFileSync(path.join(mixed, 'Web.woff2'), 'font')
    const webOnly = expandImportPaths([webOnlyDir])
    assert.deepEqual(webOnly.files, [])
    assert.equal(webOnly.skippedWeb, 2)
    assert.deepEqual(webOnly.errors, [])
    const mixedResult = expandImportPaths([mixed])
    assert.equal(mixedResult.files.length, 1)
    assert.equal(mixedResult.skippedWeb, 1)
    assert.deepEqual(mixedResult.errors, [])
    const fileResult = expandImportPaths([path.join(webOnlyDir, 'Family.woff2')])
    assert.deepEqual(fileResult.files, [])
    assert.equal(fileResult.skippedWeb, 1)
    assert.deepEqual(fileResult.errors, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

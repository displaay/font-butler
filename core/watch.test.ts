import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { expandImportPaths, inferExpandedFolderDrops, inspectDropPaths, listFontFilesInTree } from './watch.ts'

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
    assert.equal(result.files.length, 4)
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

test('expandImportPaths includes woff files for preview-only import', () => {
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
    assert.equal(webOnly.files.length, 2)
    assert.equal(webOnly.skippedWeb, 2)
    assert.deepEqual(webOnly.errors, [])
    const mixedResult = expandImportPaths([mixed])
    assert.equal(mixedResult.files.length, 2)
    assert.equal(mixedResult.skippedWeb, 1)
    assert.deepEqual(mixedResult.errors, [])
    const fileResult = expandImportPaths([path.join(webOnlyDir, 'Family.woff2')])
    assert.equal(fileResult.files.length, 1)
    assert.equal(fileResult.skippedWeb, 1)
    assert.deepEqual(fileResult.errors, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('inspectDropPaths reports a dropped directory', () => {
  const root = makeTree()
  try {
    const result = inspectDropPaths([root])
    assert.deepEqual(result.folders, [path.resolve(root)])
    assert.equal(result.files.length, 4)
    assert.deepEqual(
      result.formats.map((item) => item.format),
      ['otf', 'ttf'],
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('inferExpandedFolderDrops recovers a folder Electron expanded into files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-infer-'))
  try {
    const nested = path.join(root, 'Inbox', 'OTF')
    fs.mkdirSync(nested, { recursive: true })
    const otf = path.join(nested, 'Regular.otf')
    const ttfDir = path.join(root, 'Inbox', 'TTF')
    fs.mkdirSync(ttfDir)
    const ttf = path.join(ttfDir, 'Regular.ttf')
    fs.writeFileSync(otf, 'font')
    fs.writeFileSync(ttf, 'font')
    const inbox = path.join(root, 'Inbox')
    assert.deepEqual(inferExpandedFolderDrops([otf, ttf]), [inbox])
    const inspected = inspectDropPaths([otf, ttf])
    assert.deepEqual(inspected.folders, [inbox])
    assert.equal(inspected.files.length, 2)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('inferExpandedFolderDrops ignores extra woff files from a folder drop', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-woff-infer-'))
  try {
    const inbox = path.join(root, 'Inbox')
    const otfDir = path.join(inbox, 'OTF')
    const webDir = path.join(inbox, 'Web')
    fs.mkdirSync(otfDir, { recursive: true })
    fs.mkdirSync(webDir)
    const otf = path.join(otfDir, 'Regular.otf')
    const ttf = path.join(inbox, 'Regular.ttf')
    const woff = path.join(webDir, 'Regular.woff2')
    fs.writeFileSync(otf, 'font')
    fs.writeFileSync(ttf, 'font')
    fs.writeFileSync(woff, 'font')
    assert.deepEqual(inferExpandedFolderDrops([otf, ttf, woff]), [inbox])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('inferExpandedFolderDrops ignores a partial file selection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-partial-'))
  try {
    const regular = path.join(root, 'Regular.otf')
    const bold = path.join(root, 'Bold.otf')
    fs.writeFileSync(regular, 'font')
    fs.writeFileSync(bold, 'font')
    assert.deepEqual(inferExpandedFolderDrops([regular]), [])
    assert.deepEqual(inferExpandedFolderDrops([regular, bold]), [root])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

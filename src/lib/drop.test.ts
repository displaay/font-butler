import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  collectDropPayload,
  collectNativeFolderPaths,
  inferDroppedFolderPath,
  isDroppedFolderPath,
  isDroppedFontName,
  isWebOnlyDrop,
  partitionDropPayload,
  shouldSkipDroppedName,
} from './drop.ts'

function fileWithPath(name: string, filePath?: string): File {
  const file = new File(['x'], name)
  if (filePath) (file as File & { path?: string }).path = filePath
  return file
}

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

test('isDroppedFolderPath treats extensionless paths as folders', () => {
  assert.equal(isDroppedFolderPath('/Users/you/Fonts/Inbox'), true)
  assert.equal(isDroppedFolderPath('/Users/you/Fonts/Inbox', 'Inbox'), true)
  assert.equal(isDroppedFolderPath('/Users/you/Fonts/Regular.otf', 'Regular.otf'), false)
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

test('collectDropPayload recovers a folder from dataTransfer.files when getAsFile is empty', async () => {
  const folder = fileWithPath('Inbox', '/Users/you/Fonts/Inbox')
  const payload = await collectDropPayload({
    files: [folder],
    items: [
      {
        kind: 'file',
        getAsFile: () => null,
        webkitGetAsEntry: () => ({
          isDirectory: true,
          isFile: false,
          name: 'Inbox',
          fullPath: '/Inbox',
          createReader: () => ({
            readEntries: (ok: (batch: FileSystemEntry[]) => void) => ok([]),
          }),
        }),
      },
    ],
  } as unknown as DataTransfer)
  assert.deepEqual(payload.folders, ['/Users/you/Fonts/Inbox'])
})

test('collectDropPayload infers a folder from child native paths', async () => {
  const child = fileWithPath('Regular.otf', '/Users/you/Fonts/Inbox/Regular.otf')
  let sent = false
  const payload = await collectDropPayload({
    files: [child],
    items: [
      {
        kind: 'file',
        getAsFile: () => null,
        webkitGetAsEntry: () => ({
          isDirectory: true,
          isFile: false,
          name: 'Inbox',
          fullPath: '/Inbox',
          createReader: () => ({
            readEntries: (ok: (batch: unknown[]) => void) => {
              if (sent) {
                ok([])
                return
              }
              sent = true
              ok([
                {
                  isDirectory: false,
                  isFile: true,
                  name: 'Regular.otf',
                  fullPath: '/Inbox/Regular.otf',
                  file: (okFile: (file: File) => void) => okFile(child),
                },
              ])
            },
          }),
        }),
      },
    ],
  } as unknown as DataTransfer)
  assert.deepEqual(payload.folders, ['/Users/you/Fonts/Inbox'])
  assert.deepEqual(payload.paths, ['/Users/you/Fonts/Inbox/Regular.otf'])
})

test('inferDroppedFolderPath recovers the dropped folder from a child file path', () => {
  assert.equal(
    inferDroppedFolderPath(
      '/Users/you/Fonts/Inbox/OTF/Regular.otf',
      '/Inbox/OTF/Regular.otf',
      '/Inbox',
    ),
    '/Users/you/Fonts/Inbox',
  )
  assert.equal(
    inferDroppedFolderPath(
      'C:\\Users\\you\\Fonts\\Inbox\\Regular.otf',
      '/Inbox/Regular.otf',
      '/Inbox',
    ),
    'C:\\Users\\you\\Fonts\\Inbox',
  )
  assert.equal(
    inferDroppedFolderPath('/Users/you/Other/Regular.otf', '/Inbox/Regular.otf', '/Inbox'),
    undefined,
  )
})

test('partitionDropPayload counts mixed desktop formats', () => {
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

test('partitionDropPayload treats woff-only drops as web-only', () => {
  const result = partitionDropPayload(
    ['/fonts/Web/Family.woff2', '/fonts/Web/Family.woff'],
    [],
  )
  assert.deepEqual(result.paths, [])
  assert.deepEqual(result.files, [])
  assert.equal(result.skippedWeb, 2)
  assert.equal(isWebOnlyDrop(result), true)
})

test('partitionDropPayload does not double-count files that already have native paths', () => {
  const otf = fileWithPath('Family.otf', '/fonts/Family.otf')
  const woff = fileWithPath('Family.woff2', '/fonts/Family.woff2')
  const result = partitionDropPayload(
    ['/fonts/Family.otf', '/fonts/Family.woff2'],
    [otf, woff],
  )
  assert.deepEqual(result.paths, ['/fonts/Family.otf'])
  assert.equal(result.files.length, 0)
  assert.equal(result.skippedWeb, 1)
  assert.equal(isWebOnlyDrop(result), false)
})

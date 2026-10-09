import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { saveCatalog } from './catalog.ts'
import { DATALESS_FONT_ERROR, readFontPreviewBytes } from './font-bytes.ts'
import { withService } from './test-util.ts'
import type { CatalogEntry } from './types.ts'

function sparseFile(file: string, size: number): void {
  const fd = fs.openSync(file, 'w')
  fs.ftruncateSync(fd, size)
  fs.closeSync(fd)
}

function entryFor(file: string, id: string): CatalogEntry {
  const stat = fs.statSync(file)
  return {
    id,
    sourcePath: file,
    sourceMtimeMs: stat.mtimeMs,
    sourceSize: stat.size,
    sourcePresent: true,
    status: 'uninstalled',
    faces: [],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
  }
}

test('a zero-block file that can be read is still previewed', async () => {
  await withService(async (service, paths) => {
    const file = path.join(paths.dataRoot, 'Inline.otf')
    sparseFile(file, 64)
    const stat = fs.statSync(file)
    assert.equal(stat.size, 64)
    assert.equal(stat.blocks, 0, 'this filesystem did not leave the file with zero blocks')
    const bytes = await readFontPreviewBytes(file)
    assert.equal(bytes.length, 64)

    const entry = entryFor(file, 'inline-font')
    saveCatalog(paths, { version: 1, entries: [entry] })
    const served = await service.fontBytesForRevision(entry.id, 'source')
    assert.equal(served.buffer.length, 64)
    assert.equal(served.filename, 'Inline.otf')
  })
})

test('/api/font-file returns an error when the preview read fails', async () => {
  await withService(async (service, paths) => {
    const real = path.join(paths.dataRoot, 'Real.otf')
    fs.writeFileSync(real, Buffer.from('otf-bytes'))
    const entry = entryFor(real, 'real-font')
    saveCatalog(paths, { version: 1, entries: [entry] })

    const original = fs.promises.readFile
    fs.promises.readFile = (async () => {
      throw new Error('preview read failed')
    }) as typeof fs.promises.readFile
    try {
      await assert.rejects(() => service.fontBytesForRevision(entry.id, 'source'), /preview read failed/)
    } finally {
      fs.promises.readFile = original
    }

    const placeholder = path.join(paths.dataRoot, 'Placeholder.otf')
    sparseFile(placeholder, 1024)
    assert.equal(fs.statSync(placeholder).blocks, 0)
    const cloud = entryFor(placeholder, 'cloud-font')
    saveCatalog(paths, { version: 1, entries: [cloud] })
    fs.promises.readFile = (async () => {
      throw new Error('EIO')
    }) as typeof fs.promises.readFile
    try {
      await assert.rejects(
        () => service.fontBytesForRevision(cloud.id, 'source'),
        new RegExp(DATALESS_FONT_ERROR),
      )
    } finally {
      fs.promises.readFile = original
    }
  })
})

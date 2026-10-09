import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { saveCatalog } from './catalog.ts'
import { DATALESS_FONT_ERROR, readMaterializedFontBytes } from './font-bytes.ts'
import { withService } from './test-util.ts'
import type { CatalogEntry } from './types.ts'

function placeholderFile(file: string): void {
  const fd = fs.openSync(file, 'w')
  fs.ftruncateSync(fd, 1024 * 1024)
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

test('/api/font-file rejects a dataless placeholder instead of reading it', async () => {
  await withService(async (service, paths) => {
    const placeholder = path.join(paths.dataRoot, 'CloudFont.otf')
    placeholderFile(placeholder)
    const stat = fs.statSync(placeholder)
    assert.equal(stat.size > 0, true)
    assert.equal(stat.blocks, 0, 'this filesystem did not leave the placeholder dataless')

    assert.throws(() => readMaterializedFontBytes(placeholder), new RegExp(DATALESS_FONT_ERROR))

    const real = path.join(paths.dataRoot, 'Real.otf')
    fs.writeFileSync(real, Buffer.from('otf-bytes'))
    assert.equal(readMaterializedFontBytes(real).toString(), 'otf-bytes')

    const cloud = entryFor(placeholder, 'cloud-font')
    assert.throws(
      () => service.fontBytesForEntry(cloud.id, cloud, [cloud]),
      /cloud placeholder/,
    )

    saveCatalog(paths, { version: 1, entries: [cloud] })
    assert.throws(() => service.fontBytesForRevision(cloud.id, 'source'), /cloud placeholder/)

    const materialized = entryFor(real, 'real-font')
    saveCatalog(paths, { version: 1, entries: [materialized] })
    const bytes = service.fontBytesForRevision(materialized.id, 'source')
    assert.equal(bytes.buffer.toString(), 'otf-bytes')
    assert.equal(bytes.filename, 'Real.otf')
  })
})
